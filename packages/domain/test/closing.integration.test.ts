import { randomUUID } from "node:crypto";
import {
  applicationClosingPackages,
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  auditEvents,
  bankMemberships,
  businesses,
  checkRuns,
  closingCommands,
  documentVersions,
  fundingRecords,
  loanAccounts,
  notifications,
  productClosingPolicies,
  signatureArtifacts,
  signatureEnvelopes,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createChecksService,
  createClosingService,
  createDocumentsService,
  createIdentifierCipher,
  createReviewService,
  createSignaturesService,
  createTasksService,
  defaultClosingConditions,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const now = new Date("2026-10-07T12:00:00Z");
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const other: Actor = { kind: "user", userId: ids.officerB };
const closing = () => createClosingService(database.db, { clock: () => now });
const tasks = () => createTasksService(database.db, { clock: () => now });
const review = () => createReviewService(database.db, { clock: () => now });
const signatures = () => createSignaturesService(database.db, { clock: () => now });
const documents = () => createDocumentsService(database.db, { clock: () => now });
const command = (expectedRevision: number) => ({ expectedRevision, idempotencyKey: randomUUID() });
const funding = (expectedRevision: number) => ({
  ...command(expectedRevision),
  humanFundingConfirmed: true as const,
  fundedAmount: "10000.00",
  fundedOn: "2026-10-07",
  reference: "DEMO-FUNDING",
});
const denied = { code: "NOT_FOUND", statusCode: 404 };
const invalid = { code: "INVALID_STATE", statusCode: 409 };
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function fixture() {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("missing seed");
  const id = randomUUID();
  await database.db.insert(applications).values({
    ...source,
    id,
    status: "collecting_information",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: now,
    completedByUserId: ids.borrower,
  });
  const [participant] = await database.db
    .insert(applicationParticipants)
    .values({
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.borrower,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    })
    .returning();
  return { id, participant: participant! };
}
async function approve(id: string) {
  for (const task of (await tasks().read(officer, ids.bankA, id)).tasks.filter(
    (t) => t.required && t.inputKind === "answer" && t.stage !== "closing",
  ))
    await tasks().waive(
      officer,
      ids.bankA,
      id,
      task.id,
      { expectedRevision: task.revision, reason: "Audited synthetic fixture" },
      randomUUID(),
    );
  const checks = createChecksService(database.db, {
    cipher: createIdentifierCipher("cc".repeat(32)),
    clock: () => now,
  });
  const task = (await tasks().read(borrower, ids.bankA, id)).tasks.find(
    (t) => t.inputKind === "synthetic_business_identifier",
  );
  if (!task?.secureInput) throw new Error("missing identifier input");
  await checks.captureIdentifier(
    borrower,
    ids.bankA,
    id,
    task.id,
    {
      expectedRevision: task.revision,
      expectedInputRevision: task.secureInput.revision,
      value: "000000001",
    },
    randomUUID(),
  );
  for (const check of (await checks.read(officer, ids.bankA, id)).checks) {
    const [run] = await database.db
      .select()
      .from(checkRuns)
      .where(eq(checkRuns.id, check.currentRunId!));
    if (!run) throw new Error("missing run");
    // The fake provider's deterministic clear outcome is already covered by its integration suite.
    await database.db
      .update(checkRuns)
      .set({
        status: "succeeded",
        result: {
          provider: "keycade-checks-v1",
          simulated: true,
          kind: check.kind,
          operationId: run.id,
          fingerprint: run.fingerprint,
          completedAt: now.toISOString(),
          outcome: "clear",
          findings: ["synthetic_match"],
        },
      })
      .where(eq(checkRuns.id, run.id));
  }
  let v = await review().read(officer, ids.bankA, id);
  v = await review().submit(borrower, ids.bankA, id, command(v.revision), randomUUID());
  v = await review().startReview(officer, ids.bankA, id, command(v.revision), randomUUID());
  return review().approve(
    officer,
    ids.bankA,
    id,
    {
      ...command(v.revision),
      humanDecisionConfirmed: true,
      reasonCode: "demo_criteria_met",
      approvedAmount: "10000.00",
    },
    randomUUID(),
  );
}
async function started() {
  const f = await fixture();
  const approved = await approve(f.id);
  const input = command(approved.revision);
  const view = await closing().startClosing(officer, ids.bankA, f.id, input, randomUUID());
  return { ...f, view, input };
}
async function acknowledge(id: string) {
  const task = (await tasks().read(officer, ids.bankA, id)).tasks.find(
    (t) => t.stableKey === "funding-confirmation:application",
  );
  if (!task) throw new Error("missing confirmation");
  await tasks().waive(
    officer,
    ids.bankA,
    id,
    task.id,
    { expectedRevision: task.revision, reason: "Staff confirmed synthetic funding notice" },
    randomUUID(),
  );
}
async function envelope(id: string, participantId: string, two = true) {
  const task = (await closing().read(officer, ids.bankA, id)).conditions.find(
    (c) => c.kind === "signature",
  );
  if (!task) throw new Error("missing signature task");
  const secondId = randomUUID();
  await database.db.insert(users).values({
    id: secondId,
    email: `synthetic-${secondId}@example.test`,
    displayName: "Synthetic second signer",
    emailVerifiedAt: now,
    synthetic: true,
  });
  const [second] = await database.db
    .insert(applicationParticipants)
    .values({
      bankId: ids.bankA,
      applicationId: id,
      userId: secondId,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    })
    .returning();
  const source = await documents().beginUpload(
    officer,
    ids.bankA,
    id,
    {
      fileName: "Synthetic closing agreement.pdf",
      mimeType: "application/pdf",
      expectedSize: 100,
      idempotencyKey: randomUUID(),
      taskId: task.taskId,
    },
    randomUUID(),
  );
  await documents().finalizeUpload(
    officer,
    ids.bankA,
    id,
    source.uploadId,
    { size: 100, sha256: "a".repeat(64) },
    randomUUID(),
  );
  await database.db
    .update(documentVersions)
    .set({ scanState: "clean", scannedAt: now })
    .where(eq(documentVersions.id, source.versionId));
  const result = await signatures().create(
    officer,
    ids.bankA,
    id,
    {
      taskId: task.taskId,
      sourceVersionId: source.versionId,
      signerParticipantIds: two ? [participantId, second!.id] : [participantId],
      idempotencyKey: randomUUID(),
    },
    randomUUID(),
  );
  const e = result.envelopes.find((e) => e.taskId === task.taskId)!;
  await signatures().send(officer, ids.bankA, id, e.id, randomUUID());
  // Provider delivery is tested separately; user actions below exercise real signature completion/artifact transactions.
  await database.db
    .update(signatureEnvelopes)
    .set({ state: "sent", deliveryStatus: "sent", providerEnvelopeId: `demo:${e.id}` })
    .where(eq(signatureEnvelopes.id, e.id));
  return {
    id: e.id,
    second: second!,
    secondActor: { kind: "user", userId: secondId } as Actor,
    source,
    taskId: task.taskId,
  };
}
async function ready() {
  const f = await started();
  await acknowledge(f.id);
  const e = await envelope(f.id, f.participant.id);
  await signatures().act(borrower, ids.bankA, f.id, e.id, { action: "sign" }, randomUUID());
  await signatures().act(e.secondActor, ids.bankA, f.id, e.id, { action: "sign" }, randomUUID());
  return { ...f, envelope: e, view: await closing().read(officer, ids.bankA, f.id) };
}
async function rows(id: string) {
  return {
    funding: await database.db
      .select()
      .from(fundingRecords)
      .where(eq(fundingRecords.applicationId, id)),
    accounts: await database.db
      .select()
      .from(loanAccounts)
      .where(eq(loanAccounts.applicationId, id)),
    commands: await database.db
      .select()
      .from(closingCommands)
      .where(eq(closingCommands.applicationId, id)),
  };
}
describe("approved closing and immutable simulated funding", () => {
  it("evaluates a two-signer artifact once per view and refreshes current grants on the next read", async () => {
    const f = await ready();
    const queries: string[] = [];
    const measured = drizzle(database.pool, {
      schema: database.db._.fullSchema,
      logger: { logQuery: (query) => queries.push(query) },
    });
    const service = createClosingService(measured, { clock: () => now });
    const countFrom = (table: string) =>
      queries.filter((query) => query.includes(`from "${table}"`)).length;
    const current = await service.read(officer, ids.bankA, f.id);
    expect(current.capabilities.recordFunding).toBe(true);
    expect(current.conditions.find((c) => c.kind === "signature")?.passes).toBe(true);
    expect(current.readiness.gates.find((g) => g.stage === "closing")?.ready).toBe(true);
    // The same artifact governs conditions and readiness. Rechecking it used to
    // multiply the full source and live signer authorization queries three times.
    expect(countFrom("signature_envelopes")).toBe(1);
    expect(countFrom("users")).toBe(2);
    expect(countFrom("closing_conditions")).toBe(1);
    expect(countFrom("application_closing_packages")).toBe(1);

    queries.length = 0;
    const reviewed = await createReviewService(measured, { clock: () => now }).read(
      officer,
      ids.bankA,
      f.id,
    );
    expect(reviewed.readiness.gates.find((g) => g.stage === "closing")?.ready).toBe(true);
    expect(countFrom("signature_envelopes")).toBe(1);
    expect(countFrom("users")).toBe(2);

    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, f.envelope.second.id));
    const revoked = await service.read(officer, ids.bankA, f.id);
    expect(revoked.capabilities.recordFunding).toBe(false);
    expect(revoked.conditions.find((c) => c.kind === "signature")?.passes).toBe(false);
    await expect(
      service.recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    expect((await rows(f.id)).funding).toHaveLength(0);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, f.envelope.second.id));
    queries.length = 0;
    const funded = await service.recordFunding(
      officer,
      ids.bankA,
      f.id,
      funding(f.view.revision),
      randomUUID(),
    );
    expect(funded.status).toBe("funded");
    // The mutation's gate and its post-write response each need a fresh evaluation.
    expect(countFrom("signature_envelopes")).toBe(2);
  });
  it("starts explicitly from approved terms, pins policy, and prevents generic completion of mandatory signatures", async () => {
    const f = await started();
    expect(f.view).toMatchObject({
      status: "closing",
      simulated: true,
      approvedTerms: { approvedAmount: "10000.00", requestedAmount: "10000.00" },
      package: { revision: 1, policyVersion: 1 },
      capabilities: { startClosing: false, recordFunding: false },
    });
    expect(f.view.conditions).toHaveLength(2);
    const blockers = f.view.readiness.gates.find((g) => g.stage === "closing")!.blockers;
    for (const condition of f.view.conditions)
      expect(blockers.filter((b) => b.kind === "task" && b.id === condition.taskId)).toHaveLength(
        1,
      );
    expect(
      (await closing().startClosing(officer, ids.bankA, f.id, f.input, randomUUID())).package?.id,
    ).toBe(f.view.package?.id);
    const signature = (await tasks().read(officer, ids.bankA, f.id)).tasks.find(
      (t) => t.title === "Sign simulated closing agreement",
    )!;
    expect(signature).toMatchObject({
      inputKind: "signature",
      canEdit: false,
      canReview: false,
      canSubmit: false,
    });
    await expect(
      tasks().waive(
        officer,
        ids.bankA,
        f.id,
        signature.id,
        { expectedRevision: signature.revision, reason: "Cannot waive a signature" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(invalid);
    await expect(
      tasks().saveAnswer(
        borrower,
        ids.bankA,
        f.id,
        signature.id,
        { expectedRevision: signature.revision, answer: "confirmed" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(invalid);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    const [app] = await database.db.select().from(applications).where(eq(applications.id, f.id));
    await database.db.insert(productClosingPolicies).values({
      bankId: ids.bankA,
      productId: app!.productId!,
      version: 2,
      amountPolicy: "exact_approved_amount",
      conditions: defaultClosingConditions.map((c) => ({ ...c, title: `Future ${c.title}` })),
    });
    expect((await closing().read(officer, ids.bankA, f.id)).conditions).toEqual(f.view.conditions);
    await database.db
      .delete(productClosingPolicies)
      .where(
        and(
          eq(productClosingPolicies.productId, app!.productId!),
          eq(productClosingPolicies.version, 2),
        ),
      );
  });
  it("requires every intended signer and records one exact funding/account with immutable business terms", async () => {
    const f = await started();
    await acknowledge(f.id);
    const e = await envelope(f.id, f.participant.id);
    await signatures().act(borrower, ids.bankA, f.id, e.id, { action: "sign" }, randomUUID());
    expect((await closing().read(officer, ids.bankA, f.id)).capabilities.recordFunding).toBe(false);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    await signatures().act(e.secondActor, ids.bankA, f.id, e.id, { action: "sign" }, randomUUID());
    const current = await closing().read(officer, ids.bankA, f.id);
    expect(current.capabilities.recordFunding).toBe(true);
    const input = funding(current.revision);
    const funded = await closing().recordFunding(officer, ids.bankA, f.id, input, randomUUID());
    expect(funded).toMatchObject({
      status: "funded",
      capabilities: { recordFunding: false },
      account: {
        approvedAmount: "10000.00",
        fundedAmount: "10000.00",
        currency: "USD",
        simulated: true,
        fundedOn: "2026-10-07",
        reference: "DEMO-FUNDING",
      },
    });
    expect(funded.conditions.every((c) => c.passes)).toBe(true);
    expect(
      (await closing().recordFunding(officer, ids.bankA, f.id, input, randomUUID())).account?.id,
    ).toBe(funded.account?.id);
    await expect(
      closing().recordFunding(
        officer,
        ids.bankA,
        f.id,
        { ...input, reference: "altered" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const stored = await rows(f.id);
    expect(stored.funding).toHaveLength(1);
    expect(stored.accounts).toHaveLength(1);
    expect(stored.commands).toHaveLength(2);
    expect(stored.funding[0]?.evidence.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "signature",
          passes: true,
          artifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      ]),
    );
    expect(
      await database.db
        .select()
        .from(signatureArtifacts)
        .where(eq(signatureArtifacts.envelopeId, e.id)),
    ).toHaveLength(1);
    const original = funded.account!.businessName;
    await database.db
      .update(businesses)
      .set({ legalName: "Synthetic renamed live business" })
      .where(eq(businesses.id, funded.account!.businessId));
    expect((await closing().read(borrower, ids.bankA, f.id)).account?.businessName).toBe(original);
    expect(
      (await closing().listAccounts(borrower, ids.bankA)).accounts.find(
        (a) => a.applicationId === f.id,
      )?.businessName,
    ).toBe(original);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.applicationId, f.id),
            eq(auditEvents.action, "application.funding_recorded"),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.applicationId, f.id), eq(notifications.kind, "status_changed")),
        ),
    ).not.toHaveLength(0);
  });
  it("rejects lifecycle skips, borrower/cross-bank actions, stale revisions and changed approved facts", async () => {
    const f = await fixture();
    await expect(
      closing().startClosing(officer, ids.bankA, f.id, command(1), randomUUID()),
    ).rejects.toMatchObject(invalid);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(1), randomUUID()),
    ).rejects.toMatchObject(invalid);
    const approved = await approve(f.id);
    await expect(
      closing().startClosing(borrower, ids.bankA, f.id, command(approved.revision), randomUUID()),
    ).rejects.toMatchObject(denied);
    await expect(closing().read(other, ids.bankA, f.id)).rejects.toMatchObject(denied);
    await expect(
      closing().startClosing(
        officer,
        ids.bankA,
        f.id,
        command(approved.revision - 1),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await database.db
      .update(applications)
      .set({ purpose: "Changed without a new decision" })
      .where(eq(applications.id, f.id));
    await expect(
      closing().startClosing(officer, ids.bankA, f.id, command(approved.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    expect(await rows(f.id)).toEqual({ funding: [], accounts: [], commands: [] });
  });
  it("enforces exact amount, date bounds and explicit human confirmation before any writes", async () => {
    const f = await ready();
    expect(f.view.capabilities.recordFunding).toBe(true);
    const input = funding(f.view.revision);
    for (const patch of [
      { fundedAmount: "9999.99" },
      { fundedAmount: "10000.01" },
      { fundedOn: "2026-10-06" },
      { fundedOn: "2026-10-08" },
    ])
      await expect(
        closing().recordFunding(officer, ids.bankA, f.id, { ...input, ...patch }, randomUUID()),
      ).rejects.toMatchObject(invalid);
    for (const patch of [
      { fundedOn: "2026-02-30" },
      { humanFundingConfirmed: false },
      { reference: "  " },
      { fundedAmount: "1e4" },
    ])
      await expect(
        closing().recordFunding(officer, ids.bankA, f.id, { ...input, ...patch }, randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await rows(f.id)).funding).toEqual([]);
  });
  it("ignores stale signed evidence after source replacement and revoked signer access", async () => {
    const f = await ready();
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, f.envelope.second.id));
    expect((await closing().read(officer, ids.bankA, f.id)).capabilities.recordFunding).toBe(false);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: null })
      .where(eq(applicationParticipants.id, f.envelope.second.id));
    const replacement = await documents().beginUpload(
      officer,
      ids.bankA,
      f.id,
      {
        replacesDocumentId: f.envelope.source.documentId,
        fileName: "Replacement synthetic agreement.pdf",
        mimeType: "application/pdf",
        expectedSize: 100,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    await documents().finalizeUpload(
      officer,
      ids.bankA,
      f.id,
      replacement.uploadId,
      { size: 100, sha256: "b".repeat(64) },
      randomUUID(),
    );
    expect((await closing().read(officer, ids.bankA, f.id)).capabilities.recordFunding).toBe(false);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
  });
  it("rechecks current approval, check outcomes and the persisted signed artifact at funding", async () => {
    const f = await ready();
    const [run] = await database.db
      .select()
      .from(checkRuns)
      .where(and(eq(checkRuns.applicationId, f.id), eq(checkRuns.stale, false)));
    const original = run!.result!;
    await database.db
      .update(checkRuns)
      .set({ result: { ...original, outcome: "needs_review" } })
      .where(eq(checkRuns.id, run!.id));
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    await database.db.update(checkRuns).set({ result: original }).where(eq(checkRuns.id, run!.id));
    const [app] = await database.db.select().from(applications).where(eq(applications.id, f.id));
    await database.db
      .update(applications)
      .set({ purpose: "Changed after approval" })
      .where(eq(applications.id, f.id));
    expect((await closing().read(officer, ids.bankA, f.id)).capabilities.recordFunding).toBe(false);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    await database.db
      .update(applications)
      .set({ purpose: app!.purpose })
      .where(eq(applications.id, f.id));
    await database.db
      .delete(signatureArtifacts)
      .where(eq(signatureArtifacts.envelopeId, f.envelope.id));
    expect((await closing().read(officer, ids.bankA, f.id)).capabilities.recordFunding).toBe(false);
    await expect(
      closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID()),
    ).rejects.toMatchObject(invalid);
    expect((await rows(f.id)).funding).toEqual([]);
  });
  it("serializes concurrent funding commands and rejects replay by a newly unauthorized actor", async () => {
    const f = await ready();
    const input = funding(f.view.revision);
    const results = await Promise.allSettled([
      closing().recordFunding(officer, ids.bankA, f.id, input, randomUUID()),
      closing().recordFunding(
        officer,
        ids.bankA,
        f.id,
        { ...input, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await rows(f.id)).funding).toHaveLength(1);
    expect((await rows(f.id)).accounts).toHaveLength(1);
    await database.db
      .update(bankMemberships)
      .set({ revokedAt: now })
      .where(and(eq(bankMemberships.bankId, ids.bankA), eq(bankMemberships.userId, ids.officerA)));
    try {
      await expect(
        closing().recordFunding(officer, ids.bankA, f.id, input, randomUUID()),
      ).rejects.toMatchObject(denied);
    } finally {
      await database.db
        .update(bankMemberships)
        .set({ revokedAt: null })
        .where(
          and(eq(bankMemberships.bankId, ids.bankA), eq(bankMemberships.userId, ids.officerA)),
        );
    }
  });
  it("rolls back the funding event, lifecycle, command and notification when account creation fails", async () => {
    const f = await ready();
    const input = funding(f.view.revision);
    const before = (
      await database.db.select().from(notifications).where(eq(notifications.applicationId, f.id))
    ).length;
    await database.pool.query(
      "CREATE FUNCTION reject_test_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic account insert failure'; END $$",
    );
    await database.pool.query(
      "CREATE TRIGGER reject_test_account BEFORE INSERT ON loan_accounts FOR EACH ROW EXECUTE FUNCTION reject_test_account()",
    );
    try {
      await expect(
        closing().recordFunding(officer, ids.bankA, f.id, input, randomUUID()),
      ).rejects.toThrow();
    } finally {
      await database.pool.query("DROP TRIGGER reject_test_account ON loan_accounts");
      await database.pool.query("DROP FUNCTION reject_test_account()");
    }
    const stored = await rows(f.id);
    expect(stored.funding).toEqual([]);
    expect(stored.accounts).toEqual([]);
    expect(stored.commands).toHaveLength(1);
    expect((await closing().read(officer, ids.bankA, f.id)).status).toBe("closing");
    expect(
      (await database.db.select().from(notifications).where(eq(notifications.applicationId, f.id)))
        .length,
    ).toBe(before);
    expect(
      (await closing().recordFunding(officer, ids.bankA, f.id, input, randomUUID())).status,
    ).toBe("funded");
  });
  it("lists immutable accounts only for current full applicant admins and scoped bank staff", async () => {
    const f = await ready();
    const funded = await closing().recordFunding(
      officer,
      ids.bankA,
      f.id,
      funding(f.view.revision),
      randomUUID(),
    );
    expect(
      (await closing().listAccounts(officer, ids.bankA)).accounts.some(
        (a) => a.id === funded.account?.id,
      ),
    ).toBe(true);
    expect((await closing().listAccounts(other, ids.bankA)).accounts).toEqual([]);
    await database.db
      .update(applicationParticipants)
      .set({ role: "adviser", scope: "assigned", taskIds: [f.envelope.taskId] })
      .where(eq(applicationParticipants.id, f.participant.id));
    expect(
      (await closing().listAccounts(borrower, ids.bankA)).accounts.some(
        (a) => a.applicationId === f.id,
      ),
    ).toBe(false);
    await expect(closing().read(borrower, ids.bankA, f.id)).rejects.toMatchObject(denied);
    await database.db
      .update(applicationParticipants)
      .set({ role: "applicant_admin", scope: "full", revokedAt: now })
      .where(eq(applicationParticipants.id, f.envelope.second.id));
    expect((await closing().listAccounts(f.envelope.secondActor, ids.bankA)).accounts).toEqual([]);
    await expect(closing().read(officer, ids.bankB, f.id)).rejects.toMatchObject(denied);
  });
  it("database constraints preserve one funding event, scope and exact approved amount", async () => {
    const f = await ready();
    await closing().recordFunding(officer, ids.bankA, f.id, funding(f.view.revision), randomUUID());
    const stored = await rows(f.id),
      record = stored.funding[0]!;
    await expect(
      database.db.insert(fundingRecords).values({ ...record, id: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(fundingRecords)
        .set({ fundedAmount: "1.00" })
        .where(eq(fundingRecords.id, record.id)),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(loanAccounts)
        .set({ bankId: ids.bankB })
        .where(eq(loanAccounts.id, stored.accounts[0]!.id)),
    ).rejects.toThrow();
    expect(
      await database.db
        .select()
        .from(applicationClosingPackages)
        .where(eq(applicationClosingPackages.applicationId, f.id)),
    ).toHaveLength(1);
  });
});
