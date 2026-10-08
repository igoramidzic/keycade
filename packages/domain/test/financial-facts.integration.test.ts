import { randomUUID } from "node:crypto";
import type { ReviewFinancialFacts } from "@keycade/contracts";
import { type DemoImportRecipeId, demoImportFields } from "@keycade/contracts/demo-import";
import {
  applicationDecisions,
  applicationParticipants,
  applicationSetups,
  applicationSubmissions,
  applications,
  auditEvents,
  bankMemberships,
  businesses,
  documentCategoryOverrides,
  documentMetadataRevisions,
  documentProcessingRuns,
  documents,
  documentVersions,
  financialFactCommands,
  financialFactReviews,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createFinancialFactsService,
  createReviewService,
  createTasksService,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const officer: Actor = { kind: "user", userId: ids.officerA };
const now = new Date("2026-10-08T12:00:00Z");
const service = () => createFinancialFactsService(database.db, { clock: () => now });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
});
afterAll(async () => database?.cleanup());
async function fixture() {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing seed");
  const id = randomUUID();
  const [app] = await database.db
    .insert(applications)
    .values({ ...source, id, revision: 1, status: "collecting_information" })
    .returning();
  if (!app) throw new Error("Missing application");
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: now,
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
  return app;
}
async function source(
  app: typeof applications.$inferSelect,
  recipeId: DemoImportRecipeId = "business-tax-return-2023",
  replacement?: string,
) {
  const documentId = replacement ?? randomUUID();
  if (!replacement)
    await database.db.insert(documents).values({
      id: documentId,
      bankId: app.bankId,
      applicationId: app.id,
      visibility: "shared",
      currentVersion: 1,
      createdByUserId: ids.officerA,
    });
  const [document] = await database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) throw new Error("Missing document");
  const versionNumber = replacement ? document.currentVersion + 1 : 1;
  const versionId = randomUUID();
  const runId = randomUUID();
  const fixture = {
    recipeId,
    recipeVersion: 1 as const,
    businessName: app.businessName ?? "Synthetic Business",
    applicationRevision: app.revision,
  };
  await database.db.insert(documentVersions).values({
    id: versionId,
    bankId: app.bankId,
    applicationId: app.id,
    documentId,
    version: versionNumber,
    fileName: `${recipeId}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    demoImportFixture: fixture,
    storageKey: randomUUID(),
    uploadState: "uploaded",
    uploadedByUserId: ids.officerA,
    keyHash: randomUUID(),
    payloadHash: randomUUID(),
    expiresAt: now,
    uploadedAt: now,
    scanState: "clean",
  });
  await database.db
    .update(documents)
    .set({ currentVersion: versionNumber })
    .where(eq(documents.id, documentId));
  const [run] = await database.db
    .insert(documentProcessingRuns)
    .values({
      id: runId,
      bankId: app.bankId,
      applicationId: app.id,
      versionId,
      generation: 1,
      state: "classified",
      requestId: randomUUID(),
      result: {
        provider: "keycade-document-interpretation-v1",
        simulated: true,
        versionId,
        runId,
        category: recipeId === "business-bank-statement-2026-01" ? "bank_statement" : "tax",
        confidence: 1,
        needsReview: false,
        extractedFields: demoImportFields(fixture),
        findings: [
          {
            code: "business_name_match",
            severity: "clear",
            title: "Synthetic business match",
            detail: "Fixture matches the application.",
          },
        ],
        comparedApplicationBusinessName: app.businessName,
        completedAt: now.toISOString(),
      },
    })
    .returning();
  if (!run) throw new Error("Missing run");
  return { documentId, versionId, runId, run };
}
async function command(
  applicationId: string,
  documentId: string,
  fieldKey: ReviewFinancialFacts["decisions"][number]["fieldKey"] = "revenue",
): Promise<ReviewFinancialFacts> {
  const view = await service().read(officer, ids.bankA, applicationId);
  const candidate = view.candidates.find(
    (item) => item.source.documentId === documentId && item.fieldKey === fieldKey,
  );
  if (!candidate) throw new Error("Missing candidate");
  return {
    idempotencyKey: randomUUID(),
    expectedApplicationRevision: view.applicationRevision,
    documentId,
    versionId: candidate.source.versionId,
    runId: candidate.source.runId,
    expectedRunGeneration: candidate.source.runGeneration,
    expectedCategoryRevision: candidate.source.categoryRevision,
    expectedAnalysisRevision: candidate.source.analysisRevision,
    decisions: [
      {
        fieldKey,
        disposition: "accept",
        expectedFactRevision: candidate.currentFactRevision,
        reason: "Reviewed the printed synthetic schedule.",
      },
    ],
  };
}
const submit = (applicationId: string, input: unknown, actor = officer) =>
  service().review(actor, ids.bankA, applicationId, input, randomUUID());

describe("reviewed application financial facts on PostgreSQL", () => {
  it("keeps three tax periods distinct, preserves exact decimals and separate ordinary/adjusted income provenance", async () => {
    const app = await fixture();
    const businessBefore = await database.db
      .select()
      .from(businesses)
      .where(eq(businesses.id, app.businessId!));
    for (const year of [2023, 2024, 2025]) {
      const evidence = await source(app, `business-tax-return-${year}` as DemoImportRecipeId);
      const data = await command(app.id, evidence.documentId);
      data.decisions.push(
        { ...data.decisions[0]!, fieldKey: "ordinary_income" },
        { ...data.decisions[0]!, fieldKey: "adjusted_net_income" },
      );
      const result = await submit(app.id, data);
      expect(result.facts.filter((fact) => fact.period.start === `${year}-01-01`)).toHaveLength(3);
    }
    const result = await service().read(officer, ids.bankA, app.id);
    expect(result.facts).toHaveLength(9);
    expect(
      result.facts.find((fact) => fact.metric === "revenue" && fact.period.start === "2023-01-01")
        ?.value,
    ).toBe("1200000.00");
    expect(
      result.facts.find((fact) => fact.metric === "adjusted_net_income")?.adjustments,
    ).toHaveLength(2);
    expect(
      result.facts.every((fact) => !fact.sourceStale && fact.source.sha256 === "a".repeat(64)),
    ).toBe(true);
    expect(
      await database.db.select().from(businesses).where(eq(businesses.id, app.businessId!)),
    ).toEqual(businessBefore);
  });
  it("keeps statement deposits and balances separate from fiscal-year revenue and does not invent absent adjusted income", async () => {
    const app = await fixture();
    const statement = await source(app, "business-bank-statement-2026-01");
    const result = await submit(app.id, await command(app.id, statement.documentId, "deposits"));
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      metric: "deposits",
      value: "125000.00",
      period: { start: "2026-01-01", end: "2026-01-31", basis: "statement" },
      unit: "money",
      currency: "USD",
    });
    const review = await source(app, "business-tax-return-review");
    expect(
      (await service().read(officer, ids.bankA, app.id)).candidates
        .filter((candidate) => candidate.source.documentId === review.documentId)
        .some((candidate) => candidate.metric === "adjusted_net_income"),
    ).toBe(false);
  });
  it("atomically records acceptance, rejection and correction while retaining original candidate and exact replay response", async () => {
    const app = await fixture();
    const evidence = await source(app);
    const input = await command(app.id, evidence.documentId);
    const [first, repeated] = await Promise.all([submit(app.id, input), submit(app.id, input)]);
    expect(repeated).toEqual(first);
    const rejected = await command(app.id, evidence.documentId, "ordinary_income");
    rejected.decisions[0]!.disposition = "reject";
    const rejectedResult = await submit(app.id, rejected);
    expect(rejectedResult.facts).toHaveLength(1);
    expect(
      rejectedResult.history.find((item) => item.disposition === "reject")?.factRevision,
    ).toBeNull();
    const corrected = await command(app.id, evidence.documentId);
    corrected.decisions[0] = {
      ...corrected.decisions[0]!,
      disposition: "correct",
      value: "999999999999999999.99",
      reason: "Deliberately replace the earlier synthetic amount after source review.",
    };
    const correctedResult = await submit(app.id, corrected);
    expect(correctedResult.facts[0]).toMatchObject({
      value: "999999999999999999.99",
      factRevision: 2,
      originalCandidate: { value: "1200000.00" },
    });
    expect(correctedResult.history).toHaveLength(3);
    expect(await submit(app.id, input)).toEqual(first);
    await expect(
      submit(app.id, {
        ...input,
        decisions: [{ ...input.decisions[0], reason: "Different request" }],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("requires current application/fact/run revisions and serializes conflicting reviewers", async () => {
    const app = await fixture();
    const evidence = await source(app);
    const input = await command(app.id, evidence.documentId);
    const concurrent = await Promise.allSettled([
      submit(app.id, input),
      submit(app.id, { ...input, idempotencyKey: randomUUID() }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const fresh = await command(app.id, evidence.documentId);
    for (const data of [
      { ...fresh, expectedRunGeneration: 2 },
      { ...fresh, expectedCategoryRevision: 1 },
      { ...fresh, expectedAnalysisRevision: 1 },
      { ...fresh, decisions: [{ ...fresh.decisions[0]!, expectedFactRevision: 0 }] },
    ])
      await expect(submit(app.id, data)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await service().read(officer, ids.bankA, app.id)).history).toHaveLength(1);
  });
  it("validates all fields before writing any reviews and rejects malformed decimals, target remapping and missing reasons", async () => {
    const app = await fixture();
    const evidence = await source(app);
    const input = await command(app.id, evidence.documentId);
    for (const value of [
      "1",
      "1.001",
      "NaN",
      "Infinity",
      "1e6",
      "0001.00",
      "-0.00",
      "1000000000000000000.00",
    ])
      await expect(
        submit(app.id, {
          ...input,
          decisions: [{ ...input.decisions[0], disposition: "correct", value }],
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const decision of [
      { ...input.decisions[0], reason: " " },
      { ...input.decisions[0], currency: "EUR" },
      { ...input.decisions[0], fieldKey: "debt_service" },
      { ...input.decisions[0], period: { start: "2020-01-01" } },
    ])
      await expect(submit(app.id, { ...input, decisions: [decision] })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    await expect(
      submit(app.id, {
        ...input,
        decisions: [...input.decisions, { ...input.decisions[0], fieldKey: "deposits" }],
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await service().read(officer, ids.bankA, app.id)).history).toHaveLength(0);
  });
  it("rechecks staff, bank, application, source and revocation permissions on reads, writes and replays", async () => {
    const app = await fixture();
    const other = await fixture();
    const evidence = await source(app);
    const foreign = await source(other);
    const input = await command(app.id, evidence.documentId);
    for (const userId of [ids.borrower, ids.adviser, ids.revokedOwner, ids.officerB]) {
      const actor: Actor = { kind: "user", userId };
      await expect(service().read(actor, ids.bankA, app.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(submit(app.id, input, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(service().read(officer, ids.bankB, app.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const change of [
      { documentId: foreign.documentId },
      { versionId: foreign.versionId },
      { runId: foreign.runId },
    ])
      await expect(submit(app.id, { ...input, ...change })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    await submit(app.id, input);
    const membership = and(
      eq(bankMemberships.bankId, ids.bankA),
      eq(bankMemberships.userId, ids.officerA),
    );
    await database.db.update(bankMemberships).set({ revokedAt: now }).where(membership);
    try {
      await expect(submit(app.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(service().read(officer, ids.bankA, app.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      await database.db.update(bankMemberships).set({ revokedAt: null }).where(membership);
    }
  });
  it("rejects personal evidence, unclean scans, mismatch findings and mismatched period/category", async () => {
    for (const state of [
      "private",
      "scan",
      "mismatch",
      "printed_name",
      "missing_name",
      "category",
      "period",
    ] as const) {
      const app = await fixture();
      const evidence = await source(app);
      const input = await command(app.id, evidence.documentId);
      if (state === "private")
        await database.db
          .update(documents)
          .set({ visibility: "private", subjectUserId: ids.borrower })
          .where(eq(documents.id, evidence.documentId));
      if (state === "scan")
        await database.db
          .update(documentVersions)
          .set({ scanState: "blocked" })
          .where(eq(documentVersions.id, evidence.versionId));
      if (state === "mismatch")
        await database.db
          .update(documentProcessingRuns)
          .set({
            result: {
              ...evidence.run.result!,
              findings: [
                {
                  code: "business_name_mismatch",
                  severity: "warning",
                  title: "Mismatch",
                  detail: "Synthetic different business",
                },
              ],
            },
          })
          .where(eq(documentProcessingRuns.id, evidence.runId));
      if (state === "printed_name" || state === "missing_name")
        await database.db
          .update(documentProcessingRuns)
          .set({
            result: {
              ...evidence.run.result!,
              extractedFields:
                state === "missing_name"
                  ? evidence.run.result!.extractedFields.filter(
                      (field) => field.key !== "business_name",
                    )
                  : evidence.run.result!.extractedFields.map((field) =>
                      field.key === "business_name"
                        ? { ...field, value: "Synthetic unrelated company" }
                        : field,
                    ),
              findings: [],
            },
          })
          .where(eq(documentProcessingRuns.id, evidence.runId));
      if (state === "category") {
        await database.db.insert(documentCategoryOverrides).values({
          bankId: app.bankId,
          applicationId: app.id,
          versionId: evidence.versionId,
          revision: 1,
          category: "bank_statement",
          reason: "Synthetic classification correction",
          actorUserId: ids.officerA,
        });
        input.expectedCategoryRevision = 1;
      }
      if (state === "period") {
        await database.db.insert(documentMetadataRevisions).values({
          bankId: app.bankId,
          applicationId: app.id,
          documentId: evidence.documentId,
          versionId: evidence.versionId,
          revision: 1,
          analysisRevision: 1,
          expectedPeriod: { start: "2024-01-01", end: "2024-12-31", basis: "fiscal_year" },
          reason: "Synthetic expected period correction",
          actorUserId: ids.officerA,
        });
        input.expectedAnalysisRevision = 1;
      }
      await expect(submit(app.id, input)).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect((await service().read(officer, ids.bankA, app.id)).facts).toHaveLength(0);
    }
  });
  it.each([
    "submitted",
    "in_review",
    "approved",
    "closing",
    "funded",
    "declined",
    "withdrawn",
  ] as const)("locks financial writes in %s", async (status) => {
    const app = await fixture();
    const evidence = await source(app);
    const input = await command(app.id, evidence.documentId);
    await database.db.update(applications).set({ status }).where(eq(applications.id, app.id));
    await expect(submit(app.id, input)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await service().read(officer, ids.bankA, app.id)).canReview).toBe(false);
  });
  it("preserves accepted amounts while replacement, reprocessing, category edits and analysis edits mark source stale", async () => {
    for (const change of ["replacement", "run", "category", "metadata", "name"] as const) {
      const app = await fixture();
      const evidence = await source(app);
      const input = await command(app.id, evidence.documentId);
      const first = await submit(app.id, input);
      if (change === "replacement")
        await source(app, "business-tax-return-2024", evidence.documentId);
      if (change === "run")
        await database.db.insert(documentProcessingRuns).values({
          bankId: app.bankId,
          applicationId: app.id,
          versionId: evidence.versionId,
          generation: 2,
          state: "queued",
          requestId: randomUUID(),
        });
      if (change === "category")
        await database.db.insert(documentCategoryOverrides).values({
          bankId: app.bankId,
          applicationId: app.id,
          versionId: evidence.versionId,
          revision: 1,
          category: "financial_statement",
          reason: "Classification correction",
          actorUserId: ids.officerA,
        });
      if (change === "metadata")
        await database.db.insert(documentMetadataRevisions).values({
          bankId: app.bankId,
          applicationId: app.id,
          documentId: evidence.documentId,
          versionId: evidence.versionId,
          revision: 1,
          analysisRevision: 1,
          expectedPeriod: { start: "2023-01-01", end: "2023-12-31", basis: "fiscal_year" },
          reason: "Expected period correction",
          actorUserId: ids.officerA,
        });
      if (change === "name")
        await database.db
          .update(applications)
          .set({ businessName: "Synthetic renamed business" })
          .where(eq(applications.id, app.id));
      const view = await service().read(officer, ids.bankA, app.id);
      expect(view.facts[0]).toMatchObject({
        id: first.facts[0]!.id,
        value: "1200000.00",
        sourceStale: true,
      });
      expect(view.history).toEqual(first.history);
      await expect(
        submit(app.id, {
          ...input,
          idempotencyKey: randomUUID(),
          expectedApplicationRevision: view.applicationRevision,
        }),
      ).rejects.toThrow();
    }
  });
  it("does not stale facts for display-only metadata edits and permits deliberate replacement with new revision", async () => {
    const app = await fixture();
    const evidence = await source(app);
    await submit(app.id, await command(app.id, evidence.documentId));
    await database.db.insert(documentMetadataRevisions).values({
      bankId: app.bankId,
      applicationId: app.id,
      documentId: evidence.documentId,
      versionId: evidence.versionId,
      revision: 1,
      analysisRevision: 0,
      displayName: "Reviewed 2023 tax return",
      reason: "Display label",
      actorUserId: ids.officerA,
    });
    expect((await service().read(officer, ids.bankA, app.id)).facts[0]?.sourceStale).toBe(false);
    const fresh = await source(app, "business-tax-return-2023", evidence.documentId);
    const updated = await submit(app.id, await command(app.id, fresh.documentId));
    expect(updated.facts[0]).toMatchObject({
      factRevision: 2,
      sourceStale: false,
      source: { versionId: fresh.versionId },
    });
    expect(updated.history).toHaveLength(2);
  });
  it("rolls back review ledger, application revision, command and audit together on audit failure", async () => {
    const app = await fixture();
    const evidence = await source(app);
    const input = await command(app.id, evidence.documentId);
    await database.db.execute(
      sql`CREATE FUNCTION reject_financial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER reject_financial_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_financial_audit()`,
    );
    try {
      await expect(submit(app.id, input)).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_financial_audit ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION reject_financial_audit()`);
    }
    const view = await service().read(officer, ids.bankA, app.id);
    expect(view).toMatchObject({ applicationRevision: 1, facts: [], history: [] });
    expect(
      await database.db
        .select()
        .from(financialFactCommands)
        .where(eq(financialFactCommands.applicationId, app.id)),
    ).toHaveLength(0);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.applicationId, app.id)),
    ).toHaveLength(0);
    expect((await submit(app.id, input)).facts).toHaveLength(1);
  });
  it("enforces immutable ledger/command provenance and scoped database constraints", async () => {
    const app = await fixture();
    const evidence = await source(app);
    await submit(app.id, await command(app.id, evidence.documentId));
    const [row] = await database.db
      .select()
      .from(financialFactReviews)
      .where(eq(financialFactReviews.applicationId, app.id));
    if (!row) throw new Error("Missing financial fact");
    await expect(
      database.db
        .update(financialFactReviews)
        .set({ value: "1.00" })
        .where(eq(financialFactReviews.id, row.id)),
    ).rejects.toThrow();
    await expect(
      database.db.delete(financialFactReviews).where(eq(financialFactReviews.id, row.id)),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(financialFactCommands)
        .set({ response: {} })
        .where(eq(financialFactCommands.applicationId, app.id)),
    ).rejects.toThrow();
    for (const update of [
      { bankId: ids.bankB },
      { applicationId: ids.applicationUnshared },
      { factRevision: null },
      { currency: "EUR" },
      { value: "NaN" },
      { metric: "made_up" },
    ])
      await expect(
        database.db
          .insert(financialFactReviews)
          .values({ ...row, id: randomUUID(), factRevision: 2, ...update }),
      ).rejects.toThrow();
  });
  it("captures immutable accepted fact references in submission and decision snapshots across shared-business applications", async () => {
    const app = await fixture();
    const evidence = await source(app);
    const accepted = await submit(app.id, await command(app.id, evidence.documentId));
    const tasks = createTasksService(database.db, { clock: () => now });
    for (const task of (await tasks.read(officer, app.bankId, app.id)).tasks.filter(
      (item) => item.required && item.inputKind === "answer" && item.stage === "submission",
    ))
      await tasks.waive(
        officer,
        app.bankId,
        app.id,
        task.id,
        { expectedRevision: task.revision, reason: "Synthetic fixture waiver" },
        randomUUID(),
      );
    const reviews = createReviewService(database.db, { clock: () => now });
    const submitted = await reviews.submit(
      officer,
      app.bankId,
      app.id,
      { expectedRevision: accepted.applicationRevision, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    const started = await reviews.startReview(
      officer,
      app.bankId,
      app.id,
      { expectedRevision: submitted.revision, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    const [snapshot] = await database.db
      .select()
      .from(applicationSubmissions)
      .where(eq(applicationSubmissions.applicationId, app.id));
    expect(snapshot?.snapshot.references.financialFacts).toMatchObject([
      { id: accepted.facts[0]!.id, revision: 1, value: "1200000.00", sourceStale: false },
    ]);
    await reviews.decline(
      officer,
      app.bankId,
      app.id,
      {
        expectedRevision: started.revision,
        idempotencyKey: randomUUID(),
        humanDecisionConfirmed: true,
        reasonCode: "unable_to_verify_information",
      },
      randomUUID(),
    );
    const [decision] = await database.db
      .select()
      .from(applicationDecisions)
      .where(eq(applicationDecisions.applicationId, app.id));
    expect(decision?.evidence.financialFacts).toEqual(snapshot?.snapshot.references.financialFacts);
    const other = await fixture();
    const otherSource = await source(other);
    const data = await command(other.id, otherSource.documentId);
    data.decisions[0] = { ...data.decisions[0]!, disposition: "correct", value: "42.00" };
    await submit(other.id, data);
    expect(
      (
        await database.db
          .select()
          .from(applicationSubmissions)
          .where(eq(applicationSubmissions.id, snapshot!.id))
      )[0],
    ).toEqual(snapshot);
    expect(
      (
        await database.db
          .select()
          .from(applicationDecisions)
          .where(eq(applicationDecisions.id, decision!.id))
      )[0],
    ).toEqual(decision);
    expect((await service().read(officer, app.bankId, app.id)).facts[0]?.value).toBe("1200000.00");
  });
});
