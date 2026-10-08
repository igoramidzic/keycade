import { randomUUID } from "node:crypto";
import type { BusinessAddress, CheckResult } from "@keycade/contracts";
import {
  applicationChecks,
  applicationSetups,
  applications,
  auditEvents,
  checkRuns,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  type Actor,
  createApplicationService,
  createChecksService,
  createIdentifierCipher,
  createReadinessService,
  reconcileFootprint,
} from "@keycade/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processCheckRun } from "./check-jobs.js";
import { type CheckProviderRequest, evaluateFootprint } from "./check-provider.js";
import { type Clock, ProviderError } from "./provider.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const cipher = createIdentifierCipher("c".repeat(64));
const officer: Actor = { kind: "user", userId: ids.officerA };
const now = new Date("2026-10-08T15:00:00Z");
const clock: Clock = { now: () => now, sleep: async () => {} };
const address: BusinessAddress = {
  line1: "123 Synthetic Avenue",
  locality: "Portland",
  region: "ME",
  postalCode: "04101",
  countryCode: "US",
};
const checks = () => createChecksService(database.db, { cipher, clock: clock.now });
const readiness = () => createReadinessService(database.db, { clock: clock.now });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function fixture(
  status: typeof applications.$inferSelect.status = "collecting_information",
  value: BusinessAddress | null = address,
) {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing synthetic fixture");
  const id = randomUUID();
  await database.db.insert(applications).values({
    ...source,
    id,
    status,
    businessAddress: value,
    businessAddressRevision: value ? 1 : 0,
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: now,
    completedByUserId: ids.borrower,
  });
  return id;
}
async function current(id: string) {
  const view = await checks().read(officer, ids.bankA, id);
  const check = view.checks.find((c) => c.kind === "loan_footprint")!;
  const run = check.runs.find((r) => r.id === check.currentRunId)!;
  expect(run).toBeDefined();
  return { check, run };
}
async function provider(request: CheckProviderRequest): Promise<CheckResult> {
  if (!request.footprintInput) throw new Error("Missing address snapshot");
  const footprint = evaluateFootprint(request.footprintInput);
  const outcome =
    footprint.reason === "inside_us_demo"
      ? "clear"
      : footprint.reason === "outside_us_demo"
        ? "needs_review"
        : "unable_to_verify";
  return {
    provider: "keycade-checks-v1",
    simulated: true,
    kind: "loan_footprint",
    operationId: request.operationId,
    fingerprint: request.fingerprint,
    completedAt: now.toISOString(),
    outcome,
    footprint,
    findings: [
      outcome === "clear"
        ? "synthetic_match"
        : outcome === "needs_review"
          ? "synthetic_review_flag"
          : "synthetic_no_match",
    ],
  };
}
async function complete(id: string) {
  const { run } = await current(id);
  let calls = 0;
  const once = async (request: CheckProviderRequest) => {
    calls++;
    return provider(request);
  };
  await Promise.all([
    processCheckRun(database.db, cipher, run.id, { clock, provider: once }),
    processCheckRun(database.db, cipher, run.id, { clock, provider: once }),
  ]);
  expect(calls).toBe(1);
  return current(id);
}
describe("Loan Footprint persistence and asynchronous generations", () => {
  it.each([
    "draft",
    "collecting_information",
    "needs_information",
    "submitted",
    "in_review",
    "approved",
    "closing",
    "funded",
    "declined",
    "withdrawn",
  ] as const)("is informational and asynchronously refreshable for %s", async (status) => {
    const id = await fixture(status);
    const before = await current(id);
    const gates = await readiness().read(officer, ids.bankA, id);
    const completed = await complete(id);
    expect(completed.check).toMatchObject({
      required: false,
      passes: true,
      canResolve: false,
      canRefresh: true,
    });
    expect(completed.run.evidence?.footprint).toMatchObject({
      addressRevision: 1,
      address,
      coordinates: { source: "registered_synthetic_fixture" },
    });
    expect((await readiness().read(officer, ids.bankA, id)).gates).toEqual(gates.gates);
    const body = { runId: before.run.id, expectedAddressRevision: 1 };
    const [first, replay] = await Promise.all([
      checks().refresh(officer, ids.bankA, id, before.check.id, body, randomUUID()),
      checks().refresh(officer, ids.bankA, id, before.check.id, body, randomUUID()),
    ]);
    expect(first).toEqual(replay);
    const refreshed = await current(id);
    expect(refreshed.run.id).not.toBe(before.run.id);
    expect(refreshed.check).toMatchObject({ passes: false, canRefresh: false });
    expect(refreshed.run).toMatchObject({ status: "queued", evidence: null });
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.applicationId, id), eq(auditEvents.action, "check.refreshed"))),
    ).toHaveLength(1);
  });
  it("creates address-bound intent atomically with a staff draft, without a check read", async () => {
    const service = createApplicationService(database.db, { clock: clock.now });
    const draft = await service.create(
      officer,
      ids.bankA,
      {
        email: `footprint-${randomUUID()}@example.test`,
        answers: { businessAddress: address },
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const rows = await database.db
      .select()
      .from(checkRuns)
      .where(eq(checkRuns.applicationId, draft.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "queued",
      footprintInput: { addressRevision: 1, address },
    });
  });
  it.each([null, { ...address, countryCode: "" }, { ...address, locality: " " }])(
    "keeps absent or invalid addresses waiting: %o",
    async (value) => {
      const id = await fixture("collecting_information", value);
      const { check, run } = await current(id);
      expect(check).toMatchObject({ passes: false, canRefresh: false, canResolve: false });
      expect(run).toMatchObject({
        status: "waiting_for_input",
        outcome: null,
        evidence: null,
        missingPrerequisites: ["business_address"],
      });
      expect(await processCheckRun(database.db, cipher, run.id, { clock, provider })).toBe(false);
    },
  );
  it("rolls address, stale claim and queued intent back together", async () => {
    const id = await fixture();
    const original = await complete(id);
    await expect(
      database.db.transaction(async (tx) => {
        const [app] = await tx
          .update(applications)
          .set({ businessAddress: { ...address, countryCode: "CA" }, businessAddressRevision: 2 })
          .where(eq(applications.id, id))
          .returning();
        await reconcileFootprint(tx, app!, randomUUID(), now);
        throw new Error("Injected rollback");
      }),
    ).rejects.toThrow("Injected rollback");
    expect(await current(id)).toEqual(original);
  });
  it("rejects a forged coordinate and never turns provider failure into clear", async () => {
    const id = await fixture();
    const { run } = await current(id);
    await processCheckRun(database.db, cipher, run.id, {
      clock,
      provider: async (request) => {
        const result = await provider(request);
        result.footprint!.coordinates!.latitude = 1;
        return result;
      },
    });
    expect((await current(id)).run).toMatchObject({
      status: "failed",
      outcome: null,
      evidence: null,
      errorCode: "terminal_error",
    });
    const { check } = await current(id);
    await checks().refresh(
      officer,
      ids.bankA,
      id,
      check.id,
      { runId: run.id, expectedAddressRevision: 1 },
      randomUUID(),
    );
    const retry = await current(id);
    await processCheckRun(database.db, cipher, retry.run.id, {
      clock,
      provider: async () => {
        throw new ProviderError("deadline_exceeded", false);
      },
    });
    expect((await current(id)).run).toMatchObject({
      status: "timed_out",
      outcome: null,
      evidence: null,
    });
  });
  it("enforces informational policy and cross-application refresh foreign keys in PostgreSQL", async () => {
    const id = await fixture();
    const own = await current(id);
    await expect(
      database.db
        .update(applicationChecks)
        .set({ required: true })
        .where(eq(applicationChecks.id, own.check.id)),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(applicationChecks)
        .set({ allowReviewResolution: true })
        .where(eq(applicationChecks.id, own.check.id)),
    ).rejects.toThrow();
    const other = await current(await fixture());
    await expect(
      database.db
        .update(checkRuns)
        .set({ refreshOfRunId: other.run.id })
        .where(eq(checkRuns.id, own.run.id)),
    ).rejects.toThrow();
  });
});
