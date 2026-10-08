import { randomUUID } from "node:crypto";
import {
  applicationChecks,
  applicationDecisions,
  applicationParticipants,
  applicationReviewCommands,
  applicationReviewEvents,
  applicationSetups,
  applicationSubmissions,
  applications,
  applicationTasks,
  auditEvents,
  businesses,
  businessRelationships,
  checkRuns,
  enrichmentRuns,
  integrationRuns,
  notifications,
  signatureEnvelopes,
  signatureSendOutbox,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createChecksService,
  createDocumentsService,
  createIdentifierCipher,
  createParticipantsService,
  createReviewService,
  createSignaturesService,
  createTasksService,
  updateApplicationPurpose,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const now = new Date("2026-10-07T12:00:00Z");
const cipher = createIdentifierCipher("bb".repeat(32));
const review = () => createReviewService(database.db, { clock: () => now });
const tasks = () => createTasksService(database.db, { clock: () => now });
const checks = () => createChecksService(database.db, { cipher, clock: () => now });
const participants = () =>
  createParticipantsService(database.db, {
    clock: () => now,
    borrowerOrigin: "http://localhost:3001",
    deliveryEnabled: true,
  });
const command = (expectedRevision: number) => ({ expectedRevision, idempotencyKey: randomUUID() });
const approval = (expectedRevision: number) => ({
  ...command(expectedRevision),
  humanDecisionConfirmed: true as const,
  reasonCode: "demo_criteria_met" as const,
  approvedAmount: "10000.00",
  privateNote: "Private synthetic reviewer context",
});
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function fixture(options: { draft?: boolean } = {}) {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("missing seed");
  const id = randomUUID();
  await database.db.insert(applications).values({
    ...source,
    id,
    status: options.draft ? "draft" : "collecting_information",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: options.draft ? "business_name" : "review",
    completedAt: options.draft ? null : now,
    completedByUserId: options.draft ? null : ids.borrower,
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
async function waive(id: string, phase: "submission" | "approval" = "submission") {
  const view = await tasks().read(officer, ids.bankA, id);
  for (const task of view.tasks.filter(
    (t) =>
      t.required &&
      t.inputKind === "answer" &&
      (t.stage === "submission" || (phase === "approval" && t.stage === "approval")),
  ))
    await tasks().waive(
      officer,
      ids.bankA,
      id,
      task.id,
      { expectedRevision: task.revision, reason: "Audited synthetic fixture review" },
      randomUUID(),
    );
}
async function prepare(id: string) {
  await waive(id, "approval");
  const all = await tasks().read(borrower, ids.bankA, id);
  const task = all.tasks.find((t) => t.inputKind === "synthetic_business_identifier");
  if (!task?.secureInput) throw new Error("missing entry");
  await checks().captureIdentifier(
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
  await clearChecks(id);
}
async function clearChecks(id: string) {
  const all = await checks().read(officer, ids.bankA, id);
  for (const check of all.checks) {
    const run = check.runs.find((r) => r.id === check.currentRunId);
    if (!run) throw new Error("missing run");
    const [row] = await database.db.select().from(checkRuns).where(eq(checkRuns.id, run.id));
    if (!row) throw new Error("missing run");
    await database.db
      .update(checkRuns)
      .set({
        status: "succeeded",
        result: {
          provider: "keycade-checks-v1",
          simulated: true,
          kind: check.kind,
          operationId: run.id,
          fingerprint: row.fingerprint,
          completedAt: now.toISOString(),
          outcome: "clear",
          findings: ["synthetic_match"],
        },
        claimToken: null,
        leaseUntil: null,
      })
      .where(eq(checkRuns.id, run.id));
  }
}
async function underReview(id: string, ready = true) {
  if (ready) await prepare(id);
  else await waive(id);
  let v = await review().read(officer, ids.bankA, id);
  v = await review().submit(borrower, ids.bankA, id, command(v.revision), randomUUID());
  return review().startReview(officer, ids.bankA, id, command(v.revision), randomUUID());
}
async function counts(id: string) {
  return {
    submissions: (
      await database.db
        .select()
        .from(applicationSubmissions)
        .where(eq(applicationSubmissions.applicationId, id))
    ).length,
    decisions: (
      await database.db
        .select()
        .from(applicationDecisions)
        .where(eq(applicationDecisions.applicationId, id))
    ).length,
    events: (
      await database.db
        .select()
        .from(applicationReviewEvents)
        .where(eq(applicationReviewEvents.applicationId, id))
    ).length,
    commands: (
      await database.db
        .select()
        .from(applicationReviewCommands)
        .where(eq(applicationReviewCommands.applicationId, id))
    ).length,
    notifications: (
      await database.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.applicationId, id), eq(notifications.kind, "status_changed")))
    ).length,
  };
}

describe("submission and deliberate review on PostgreSQL", () => {
  it("rejects stage jumps, nonhuman and unauthorized decisions; incomplete setup also blocks staff submission", async () => {
    const { id } = await fixture({ draft: true });
    const v = await review().read(borrower, ids.bankA, id);
    expect(v.capabilities.withdraw).toBe(true);
    expect(v.capabilities.submit).toBe(false);
    for (const actor of [borrower, officer])
      await expect(
        review().submit(actor, ids.bankA, id, command(1), randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      review().approve(officer, ids.bankA, id, approval(1), randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      review().approve(
        officer,
        ids.bankA,
        id,
        { ...approval(1), humanDecisionConfirmed: false },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      review().approve(borrower, ids.bankA, id, approval(1), randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      review().read(
        {
          kind: "system",
          bankId: ids.bankA,
          applicationIds: [id],
          capabilities: ["application:read"],
        },
        ids.bankA,
        id,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.db
      .update(applications)
      .set({ status: "collecting_information" })
      .where(eq(applications.id, id));
    await waive(id);
    await expect(
      review().submit(officer, ids.bankA, id, command(1), randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await counts(id)).toMatchObject({
      submissions: 0,
      decisions: 0,
      events: 0,
      commands: 0,
    });
  });
  it("separates submission and approval gates, records staff-on-behalf submission and idempotent events", async () => {
    const { id } = await fixture();
    await expect(
      review().submit(officer, ids.bankA, id, command(1), randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await waive(id);
    const input = command(1);
    const submitted = await review().submit(officer, ids.bankA, id, input, randomUUID());
    expect(submitted.status).toBe("submitted");
    expect(submitted.submissions[0]?.submittedOnBehalf).toBe(true);
    expect((await review().submit(officer, ids.bankA, id, input, randomUUID())).revision).toBe(
      submitted.revision,
    );
    expect(await counts(id)).toMatchObject({
      submissions: 1,
      events: 1,
      commands: 1,
      notifications: 1,
    });
    await expect(
      review().submit(officer, ids.bankA, id, { ...input, expectedRevision: 2 }, randomUUID()),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      review().submit(borrower, ids.bankA, id, input, randomUUID()),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const inReview = await review().startReview(
      officer,
      ids.bankA,
      id,
      command(submitted.revision),
      randomUUID(),
    );
    expect(inReview.readiness.gates.find((g) => g.stage === "approval")?.ready).toBe(false);
    const before = await counts(id);
    await expect(
      review().approve(officer, ids.bankA, id, approval(inReview.revision), randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await counts(id)).toEqual(before);
  });
  it("retains old submission evidence through request-information, fresh resubmission and approval", async () => {
    const { id } = await fixture();
    let v = await underReview(id);
    const [before] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.applicationId, id));
    expect(before).toBeDefined();
    const target = v.requestableTasks.find((t) => t.stage === "submission")!;
    v = await review().requestInformation(
      officer,
      ids.bankA,
      id,
      {
        ...command(v.revision),
        reasonCode: "current_evidence_required",
        privateNote: "Do not reveal private reviewer analysis",
        taskIds: [target.id],
      },
      randomUUID(),
    );
    expect(v.status).toBe("needs_information");
    let detail = await tasks().detail(officer, ids.bankA, id, target.id);
    expect(detail.state).toBe("needs_changes");
    detail = await tasks().saveAnswer(
      borrower,
      ids.bankA,
      id,
      target.id,
      { expectedRevision: detail.revision, answer: "Updated synthetic business details" },
      randomUUID(),
    );
    detail = await tasks().submit(
      borrower,
      ids.bankA,
      id,
      target.id,
      { expectedRevision: detail.revision },
      randomUUID(),
    );
    await tasks().review(
      officer,
      ids.bankA,
      id,
      target.id,
      {
        expectedRevision: detail.revision,
        decision: "completed",
        reason: "Reviewed current synthetic evidence",
      },
      randomUUID(),
    );
    await updateApplicationPurpose(
      database.db,
      borrower,
      ids.bankA,
      id,
      { expectedRevision: v.revision, purpose: "New synthetic purpose after information request" },
      randomUUID(),
    );
    await clearChecks(id);
    v = await review().read(officer, ids.bankA, id);
    v = await review().submit(borrower, ids.bankA, id, command(v.revision), randomUUID());
    expect(v.submissions.map((s) => s.sequence)).toEqual([2, 1]);
    expect(v.submissions[0]?.facts.purpose).toContain("New synthetic purpose");
    v = await review().startReview(officer, ids.bankA, id, command(v.revision), randomUUID());
    expect(v.readiness.gates.find((g) => g.stage === "approval")?.ready).toBe(true);
    v = await review().approve(officer, ids.bankA, id, approval(v.revision), randomUUID());
    expect(v.status).toBe("approved");
    expect(v.decisions[0]?.approvedAmount).toBe("10000.00");
    expect(v.decisions[0]?.privateNote).toBe("Private synthetic reviewer context");
    const [after] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.id, before!.id));
    expect(after).toEqual(before);
    const publicView = await review().read(borrower, ids.bankA, id);
    expect(publicView.decisions[0]?.privateNote).toBeNull();
    expect(publicView.decisions[0]?.decidedByUserId).toBeNull();
    expect(JSON.stringify(publicView)).not.toContain("reviewer analysis");
    expect(JSON.stringify(publicView)).not.toContain("identifierId");
    expect(publicView.decisions[0]?.publicReason).toContain("simulated review criteria");
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.applicationId, id));
    expect(JSON.stringify(audits)).not.toContain("Private synthetic reviewer context");
  });
  it("serializes competing human decisions and rejects stale revisions with one final decision", async () => {
    const { id } = await fixture();
    const v = await underReview(id);
    const results = await Promise.allSettled([
      review().approve(officer, ids.bankA, id, approval(v.revision), randomUUID()),
      review().decline(
        officer,
        ids.bankA,
        id,
        {
          ...command(v.revision),
          humanDecisionConfirmed: true,
          reasonCode: "demo_criteria_not_met",
        },
        randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason.code).toBe("REVISION_CONFLICT");
    expect(await counts(id)).toMatchObject({
      decisions: 1,
      events: 3,
      commands: 3,
      notifications: 3,
    });
  });
  it("decline does not require passing approval checks, and all terminal states reject further decisions", async () => {
    const { id } = await fixture();
    const v = await underReview(id, false);
    const input = {
      ...command(v.revision),
      humanDecisionConfirmed: true,
      reasonCode: "unable_to_verify_information",
    };
    const declined = await review().decline(officer, ids.bankA, id, input, randomUUID());
    expect(declined.status).toBe("declined");
    expect(declined.decisions[0]?.approvedAmount).toBeNull();
    expect((await review().decline(officer, ids.bankA, id, input, randomUUID())).revision).toBe(
      declined.revision,
    );
    for (const action of [
      "submit",
      "startReview",
      "requestInformation",
      "approve",
      "decline",
      "withdraw",
    ] as const) {
      const data =
        action === "approve"
          ? approval(declined.revision)
          : action === "decline"
            ? { ...input, ...command(declined.revision) }
            : action === "requestInformation"
              ? {
                  ...command(declined.revision),
                  reasonCode: "additional_information",
                  taskIds: [randomUUID()],
                }
              : action === "withdraw"
                ? { ...command(declined.revision), reasonCode: "applicant_requested" }
                : command(declined.revision);
      await expect(
        review()[action](officer, ids.bankA, id, data, randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
  });
  it("rolls back invalid approval terms and foreign task information requests without events or notifications", async () => {
    const { id } = await fixture();
    const v = await underReview(id);
    const before = await counts(id);
    for (const amount of ["0.00", "5000000.00", "99999.00"])
      await expect(
        review().approve(
          officer,
          ids.bankA,
          id,
          { ...approval(v.revision), approvedAmount: amount },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const other = await fixture();
    const foreign = (await tasks().read(officer, ids.bankA, other.id)).tasks[0]!;
    await expect(
      review().requestInformation(
        officer,
        ids.bankA,
        id,
        { ...command(v.revision), reasonCode: "additional_information", taskIds: [foreign.id] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await counts(id)).toEqual(before);
  });
  it("preserves shared-business snapshots and isolates history, staff notes and scoped decisions", async () => {
    const first = await fixture();
    const second = await fixture();
    let v = await underReview(first.id);
    const [snapshot] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.applicationId, first.id));
    const [business] = await database.db
      .select()
      .from(businesses)
      .where(eq(businesses.id, ids.businessA));
    await database.db
      .update(businesses)
      .set({
        legalName: "Other application's synthetic business edit",
        revision: (business?.revision ?? 1) + 1,
      })
      .where(eq(businesses.id, ids.businessA));
    v = await review().approve(officer, ids.bankA, first.id, approval(v.revision), randomUUID());
    expect(v.status).toBe("approved");
    const [same] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.id, snapshot!.id));
    expect(same?.snapshot).toEqual(snapshot?.snapshot);
    expect((await review().read(officer, ids.bankA, second.id)).submissions).toEqual([]);
    await expect(
      review().read({ kind: "user", userId: ids.officerB }, ids.bankA, first.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(review().read(officer, ids.bankB, first.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const stranger = randomUUID();
    await database.db.insert(users).values({
      id: stranger,
      email: `collaborator-${stranger}@example.test`,
      displayName: "Synthetic collaborator",
      synthetic: true,
      emailVerifiedAt: now,
    });
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: first.id,
      userId: stranger,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    });
    await expect(
      review().read({ kind: "user", userId: stranger }, ids.bankA, first.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      database.db.insert(applicationDecisions).values({
        bankId: ids.bankA,
        applicationId: second.id,
        submissionId: snapshot!.id,
        applicationRevision: 2,
        outcome: "declined",
        reasonCode: "demo_criteria_not_met",
        decidedByUserId: ids.officerA,
        evidence: {},
      }),
    ).rejects.toBeDefined();
    await database.db
      .update(businesses)
      .set({ legalName: business!.legalName, revision: business!.revision })
      .where(eq(businesses.id, ids.businessA));
  });
  it("locks material relationship, requirement and identifier changes until information is requested", async () => {
    const { id } = await fixture();
    const v = await underReview(id);
    await expect(
      participants().addRelationship(
        officer,
        ids.bankA,
        id,
        {
          idempotencyKey: randomUUID(),
          displayName: "Frozen synthetic owner",
          kind: "owner",
          ownershipPercent: "10.00",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      tasks().createManual(
        officer,
        ids.bankA,
        id,
        {
          idempotencyKey: randomUUID(),
          title: "New frozen requirement",
          description: "Synthetic",
          stage: "approval",
          required: true,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const input = (await tasks().read(borrower, ids.bankA, id)).tasks.find(
      (t) => t.inputKind === "synthetic_business_identifier",
    )!;
    await expect(
      checks().captureIdentifier(
        borrower,
        ids.bankA,
        id,
        input.id,
        {
          expectedRevision: input.revision,
          expectedInputRevision: input.secureInput!.revision,
          value: "000000003",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const approved = await review().approve(
      officer,
      ids.bankA,
      id,
      approval(v.revision),
      randomUUID(),
    );
    const ordinary = (await tasks().read(officer, ids.bankA, id)).tasks.find(
      (t) => t.inputKind === "answer",
    )!;
    expect(ordinary.canReview).toBe(false);
    await expect(
      tasks().waive(
        officer,
        ids.bankA,
        id,
        ordinary.id,
        { expectedRevision: ordinary.revision, reason: "Late decision overwrite" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(approved.status).toBe("approved");
  });
  it("cancels pending jobs and reminders on withdrawal while retaining history and one status intent", async () => {
    const { id } = await fixture();
    await prepare(id);
    const current = (await checks().read(officer, ids.bankA, id)).checks[0]!;
    await database.db
      .update(checkRuns)
      .set({
        status: "running",
        claimToken: randomUUID(),
        leaseUntil: new Date(now.getTime() + 10000),
      })
      .where(eq(checkRuns.id, current.currentRunId!));
    await database.db.insert(integrationRuns).values({
      bankId: ids.bankA,
      applicationId: id,
      inputRevision: 1,
      scenario: "success",
      status: "queued",
      requestId: randomUUID(),
    });
    await database.db.insert(notifications).values({
      bankId: ids.bankA,
      applicationId: id,
      recipientUserId: ids.borrower,
      kind: "reminder",
      deduplicationKey: randomUUID(),
      episodeId: randomUUID(),
      reminderOrdinal: 1,
    });
    const existing = await tasks().read(officer, ids.bankA, id);
    const created = await tasks().createManual(
      officer,
      ids.bankA,
      id,
      {
        idempotencyKey: randomUUID(),
        title: "Synthetic withdrawal signing",
        description: "Synthetic",
        assigneeParticipantId: (
          await database.db
            .select()
            .from(applicationParticipants)
            .where(eq(applicationParticipants.applicationId, id))
        )[0]!.id,
      },
      randomUUID(),
    );
    const task = created.tasks.find((t) => !existing.tasks.some((e) => e.id === t.id))!;
    const docs = createDocumentsService(database.db, { clock: () => now });
    const upload = await docs.beginUpload(
      borrower,
      ids.bankA,
      id,
      {
        idempotencyKey: randomUUID(),
        fileName: "synthetic.pdf",
        mimeType: "application/pdf",
        expectedSize: 100,
        taskId: task.id,
      },
      randomUUID(),
    );
    await docs.finalizeUpload(
      borrower,
      ids.bankA,
      id,
      upload.uploadId,
      { size: 100, sha256: "a".repeat(64) },
      randomUUID(),
    );
    // Scanner/processor correctness is covered separately; prepare its typed clean result.
    const { documentVersions } = await import("@keycade/db");
    await database.db
      .update(documentVersions)
      .set({ scanState: "clean" })
      .where(eq(documentVersions.id, upload.versionId));
    const signatures = createSignaturesService(database.db, { clock: () => now });
    const sv = await signatures.create(
      officer,
      ids.bankA,
      id,
      {
        taskId: task.id,
        sourceVersionId: upload.versionId,
        signerParticipantIds: [
          (
            await database.db
              .select()
              .from(applicationParticipants)
              .where(eq(applicationParticipants.applicationId, id))
          )[0]!.id,
        ],
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const envelope = sv.envelopes.find((e) => e.taskId === task.id)!;
    await signatures.send(officer, ids.bankA, id, envelope.id, randomUUID());
    const withdrawn = await review().withdraw(
      borrower,
      ids.bankA,
      id,
      { ...command(1), reasonCode: "applicant_requested" },
      randomUUID(),
    );
    expect(withdrawn.status).toBe("withdrawn");
    const [run] = await database.db
      .select()
      .from(checkRuns)
      .where(eq(checkRuns.id, current.currentRunId!));
    expect(run).toMatchObject({ status: "cancelled", claimToken: null, leaseUntil: null });
    expect(
      (
        await database.db.select().from(enrichmentRuns).where(eq(enrichmentRuns.applicationId, id))
      ).every((r) => !["running", "queued", "retry_scheduled"].includes(r.status)),
    ).toBe(true);
    const [e] = await database.db
      .select()
      .from(signatureEnvelopes)
      .where(eq(signatureEnvelopes.id, envelope.id));
    expect(e?.state).toBe("voided");
    const [outbox] = await database.db
      .select()
      .from(signatureSendOutbox)
      .where(eq(signatureSendOutbox.envelopeId, envelope.id));
    expect(outbox?.dispatchedAt).not.toBeNull();
    const intents = await database.db
      .select()
      .from(notifications)
      .where(eq(notifications.applicationId, id));
    expect(intents.find((n) => n.kind === "reminder")?.state).toBe("suppressed");
    expect(intents.filter((n) => n.kind === "status_changed")).toHaveLength(1);
  });
  it("allows draft withdrawal before setup and rejects revoked actor idempotent replay", async () => {
    const { id, participant } = await fixture({ draft: true });
    const data = { ...command(1), reasonCode: "application_no_longer_needed" };
    const result = await review().withdraw(borrower, ids.bankA, id, data, randomUUID());
    expect(result.status).toBe("withdrawn");
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: now })
      .where(eq(applicationParticipants.id, participant.id));
    await expect(
      review().withdraw(borrower, ids.bankA, id, data, randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await counts(id)).toMatchObject({ events: 1, commands: 1, notifications: 1 });
  });
  it("detects material drift beneath a stale review, while a new application revision rejects old commands", async () => {
    const { id } = await fixture();
    const v = await underReview(id);
    const before = await counts(id);
    await database.db
      .update(applications)
      .set({ purpose: "Synthetic out-of-band material drift" })
      .where(eq(applications.id, id));
    await expect(
      review().approve(officer, ids.bankA, id, approval(v.revision), randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      review().decline(
        officer,
        ids.bankA,
        id,
        {
          ...command(v.revision),
          humanDecisionConfirmed: true,
          reasonCode: "demo_criteria_not_met",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await counts(id)).toEqual(before);
    const target = v.requestableTasks.find((t) => t.stage === "submission")!;
    const reopened = await review().requestInformation(
      officer,
      ids.bankA,
      id,
      { ...command(v.revision), reasonCode: "additional_information", taskIds: [target.id] },
      randomUUID(),
    );
    await expect(
      review().withdraw(
        borrower,
        ids.bankA,
        id,
        { ...command(v.revision), reasonCode: "applicant_requested" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await review().read(borrower, ids.bankA, id)).revision).toBe(reopened.revision);
  });
  it("freezes relationship removal/linking and permits explicit revision after a return for information", async () => {
    const { id } = await fixture();
    const original = await participants().addRelationship(
      officer,
      ids.bankA,
      id,
      { idempotencyKey: randomUUID(), displayName: "Synthetic business contact", kind: "contact" },
      randomUUID(),
    );
    const contact = original.relationships.find((r) => r.kind === "contact")!;
    let v = await underReview(id);
    await expect(
      participants().setRelationshipActive(
        officer,
        ids.bankA,
        id,
        contact.id,
        { idempotencyKey: randomUUID(), active: false },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      participants().linkRelationship(
        officer,
        ids.bankA,
        id,
        contact.id,
        { idempotencyKey: randomUUID(), userId: ids.borrower },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    v = await review().requestInformation(
      officer,
      ids.bankA,
      id,
      {
        ...command(v.revision),
        reasonCode: "additional_information",
        taskIds: [v.requestableTasks.find((t) => t.stage === "submission")!.id],
      },
      randomUUID(),
    );
    const removed = await participants().setRelationshipActive(
      officer,
      ids.bankA,
      id,
      contact.id,
      { idempotencyKey: randomUUID(), active: false },
      randomUUID(),
    );
    expect(removed.relationships.find((r) => r.id === contact.id)?.active).toBe(false);
    expect(v.status).toBe("needs_information");
  });
});

describe("v2 immutable submission facts", () => {
  const profile = {
    businessAddress: {
      line1: "42 Synthetic Avenue",
      locality: "Teston",
      region: "NY",
      postalCode: "10001",
      countryCode: "US",
    },
    businessAddressRevision: 1,
    website: "https://example.test/",
    fundingPurposes: ["working_capital", "other"],
    purposeCatalogVersion: "2026-01",
    otherPurposeDetail: "Synthetic workshop expansion",
  };
  it("freezes v2 intake facts and prevents decisions after any material profile drift", async () => {
    const { id } = await fixture();
    await database.db.update(applications).set(profile).where(eq(applications.id, id));
    const v = await underReview(id);
    const [submission] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.applicationId, id));
    expect(submission?.snapshot.facts).toMatchObject(profile);
    expect(v.submissions[0]?.facts).toMatchObject(profile);
    const other = await fixture();
    await database.db
      .update(applications)
      .set({ ...profile, website: "https://other.example.test/", fundingPurposes: ["other"] })
      .where(eq(applications.id, other.id));
    expect((await review().read(officer, ids.bankA, id)).submissions[0]?.facts).toMatchObject(
      profile,
    );
    const before = await counts(id);
    for (const change of [
      { businessAddress: { ...profile.businessAddress, line1: "99 Synthetic Avenue" } },
      { businessAddressRevision: 2 },
      { website: "https://changed.example.test/" },
      { fundingPurposes: ["other", "working_capital"] },
      { otherPurposeDetail: "Changed synthetic expansion" },
    ]) {
      await database.db
        .update(applications)
        .set({ ...profile, ...change })
        .where(eq(applications.id, id));
      await expect(
        review().approve(officer, ids.bankA, id, approval(v.revision), randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(await counts(id)).toEqual(before);
      const [unchanged] = await database.db
        .select()
        .from(applicationSubmissions)
        .where(eq(applicationSubmissions.id, submission!.id));
      expect(unchanged?.snapshot).toEqual(submission?.snapshot);
    }
  });
  it("keeps historical submission JSON and legacy fingerprints valid without rewriting empty intake facts", async () => {
    const { id } = await fixture();
    const v = await underReview(id);
    const [submission] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.applicationId, id));
    if (!submission) throw new Error("Missing historical submission fixture.");
    const historical = structuredClone(submission.snapshot);
    delete historical.facts.businessAddress;
    delete historical.facts.businessAddressRevision;
    delete historical.facts.website;
    delete historical.facts.fundingPurposes;
    delete historical.facts.purposeCatalogVersion;
    delete historical.facts.otherPurposeDetail;
    await database.db
      .update(applicationSubmissions)
      .set({ snapshot: historical })
      .where(eq(applicationSubmissions.id, submission.id));
    const read = await review().read(borrower, ids.bankA, id);
    expect(read.submissions[0]?.facts).toMatchObject({
      businessAddress: null,
      businessAddressRevision: 0,
      website: null,
      fundingPurposes: [],
      purposeCatalogVersion: null,
      otherPurposeDetail: null,
    });
    const approved = await review().approve(
      officer,
      ids.bankA,
      id,
      approval(v.revision),
      randomUUID(),
    );
    expect(approved.status).toBe("approved");
    const [unchanged] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.id, submission.id));
    expect(unchanged?.snapshot).toEqual(historical);
  });
});
