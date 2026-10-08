import { randomUUID } from "node:crypto";
import type { CheckResult } from "@keycade/contracts";
import {
  applicationChecks,
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  auditEvents,
  businessRelationships,
  checkResolutions,
  checkRuns,
  documents,
  documentVersions,
  sensitiveIdentifierVersions,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  type Actor,
  createChecksService,
  createEnrichmentService,
  createIdentifierCipher,
  createReadinessService,
  createTasksService,
} from "@keycade/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processCheckJobs, processCheckRun } from "./check-jobs.js";
import type { CheckProviderRequest } from "./check-provider.js";
import { type Clock, ProviderError } from "./provider.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const cipher = createIdentifierCipher("b".repeat(64));
let time = Date.parse("2026-10-07T12:00:00Z");
const clock: Clock = { now: () => new Date(time), sleep: async () => {} };
const service = () => createChecksService(database.db, { cipher, clock: clock.now });
const tasks = () => createTasksService(database.db, { clock: clock.now });
const enrich = () => createEnrichmentService(database.db, { cipher, clock: clock.now });
const readiness = () => createReadinessService(database.db, { clock: clock.now });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function app(ownerCount = 0) {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing synthetic application.");
  const id = randomUUID();
  await database.db.insert(applications).values({
    ...source,
    id,
    revision: 1,
    status: "collecting_information",
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: clock.now(),
    completedByUserId: ids.borrower,
  });
  await database.db.insert(applicationParticipants).values({
    bankId: ids.bankA,
    applicationId: id,
    userId: ids.borrower,
    role: "applicant_admin",
    scope: "full",
    synthetic: true,
  });
  const owners: { userId: string; relationshipId: string; participantId: string; actor: Actor }[] =
    [];
  for (let i = 0; i < ownerCount; i++) {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `owner-${userId}@example.test`,
      displayName: `Synthetic owner ${i + 1}`,
      emailVerifiedAt: clock.now(),
      synthetic: true,
    });
    const [p] = await database.db
      .insert(applicationParticipants)
      .values({
        bankId: ids.bankA,
        applicationId: id,
        userId,
        role: "owner",
        scope: "assigned",
        synthetic: true,
      })
      .returning();
    const [o] = await database.db
      .insert(businessRelationships)
      .values({
        bankId: ids.bankA,
        applicationId: id,
        businessId: source.businessId!,
        displayName: `Synthetic owner ${i + 1}`,
        kind: "owner",
        userId,
        createdByUserId: ids.borrower,
        synthetic: true,
      })
      .returning();
    owners.push({
      userId,
      participantId: p!.id,
      relationshipId: o!.id,
      actor: { kind: "user", userId },
    });
  }
  return { id, owners };
}
async function capture(id: string, value = "000000001", actor: Actor = borrower) {
  const all = await tasks().read(actor, ids.bankA, id);
  const task = all.tasks.find(
    (t) =>
      t.inputKind ===
        (actor.kind === "user" && actor.userId === ids.borrower
          ? "synthetic_business_identifier"
          : "synthetic_personal_identifier") && t.state !== "cancelled",
  );
  if (!task?.secureInput) throw new Error("Missing private input task.");
  return service().captureIdentifier(
    actor,
    ids.bankA,
    id,
    task.id,
    { expectedRevision: task.revision, expectedInputRevision: task.secureInput.revision, value },
    randomUUID(),
  );
}
async function current(id: string, subjectUserId: string | null = null) {
  const view = await service().read(officer, ids.bankA, id);
  const check = view.checks.find((c) => c.subjectUserId === subjectUserId);
  const run = check?.runs.find((r) => r.id === check.currentRunId);
  if (!check || !run) throw new Error("Missing current check.");
  return { check, run };
}
function result(
  request: CheckProviderRequest,
  outcome: CheckResult["outcome"] = "clear",
): CheckResult {
  return {
    provider: "keycade-checks-v1",
    simulated: true,
    kind: request.kind,
    operationId: request.operationId,
    fingerprint: request.fingerprint,
    completedAt: clock.now().toISOString(),
    outcome,
    findings: [
      outcome === "clear"
        ? "synthetic_match"
        : outcome === "needs_review"
          ? "synthetic_review_flag"
          : "synthetic_no_match",
    ],
  };
}
const provider = async (request: CheckProviderRequest) => result(request);
async function run(id: string, subject: string | null = null) {
  const { run } = await current(id, subject);
  await processCheckRun(database.db, cipher, run.id, { clock, provider });
  return current(id, subject);
}
describe("identity checks and stage readiness on PostgreSQL", () => {
  it("keeps missing identifiers waiting without adding submission blockers and separates closing", async () => {
    const { id } = await app(2);
    const view = await service().read(officer, ids.bankA, id);
    expect(view.checks).toHaveLength(4);
    expect(
      view.checks.every((c) => c.stage === "approval" && c.runs[0]?.status === "waiting_for_input"),
    ).toBe(true);
    await tasks().read(borrower, ids.bankA, id);
    await database.db
      .update(applicationTasks)
      .set({ state: "completed", evidenceRevision: 1, reviewedEvidenceRevision: 1 })
      .where(and(eq(applicationTasks.applicationId, id), eq(applicationTasks.stage, "submission")));
    const gates = await readiness().read(officer, ids.bankA, id);
    expect(gates.gates.find((g) => g.stage === "submission")).toMatchObject({
      ready: true,
      blockers: [],
    });
    expect(
      gates.gates.find((g) => g.stage === "approval")?.blockers.some((b) => b.kind === "check"),
    ).toBe(true);
    expect(
      gates.gates
        .find((g) => g.stage === "submission")
        ?.blockers.some((b) => b.stage === "closing"),
    ).toBe(false);
  });
  it("isolates two private owners, encrypts capture, and prevents plaintext task mutations", async () => {
    const { id, owners } = await app(2);
    const first = owners[0]!,
      second = owners[1]!;
    const one = await tasks().read(first.actor, ids.bankA, id);
    const privateTask = one.tasks.find((t) => t.inputKind === "synthetic_personal_identifier")!;
    expect(privateTask.secureInput).toMatchObject({ identifierPresent: false, canEdit: true });
    const other = await tasks().read(second.actor, ids.bankA, id);
    expect(other.tasks.some((t) => t.id === privateTask.id)).toBe(false);
    await expect(
      service().captureIdentifier(
        second.actor,
        ids.bankA,
        id,
        privateTask.id,
        { expectedRevision: privateTask.revision, expectedInputRevision: 0, value: "000000001" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      tasks().saveAnswer(
        first.actor,
        ids.bankA,
        id,
        privateTask.id,
        { expectedRevision: privateTask.revision, answer: "confirmed" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const saved = await capture(id, "000000001", first.actor);
    expect(saved.tasks.find((t) => t.id === privateTask.id)).toMatchObject({
      state: "completed",
      secureInput: { identifierPresent: true, identifierMasked: "***-**-0001" },
    });
    const [identifier] = await database.db
      .select()
      .from(sensitiveIdentifierVersions)
      .where(
        and(
          eq(sensitiveIdentifierVersions.applicationId, id),
          eq(sensitiveIdentifierVersions.subjectKey, first.userId),
        ),
      );
    expect(identifier?.encryptedValue).not.toContain("000000001");
    expect(JSON.stringify(saved)).not.toContain("000000001");
    expect((await service().read(first.actor, ids.bankA, id)).checks).toHaveLength(1);
    expect(
      (await readiness().read(first.actor, ids.bankA, id)).gates
        .flatMap((g) => g.blockers)
        .some((b) => b.id === other.tasks[0]?.id),
    ).toBe(false);
    await expect(
      service().read({ kind: "user", userId: ids.officerB }, ids.bankA, id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("starts exactly one current run, suppresses duplicate claims and withholds staff evidence", async () => {
    const { id } = await app();
    await capture(id);
    const { check: currentCheck, run: queued } = await current(id);
    expect(queued.status).toBe("queued");
    await Promise.all([
      service().read(officer, ids.bankA, id),
      service().read(officer, ids.bankA, id),
    ]);
    let calls = 0;
    const counting = async (request: CheckProviderRequest) => {
      calls++;
      return result(request);
    };
    await Promise.all([
      processCheckRun(database.db, cipher, queued.id, { clock, provider: counting }),
      processCheckRun(database.db, cipher, queued.id, { clock, provider: counting }),
    ]);
    expect(calls).toBe(1);
    expect((await current(id)).check.passes).toBe(true);
    const borrowed = await service().read(borrower, ids.bankA, id);
    expect(
      borrowed.checks[0]?.runs.every((r) => r.evidence === null && r.resolution === null),
    ).toBe(true);
    const history = await database.db
      .select()
      .from(checkRuns)
      .where(and(eq(checkRuns.checkId, currentCheck.id), eq(checkRuns.stale, false)));
    expect(history).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.targetId, queued.id), eq(auditEvents.action, "check.completed"))),
    ).toHaveLength(1);
  });
  it("permits audited staff resolution of needs_review only and preserves the original finding", async () => {
    const { id } = await app();
    await capture(id, "000000003");
    const { check, run: queued } = await current(id);
    await processCheckRun(database.db, cipher, queued.id, {
      clock,
      provider: async (r) => result(r, "needs_review"),
    });
    expect((await current(id)).check).toMatchObject({ passes: false, canResolve: true });
    const request = { runId: queued.id, reason: "reviewed_synthetic_evidence" };
    await expect(
      service().resolve(borrower, ids.bankA, id, check.id, request, randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const resolved = await service().resolve(
      officer,
      ids.bankA,
      id,
      check.id,
      request,
      randomUUID(),
    );
    expect(resolved.checks[0]).toMatchObject({ passes: true });
    expect(resolved.checks[0]?.runs.find((r) => r.id === queued.id)).toMatchObject({
      outcome: "needs_review",
      resolved: true,
    });
    await service().resolve(officer, ids.bankA, id, check.id, request, randomUUID());
    expect(
      await database.db
        .select()
        .from(checkResolutions)
        .where(eq(checkResolutions.runId, queued.id)),
    ).toHaveLength(1);
    await capture(id, "000000002");
    const unable = await current(id);
    await processCheckRun(database.db, cipher, unable.run.id, {
      clock,
      provider: async (r) => result(r, "unable_to_verify"),
    });
    await expect(
      service().resolve(
        officer,
        ids.bankA,
        id,
        check.id,
        { ...request, runId: unable.run.id },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await current(id)).check.passes).toBe(false);
  });
  it("ignores an in-flight result after identifier replacement and retains immutable history", async () => {
    const { id } = await app();
    await capture(id);
    const { run: old } = await current(id);
    await processCheckRun(database.db, cipher, old.id, {
      clock,
      provider: async (request) => {
        await capture(id, "000000002");
        return result(request);
      },
    });
    const next = await current(id);
    expect(next.run.id).not.toBe(old.id);
    expect(next.run.status).toBe("queued");
    expect(next.check.runs.find((r) => r.id === old.id)).toMatchObject({
      stale: true,
      status: "cancelled",
      outcome: null,
    });
    await expect(
      service().retry(
        officer,
        ids.bankA,
        id,
        next.check.id,
        { runId: old.id, reason: "operator_review" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      await database.db
        .select()
        .from(sensitiveIdentifierVersions)
        .where(eq(sensitiveIdentifierVersions.applicationId, id)),
    ).toHaveLength(2);
  });
  it("freezes material identifiers/authorization and rejects results arriving after approval", async () => {
    const { id } = await app();
    await capture(id);
    const { run: pending } = await current(id);
    await processCheckRun(database.db, cipher, pending.id, {
      clock,
      provider: async (request) => {
        await database.db
          .update(applications)
          .set({ status: "approved" })
          .where(eq(applications.id, id));
        return result(request);
      },
    });
    const [stored] = await database.db.select().from(checkRuns).where(eq(checkRuns.id, pending.id));
    expect(stored).toMatchObject({ status: "cancelled", result: null });
    await expect(
      enrich().saveIdentifier(
        borrower,
        ids.bankA,
        id,
        { expectedRevision: 1, value: "000000002" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      enrich().authorizeTax(
        borrower,
        ids.bankA,
        id,
        { expectedRevision: 1, authorized: true, noticeVersion: "demo-tax-v1" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  it("requires current reviewed document versions without duplicating manual requirements", async () => {
    const { id } = await app();
    await capture(id);
    const [task] = await database.db
      .insert(applicationTasks)
      .values({
        bankId: ids.bankA,
        applicationId: id,
        stableKey: `manual:${randomUUID()}`,
        source: "manual",
        title: "Evidence",
        description: "Synthetic evidence",
        reason: "Manual review",
        stage: "approval",
        required: true,
        visibility: "shared",
        inputRevision: 1,
        state: "completed",
        evidenceRevision: 1,
        reviewedEvidenceRevision: 1,
      })
      .returning();
    const [doc] = await database.db
      .insert(documents)
      .values({
        bankId: ids.bankA,
        applicationId: id,
        taskId: task!.id,
        visibility: "shared",
        currentVersion: 1,
        createdByUserId: ids.borrower,
      })
      .returning();
    const [version] = await database.db
      .insert(documentVersions)
      .values({
        bankId: ids.bankA,
        applicationId: id,
        documentId: doc!.id,
        version: 1,
        fileName: "synthetic.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        storageKey: randomUUID(),
        uploadState: "uploaded",
        uploadedAt: clock.now(),
        scanState: "clean",
        uploadedByUserId: ids.borrower,
        keyHash: randomUUID(),
        payloadHash: "fixture",
        expiresAt: new Date(time + 10000),
      })
      .returning();
    const clear = await run(id);
    expect(clear.check.passes).toBe(true);
    await database.db.insert(documentVersions).values({
      ...version!,
      id: randomUUID(),
      version: 2,
      storageKey: randomUUID(),
      keyHash: randomUUID(),
      sha256: "b".repeat(64),
    });
    await database.db.update(documents).set({ currentVersion: 2 }).where(eq(documents.id, doc!.id));
    await database.db
      .update(applicationTasks)
      .set({ state: "open", revision: 2, evidenceRevision: 2, reviewedEvidenceRevision: null })
      .where(eq(applicationTasks.id, task!.id));
    const changed = await current(id);
    expect(changed.run.missingPrerequisites).toContain("reviewed_documents");
    expect(changed.check.passes).toBe(false);
    expect(changed.check.runs.find((r) => r.id === clear.run.id)?.stale).toBe(true);
    expect(
      await database.db
        .select()
        .from(applicationTasks)
        .where(and(eq(applicationTasks.applicationId, id), eq(applicationTasks.source, "manual"))),
    ).toHaveLength(1);
    await tasks().waive(
      officer,
      ids.bankA,
      id,
      task!.id,
      { expectedRevision: 2, reason: "Synthetic document requirement explicitly waived." },
      randomUUID(),
    );
    expect((await current(id)).run.status).toBe("queued");
  });
  it("retries transient failures, reclaims expired leases, and fails unknown provider output closed", async () => {
    const { id } = await app();
    await capture(id, "000000004");
    const { run: queued } = await current(id);
    await processCheckRun(database.db, cipher, queued.id, {
      clock,
      retryBaseMs: 10,
      provider: async () => {
        throw new ProviderError("transient_error", true);
      },
    });
    expect((await current(id)).run.status).toBe("retry_scheduled");
    time += 10;
    await database.db
      .update(checkRuns)
      .set({ status: "running", claimToken: randomUUID(), leaseUntil: new Date(time - 1) })
      .where(eq(checkRuns.id, queued.id));
    await processCheckRun(database.db, cipher, queued.id, { clock, provider });
    expect((await current(id)).run).toMatchObject({ status: "succeeded", attempts: 2 });
    await capture(id, "000000006");
    const next = await current(id);
    await processCheckRun(database.db, cipher, next.run.id, {
      clock,
      provider: async (r) => ({ ...result(r), findings: ["unknown"] }) as unknown as CheckResult,
    });
    expect((await current(id)).run).toMatchObject({
      status: "failed",
      outcome: null,
      errorCode: "terminal_error",
    });
    await service().retry(
      officer,
      ids.bankA,
      id,
      next.check.id,
      { runId: next.run.id, reason: "operator_review" },
      randomUUID(),
    );
    expect((await current(id)).run.status).toBe("queued");
  });
  it("revokes owner execution immediately and creates a fresh occurrence after removal/re-addition", async () => {
    const { id, owners } = await app(1);
    const owner = owners[0]!;
    await capture(id, "000000003", owner.actor);
    const old = await current(id, owner.userId);
    await processCheckRun(database.db, cipher, old.run.id, {
      clock,
      provider: async (request) => {
        await database.db
          .update(applicationParticipants)
          .set({ revokedAt: clock.now(), unassignedAt: clock.now() })
          .where(eq(applicationParticipants.id, owner.participantId));
        return result(request);
      },
    });
    expect(
      (await database.db.select().from(checkRuns).where(eq(checkRuns.id, old.run.id)))[0]?.status,
    ).toBe("cancelled");
    await expect(service().read(owner.actor, ids.bankA, id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await database.db
      .update(businessRelationships)
      .set({ removedAt: clock.now() })
      .where(eq(businessRelationships.id, owner.relationshipId));
    await service().read(officer, ids.bankA, id);
    expect(
      (
        await database.db
          .select()
          .from(applicationChecks)
          .where(eq(applicationChecks.id, old.check.id))
      )[0]?.active,
    ).toBe(false);
    time += 1;
    await database.db
      .update(businessRelationships)
      .set({ removedAt: null, updatedAt: clock.now() })
      .where(eq(businessRelationships.id, owner.relationshipId));
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, owner.participantId));
    const next = await current(id, owner.userId);
    expect(next.run.id).not.toBe(old.run.id);
    expect(next.check.passes).toBe(false);
  });
  it("enforces scoped identifier references and startup reconciliation without exposing raw inputs", async () => {
    const a = await app(),
      b = await app();
    await capture(a.id);
    await capture(b.id);
    const first = await current(a.id);
    const [foreign] = await database.db
      .select()
      .from(sensitiveIdentifierVersions)
      .where(eq(sensitiveIdentifierVersions.applicationId, b.id));
    await expect(
      database.db
        .update(checkRuns)
        .set({ identifierId: foreign!.id })
        .where(eq(checkRuns.id, first.run.id)),
    ).rejects.toThrow();
    await processCheckJobs(database.db, cipher, { clock, provider });
    const audit = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.applicationId, a.id));
    expect(
      JSON.stringify(
        audit.map((event) => ({ metadata: event.metadata, changedFields: event.changedFields })),
      ),
    ).not.toContain("000000001");
  });
  it("can clear approval without letting a later closing task block the earlier gate", async () => {
    const { id } = await app();
    await capture(id);
    await run(id);
    const all = await tasks().read(officer, ids.bankA, id);
    for (const task of all.tasks)
      if (task.required && task.stage !== "closing" && task.state === "open")
        await tasks().waive(
          officer,
          ids.bankA,
          id,
          task.id,
          {
            expectedRevision: task.revision,
            reason: "Explicit synthetic policy waiver for this occurrence.",
          },
          randomUUID(),
        );
    await database.db
      .update(applications)
      .set({ status: "in_review", revision: 2 })
      .where(eq(applications.id, id));
    const view = await readiness().read(officer, ids.bankA, id);
    expect(view.gates.find((g) => g.stage === "approval")).toMatchObject({
      ready: true,
      blockers: [],
    });
    expect(view.gates.find((g) => g.stage === "closing")?.ready).toBe(false);
    expect((await current(id)).check.passes).toBe(true);
  });
  it("requires explicit tax consent and reopens its receipt after identifier replacement", async () => {
    const { id } = await app();
    let view = await tasks().read(borrower, ids.bankA, id);
    let task = view.tasks.find((t) => t.inputKind === "tax_authorization")!;
    await expect(
      service().authorizeTax(
        borrower,
        ids.bankA,
        id,
        task.id,
        {
          expectedRevision: task.revision,
          expectedInputRevision: 0,
          authorized: true,
          noticeVersion: "demo-tax-v1",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    view = await capture(id);
    task = view.tasks.find((t) => t.inputKind === "tax_authorization")!;
    view = await service().authorizeTax(
      borrower,
      ids.bankA,
      id,
      task.id,
      {
        expectedRevision: task.revision,
        expectedInputRevision: task.secureInput!.revision,
        authorized: true,
        noticeVersion: "demo-tax-v1",
      },
      randomUUID(),
    );
    expect(view.tasks.find((t) => t.id === task.id)).toMatchObject({
      state: "completed",
      secureInput: { taxAuthorized: true },
    });
    const enriched = await enrich().read(borrower, ids.bankA, id);
    expect(enriched.runs.find((r) => r.kind === "tax" && !r.stale)?.status).toBe("queued");
    view = await capture(id, "000000002");
    expect(view.tasks.find((t) => t.id === task.id)).toMatchObject({
      state: "open",
      secureInput: { taxAuthorized: false },
    });
  });
  it("exhausts timeout retries and fences a response whose worker lease expired", async () => {
    const { id } = await app();
    await capture(id, "000000005");
    const initial = await current(id);
    for (let i = 0; i < 3; i++) {
      await processCheckRun(database.db, cipher, initial.run.id, {
        clock,
        retryBaseMs: 1,
        provider: async () => {
          throw new ProviderError("deadline_exceeded", true);
        },
      });
      time += 10;
    }
    expect((await current(id)).run).toMatchObject({ status: "timed_out", attempts: 3 });
    await service().retry(
      officer,
      ids.bankA,
      id,
      initial.check.id,
      { runId: initial.run.id, reason: "timeout" },
      randomUUID(),
    );
    await processCheckRun(database.db, cipher, initial.run.id, {
      clock,
      deadlineMs: 1,
      provider: async (request) => {
        time += 30_002;
        return result(request);
      },
    });
    expect((await current(id)).run).toMatchObject({ status: "running", outcome: null });
    await processCheckRun(database.db, cipher, initial.run.id, { clock, provider });
    expect((await current(id)).check.passes).toBe(true);
  });
  it("starts a fresh generation when material facts return to an earlier value", async () => {
    const { id } = await app();
    await capture(id);
    const original = await run(id);
    const [source] = await database.db.select().from(applications).where(eq(applications.id, id));
    await database.db
      .update(applications)
      .set({ businessName: "Another synthetic business", revision: 2 })
      .where(eq(applications.id, id));
    const middle = await current(id);
    expect(middle.run.id).not.toBe(original.run.id);
    await database.db
      .update(applications)
      .set({ businessName: source!.businessName, revision: 3 })
      .where(eq(applications.id, id));
    const restored = await current(id);
    expect(restored.run.id).not.toBe(original.run.id);
    expect(restored.run.status).toBe("queued");
    expect(restored.check.passes).toBe(false);
    expect(restored.check.runs.find((r) => r.id === original.run.id)).toMatchObject({
      status: "succeeded",
      stale: true,
    });
  });
  it("does not accept unaudited waiver rows as authoritative gate evidence", async () => {
    const { id } = await app();
    await tasks().read(officer, ids.bankA, id);
    await database.db
      .update(applicationTasks)
      .set({ state: "waived" })
      .where(and(eq(applicationTasks.applicationId, id), eq(applicationTasks.stage, "submission")));
    const view = await readiness().read(officer, ids.bankA, id);
    expect(
      view.gates
        .find((g) => g.stage === "submission")
        ?.blockers.some((b) => b.reason === "waiver_not_current"),
    ).toBe(true);
  });
});
