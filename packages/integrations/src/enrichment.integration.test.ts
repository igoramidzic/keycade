import { randomUUID } from "node:crypto";
import type { EnrichmentResult } from "@keycade/contracts";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  auditEvents,
  confirmedEnrichmentFacts,
  enrichmentInputs,
  enrichmentRuns,
  sensitiveIdentifierVersions,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { type Actor, createEnrichmentService, createIdentifierCipher } from "@keycade/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processEnrichmentRun } from "./enrichment-jobs.js";
import { type EnrichmentProviderRequest } from "./enrichment-provider.js";
import { type Clock, ProviderError } from "./provider.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const cipher = createIdentifierCipher("a".repeat(64));
let time = Date.parse("2026-10-07T12:00:00Z");
const clock: Clock = { now: () => new Date(time), sleep: async () => {} };
const service = () => createEnrichmentService(database.db, { cipher, clock: clock.now });
const denied = { code: "NOT_FOUND", statusCode: 404 };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function app() {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing synthetic fixture.");
  const id = randomUUID();
  await database.db.insert(applications).values({ ...source, id, revision: 1 });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    completedAt: clock.now(),
    completedByUserId: ids.borrower,
    currentStep: "review",
  });
  await database.db.insert(applicationParticipants).values([
    {
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.borrower,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    },
    {
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.adviser,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    },
  ]);
  return id;
}
async function identifier(
  applicationId: string,
  value = "000000001",
  extra: Record<string, unknown> = {},
) {
  return service().saveIdentifier(
    borrower,
    ids.bankA,
    applicationId,
    { expectedRevision: 0, value, ...extra },
    randomUUID(),
  );
}
function result(request: EnrichmentProviderRequest): EnrichmentResult {
  return {
    provider: "keycade-enrichment-v1",
    simulated: true,
    kind: request.kind,
    operationId: request.operationId,
    inputRevision: request.inputRevision,
    completedAt: clock.now().toISOString(),
    outcome: "complete",
    suggestions:
      request.kind === "business" ? [{ key: "entity_type", value: "Synthetic LLC" }] : [],
    taxRecords: request.kind === "tax" ? [{ year: 2025, availability: "sample_available" }] : [],
  };
}
const provider = async (request: EnrichmentProviderRequest) => result(request);
async function request(
  applicationId: string,
  revision: number,
  kind: "business" | "tax" = "business",
) {
  const view = await service().requestRun(
    borrower,
    ids.bankA,
    applicationId,
    { expectedRevision: revision, kind },
    randomUUID(),
  );
  const run = view.runs.find((run) => !run.stale && run.kind === kind);
  if (!run) throw new Error("Missing synthetic run.");
  return run;
}

describe("private identifiers and durable enrichment on PostgreSQL", () => {
  it("encrypts immutable versions and returns only masks with optimistic concurrency", async () => {
    const id = await app();
    const one = await identifier(id);
    expect(one).toMatchObject({
      revision: 1,
      identifier: { present: true, masked: "**-***0001", revision: 1 },
    });
    const [stored] = await database.db
      .select()
      .from(sensitiveIdentifierVersions)
      .where(eq(sensitiveIdentifierVersions.applicationId, id));
    expect(stored?.encryptedValue).not.toContain("000000001");
    expect(
      cipher.decrypt(stored!.encryptedValue, {
        bankId: ids.bankA,
        applicationId: id,
        subjectKey: "business",
        revision: 1,
      }),
    ).toBe("000000001");
    await expect(identifier(id, "000000002")).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const two = await identifier(id, "000000002", { expectedRevision: 1 });
    expect(two.identifier).toMatchObject({ revision: 2, masked: "**-***0002" });
    expect(
      await database.db
        .select()
        .from(sensitiveIdentifierVersions)
        .where(eq(sensitiveIdentifierVersions.applicationId, id)),
    ).toHaveLength(2);
    expect(JSON.stringify(two)).not.toContain("encrypted");
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.applicationId, id));
    expect(JSON.stringify(audits)).not.toContain('"000000001"');
    expect(JSON.stringify(audits)).not.toContain('"000000002"');
    await expect(identifier(id, "123456789", { expectedRevision: 2 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
  it("keeps owner identifiers private from applicant admins, advisers, strangers and other banks", async () => {
    const id = await app();
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Synthetic owner",
      synthetic: true,
    });
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: id,
      userId,
      role: "owner",
      scope: "assigned",
      synthetic: true,
    });
    const owner: Actor = { kind: "user", userId };
    await service().saveIdentifier(
      owner,
      ids.bankA,
      id,
      { subjectUserId: userId, expectedRevision: 0, value: "000000001" },
      randomUUID(),
    );
    expect(
      (await service().read(owner, ids.bankA, id, { subjectUserId: userId })).identifier.masked,
    ).toBe("***-**-0001");
    expect(
      (await service().read(officer, ids.bankA, id, { subjectUserId: userId })).identifier.present,
    ).toBe(true);
    for (const actor of [
      borrower,
      { kind: "user", userId: ids.adviser },
      { kind: "user", userId: ids.officerB },
      { kind: "anonymous" },
    ] as Actor[])
      await expect(
        service().read(actor, ids.bankA, id, { subjectUserId: userId }),
      ).rejects.toMatchObject(denied);
    await expect(service().read(owner, ids.bankA, id, {})).rejects.toMatchObject(denied);
    await expect(service().read(officer, ids.bankB, id, {})).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: clock.now() })
      .where(
        and(
          eq(applicationParticipants.applicationId, id),
          eq(applicationParticipants.userId, userId),
        ),
      );
    await expect(
      service().read(owner, ids.bankA, id, { subjectUserId: userId }),
    ).rejects.toMatchObject(denied);
  });
  it("requires setup and preserves waiting tax requests until both prerequisites exist", async () => {
    await expect(
      service().read(borrower, ids.bankA, ids.applicationSetupDraft, {}),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    const id = await app();
    const waiting = await request(id, 0, "tax");
    expect(waiting).toMatchObject({
      status: "waiting_for_input",
      missingPrerequisites: ["identifier", "tax_authorization"],
      result: null,
    });
    expect(await processEnrichmentRun(database.db, cipher, waiting.id, { clock, provider })).toBe(
      false,
    );
    const afterId = await identifier(id);
    expect(afterId.runs.filter((run) => !run.stale)).toMatchObject([
      { status: "waiting_for_input", missingPrerequisites: ["tax_authorization"] },
    ]);
    const authorized = await service().authorizeTax(
      borrower,
      ids.bankA,
      id,
      { expectedRevision: 1, authorized: true, noticeVersion: "demo-tax-v1" },
      randomUUID(),
    );
    const current = authorized.runs.find((run) => !run.stale)!;
    expect(current.status).toBe("queued");
    expect((await request(id, 2, "tax")).id).toBe(current.id);
    await Promise.all([
      processEnrichmentRun(database.db, cipher, current.id, { clock, provider }),
      processEnrichmentRun(database.db, cipher, current.id, { clock, provider }),
    ]);
    const completed = await service().read(borrower, ids.bankA, id, {});
    expect(completed.runs.find((run) => run.id === current.id)).toMatchObject({
      status: "succeeded",
      attempts: 1,
      result: { simulated: true, kind: "tax", outcome: "complete" },
    });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.targetId, current.id), eq(auditEvents.action, "enrichment.completed")),
      );
    expect(audits).toHaveLength(1);
  });
  it("fences results after identifier updates and preserves confirmed facts as separate stale history", async () => {
    const id = await app();
    await identifier(id);
    const run = await request(id, 1);
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const work = processEnrichmentRun(database.db, cipher, run.id, {
      clock,
      provider: async (input) => {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return result(input);
      },
    });
    await start;
    const changed = await identifier(id, "000000002", { expectedRevision: 1 });
    release();
    await work;
    expect(changed.runs.find((item) => item.id === run.id)).toMatchObject({
      stale: true,
      status: "cancelled",
      result: null,
    });
    const current = changed.runs.find((item) => !item.stale)!;
    await processEnrichmentRun(database.db, cipher, current.id, { clock, provider });
    const before = await service().read(borrower, ids.bankA, id, {});
    expect(before.confirmedFacts).toEqual([]);
    await service().confirmFact(
      borrower,
      ids.bankA,
      id,
      { expectedRevision: 2, runId: current.id, key: "entity_type" },
      randomUUID(),
    );
    await service().confirmFact(
      borrower,
      ids.bankA,
      id,
      { expectedRevision: 2, runId: current.id, key: "entity_type" },
      randomUUID(),
    );
    expect(
      await database.db
        .select()
        .from(confirmedEnrichmentFacts)
        .where(eq(confirmedEnrichmentFacts.applicationId, id)),
    ).toHaveLength(1);
    const next = await identifier(id, "000000003", { expectedRevision: 2 });
    expect(next.confirmedFacts).toMatchObject([{ value: "Synthetic LLC", stale: true }]);
    await expect(
      service().confirmFact(
        borrower,
        ids.bankA,
        id,
        { expectedRevision: 3, runId: current.id, key: "entity_type" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const [application] = await database.db
      .select()
      .from(applications)
      .where(eq(applications.id, id));
    expect(application?.businessName).not.toBe("Synthetic LLC");
  });
  it("retries transient failures, exhausts deadlines, and audits authorized manual retries", async () => {
    const id = await app();
    await identifier(id, "000000004");
    const run = await request(id, 1);
    const transient = async (input: EnrichmentProviderRequest) => {
      if (input.attempt === 1) throw new ProviderError("transient_error", true);
      return result(input);
    };
    await processEnrichmentRun(database.db, cipher, run.id, {
      clock,
      provider: transient,
      retryBaseMs: 50,
    });
    expect((await service().read(borrower, ids.bankA, id, {})).runs[0]).toMatchObject({
      status: "retry_scheduled",
      attempts: 1,
      errorCode: "transient_error",
    });
    expect(
      await processEnrichmentRun(database.db, cipher, run.id, { clock, provider: transient }),
    ).toBe(false);
    time += 50;
    await processEnrichmentRun(database.db, cipher, run.id, { clock, provider: transient });
    expect((await service().read(borrower, ids.bankA, id, {})).runs[0]).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    const timeoutId = await app();
    await identifier(timeoutId, "000000005");
    const timeout = await request(timeoutId, 1);
    for (let i = 0; i < 3; i++) {
      await processEnrichmentRun(database.db, cipher, timeout.id, {
        clock,
        retryBaseMs: 1,
        provider: async () => {
          throw new ProviderError("deadline_exceeded", true);
        },
      });
      time += 10;
    }
    expect((await service().read(borrower, ids.bankA, timeoutId, {})).runs[0]).toMatchObject({
      status: "timed_out",
      attempts: 3,
    });
    await expect(
      service().retry(
        borrower,
        ids.bankA,
        timeoutId,
        timeout.id,
        { reason: "timeout" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(denied);
    const retried = await service().retry(
      officer,
      ids.bankA,
      timeoutId,
      timeout.id,
      { reason: "timeout" },
      randomUUID(),
    );
    expect(retried.runs[0]).toMatchObject({ status: "queued", attempts: 3 });
    const [audit] = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.targetId, timeout.id), eq(auditEvents.action, "enrichment.retried")),
      );
    expect(audit?.metadata).toMatchObject({ reason: "timeout", simulated: true });
  });
  it("recovers expired claims and blocks a revoked tax authorizer before effects", async () => {
    const id = await app();
    await identifier(id);
    const run = await request(id, 1);
    await database.db
      .update(enrichmentRuns)
      .set({
        status: "running",
        attempts: 1,
        claimToken: randomUUID(),
        leaseUntil: new Date(time - 1),
      })
      .where(eq(enrichmentRuns.id, run.id));
    await processEnrichmentRun(database.db, cipher, run.id, { clock, provider });
    expect((await service().read(borrower, ids.bankA, id, {})).runs[0]).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    await service().authorizeTax(
      borrower,
      ids.bankA,
      id,
      { expectedRevision: 1, authorized: true, noticeVersion: "demo-tax-v1" },
      randomUUID(),
    );
    const tax = await request(id, 2, "tax");
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: clock.now() })
      .where(
        and(
          eq(applicationParticipants.applicationId, id),
          eq(applicationParticipants.userId, ids.borrower),
        ),
      );
    let called = false;
    await processEnrichmentRun(database.db, cipher, tax.id, {
      clock,
      provider: async (input) => {
        called = true;
        return result(input);
      },
    });
    expect(called).toBe(false);
    const view = await service().read(officer, ids.bankA, id, {});
    expect(view.taxAuthorization.authorized).toBe(false);
    expect(view.runs.find((item) => item.id === tax.id)).toMatchObject({
      status: "cancelled",
      errorCode: "no_longer_authorized",
    });
  });
  it("enforces database scope constraints for encrypted identifiers", async () => {
    const id = await app();
    await identifier(id);
    const [input] = await database.db
      .select()
      .from(enrichmentInputs)
      .where(eq(enrichmentInputs.applicationId, id));
    const other = await app();
    await identifier(other);
    const [otherInput] = await database.db
      .select()
      .from(enrichmentInputs)
      .where(eq(enrichmentInputs.applicationId, other));
    await expect(
      database.db
        .update(enrichmentInputs)
        .set({ identifierId: otherInput!.identifierId })
        .where(eq(enrichmentInputs.id, input!.id)),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(enrichmentInputs)
        .set({
          taxAuthorizedAt: clock.now(),
          taxAuthorizedByUserId: ids.borrower,
          taxNoticeVersion: null,
        })
        .where(eq(enrichmentInputs.id, input!.id)),
    ).rejects.toThrow();
  });
});
