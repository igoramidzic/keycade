import { randomUUID } from "node:crypto";
import type { ReviewFinancialFacts } from "@keycade/contracts";
import { type DemoImportRecipeId, demoImportFields } from "@keycade/contracts/demo-import";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  bankMemberships,
  documentProcessingRuns,
  documents,
  documentVersions,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Actor,
  createDocumentsService,
  createFinancialFactsService,
  createTasksService,
  readStaffOverview,
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

const overview = (applicationId: string, actor: Actor = officer, bankId: string = ids.bankA) =>
  readStaffOverview(database.db, actor, bankId, applicationId);

describe("lender overview on PostgreSQL", () => {
  it("keeps overview and document SQL bounded as documents and version history grow", async () => {
    const app = await fixture();
    const demo: Actor = { ...officer, demoBankId: ids.bankA };
    const taskView = await createTasksService(database.db).read(demo, app.bankId, app.id);
    const task = taskView.tasks.find((task) => task.visibility === "shared");
    if (!task) throw new Error("Missing shared task");
    const first = await source(app);
    await database.db
      .update(documents)
      .set({ taskId: task.id })
      .where(eq(documents.id, first.documentId));
    const measure = async (read: () => Promise<unknown>, ceiling: number) => {
      const spy = vi.spyOn(pg.Client.prototype, "query");
      try {
        await read();
        const statements = spy.mock.calls.map(([query]: unknown[]) =>
          typeof query === "string" ? query : (query as { text: string }).text,
        );
        expect(statements.length).toBeLessThanOrEqual(ceiling);
        expect(statements.some((query) => /^(insert|update|delete|savepoint)\b/i.test(query))).toBe(
          false,
        );
        // All evidence tables and tasks are loaded once per request, including historical versions.
        for (const table of [
          "documents",
          "document_versions",
          "document_processing_runs",
          "document_category_overrides",
          "document_metadata_revisions",
          "application_tasks",
        ])
          expect(statements.filter((query) => query.includes(`from "${table}"`))).toHaveLength(1);
        return statements.length;
      } finally {
        spy.mockRestore();
      }
    };
    const reads = [
      { read: () => overview(app.id, demo), ceiling: 15 },
      {
        read: () => createDocumentsService(database.db).list(demo, app.bankId, app.id),
        ceiling: 14,
      },
    ];
    const initial = [];
    for (const { read, ceiling } of reads) initial.push(await measure(read, ceiling));
    for (let i = 0; i < 8; i++) {
      const added = await source(app, "business-tax-return-2024");
      await database.db
        .update(documents)
        .set({ taskId: task.id })
        .where(eq(documents.id, added.documentId));
      await source(app, "business-tax-return-2025", first.documentId);
    }
    for (const [i, { read, ceiling }] of reads.entries())
      expect(await measure(read, ceiling)).toBe(initial[i]);
    const view = await overview(app.id, demo);
    expect(view.taxDocuments).toMatchObject({ documentCount: 9, versionCount: 17 });
    expect(
      view.taxDocuments.documents.find((document) => document.documentId === first.documentId)
        ?.versionCount,
    ).toBe(9);
    const detail = await createDocumentsService(database.db).list(demo, app.bankId, app.id);
    expect(detail.documents).toHaveLength(9);
    expect(
      detail.documents.every((document) =>
        document.versions.every((version) => version.processing?.history.length === 1),
      ),
    ).toBe(true);
    expect(
      (await database.db.select().from(applicationTasks).where(eq(applicationTasks.id, task.id)))[0]
        ?.state,
    ).toBe(task.state);
  });

  it("counts logical business tax documents separately from history and distinct accepted periods", async () => {
    const app = await fixture();
    const returns = [];
    for (const year of [2023, 2024, 2025]) {
      returns.push(await source(app, `business-tax-return-${year}` as DemoImportRecipeId));
    }
    for (const evidence of returns.slice(0, 2))
      await submit(app.id, await command(app.id, evidence.documentId));
    const initial = await overview(app.id);
    expect(initial.taxDocuments).toMatchObject({
      documentCount: 3,
      versionCount: 3,
      reviewedCount: 2,
      waitingForReviewCount: 1,
      currentAcceptedPeriodCount: 2,
      staleCount: 0,
    });
    expect(initial.taxDocuments.documents.map((document) => document.period?.start)).toEqual([
      "2025-01-01",
      "2024-01-01",
      "2023-01-01",
    ]);
    expect(initial.financialFacts.facts.map((fact) => fact.value)).toEqual([
      "1200000.00",
      "1350000.00",
    ]);
    expect(
      initial.financialFacts.facts.every((fact) => fact.source.versionId && fact.source.runId),
    ).toBe(true);

    const replacement = await source(app, "business-tax-return-2023", returns[0]!.documentId);
    const stale = await overview(app.id);
    expect(stale.taxDocuments).toMatchObject({
      documentCount: 3,
      versionCount: 4,
      reviewedCount: 1,
      staleCount: 1,
      currentAcceptedPeriodCount: 1,
    });
    expect(
      stale.taxDocuments.documents.find(
        (document) => document.documentId === replacement.documentId,
      ),
    ).toMatchObject({
      currentVersionId: replacement.versionId,
      versionCount: 2,
      reviewStatus: "source_stale",
      staleFactCount: 1,
    });
    expect(
      stale.financialFacts.facts.find((fact) => fact.period.start === "2023-01-01"),
    ).toMatchObject({
      value: "1200000.00",
      sourceStale: true,
      source: { versionId: returns[0]!.versionId },
    });
    await submit(app.id, await command(app.id, replacement.documentId));
    const duplicate = await source(app, "business-tax-return-2023");
    await submit(app.id, await command(app.id, duplicate.documentId));
    const duplicated = await overview(app.id);
    expect(duplicated.taxDocuments).toMatchObject({
      documentCount: 4,
      versionCount: 5,
      currentAcceptedPeriodCount: 2,
    });
    expect(
      duplicated.financialFacts.facts.filter((fact) => fact.period.start === "2023-01-01"),
    ).toHaveLength(1);
  });

  it("excludes personal records, other document categories and other applications from the business aggregate", async () => {
    const app = await fixture();
    const business = await source(app);
    const personal = await source(app, "business-tax-return-2024");
    await database.db
      .update(documents)
      .set({ visibility: "private", subjectUserId: ids.borrower })
      .where(eq(documents.id, personal.documentId));
    await source(app, "business-bank-statement-2026-01");
    const other = await fixture();
    await source(other, "business-tax-return-2025");
    const view = await overview(app.id);
    expect(view.taxDocuments.documentCount).toBe(1);
    expect(view.taxDocuments.documents[0]).toMatchObject({
      documentId: business.documentId,
      subjectKind: "business",
      subjectLabel: app.businessName,
      acceptedFactCount: 0,
      reviewStatus: "waiting_for_review",
      expectedPeriod: null,
    });
    expect(view.financialFacts.facts).toEqual([]);
  });

  it("keeps rejected/unconfirmed values distinct, retains empty legacy fields and fences lifecycle writes", async () => {
    const app = await fixture();
    const initial = await overview(app.id);
    expect(initial.taxDocuments).toMatchObject({
      documentCount: 0,
      versionCount: 0,
      currentAcceptedPeriodCount: 0,
    });
    expect(initial.financialFacts.facts).toEqual([]);
    const evidence = await source(app);
    const rejected = await command(app.id, evidence.documentId);
    rejected.decisions[0]!.disposition = "reject";
    await submit(app.id, rejected);
    const rejection = await overview(app.id);
    expect(rejection.taxDocuments).toMatchObject({
      rejectedCount: 1,
      reviewedCount: 0,
      currentAcceptedPeriodCount: 0,
    });
    expect(rejection.financialFacts.facts).toEqual([]);
    const accepted = await command(app.id, evidence.documentId);
    await submit(app.id, accepted);
    await expect(
      submit(app.id, { ...accepted, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const editable = await overview(app.id);
    await database.db
      .update(applications)
      .set({ status: "submitted" })
      .where(eq(applications.id, app.id));
    const locked = await overview(app.id);
    expect(locked.financialFacts.canReview).toBe(false);
    expect(locked.financialFacts.facts).toEqual(editable.financialFacts.facts);
    expect(locked.financialFacts.candidates.every((candidate) => !candidate.canReview)).toBe(true);
    await expect(submit(app.id, await command(app.id, evidence.documentId))).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("retains tax groups while analysis is pending and distinguishes expected from actual periods", async () => {
    const app = await fixture();
    const evidence = await source(app);
    await submit(app.id, await command(app.id, evidence.documentId));
    const expectedPeriod = { start: "2024-01-01", end: "2024-12-31", basis: "fiscal_year" };
    await createDocumentsService(database.db).updateMetadata(
      officer,
      ids.bankA,
      app.id,
      evidence.documentId,
      {
        versionId: evidence.versionId,
        expectedRevision: 0,
        displayName: "Review the reporting year",
        description: null,
        expectedPeriod,
        reason: "Expected a different reporting period",
      },
      randomUUID(),
    );
    const view = await overview(app.id);
    expect(view.taxDocuments).toMatchObject({
      documentCount: 1,
      staleCount: 1,
      currentAcceptedPeriodCount: 0,
    });
    expect(view.taxDocuments.documents[0]).toMatchObject({
      period: null,
      expectedPeriod,
      classificationStale: true,
      processingState: "queued",
      reviewStatus: "source_stale",
      acceptedFactCount: 0,
      staleFactCount: 1,
    });
    expect(view.financialFacts.facts[0]).toMatchObject({
      value: "1200000.00",
      sourceStale: true,
      period: { start: "2023-01-01", end: "2023-12-31", basis: "fiscal_year" },
    });
  });

  it.each([
    { recipe: "business-tax-return-2023", correction: "other", count: 0 },
    { recipe: "business-bank-statement-2026-01", correction: "tax", count: 1 },
  ] as const)(
    "preserves prior staff $correction classification for an unresolved replacement",
    async ({ recipe, correction, count }) => {
      const app = await fixture();
      const original = await source(app, recipe);
      await createDocumentsService(database.db).correctCategory(
        officer,
        ids.bankA,
        app.id,
        original.documentId,
        {
          versionId: original.versionId,
          expectedRevision: 0,
          category: correction,
          reason: "Staff reviewed the document's effective classification",
        },
        randomUUID(),
      );
      const replacement = await source(app, recipe, original.documentId);
      await database.db
        .update(documentProcessingRuns)
        .set({ state: "queued", result: null })
        .where(eq(documentProcessingRuns.id, replacement.runId));
      const view = await overview(app.id);
      expect(view.taxDocuments.documentCount).toBe(count);
      if (count)
        expect(view.taxDocuments.documents[0]).toMatchObject({
          currentVersionId: replacement.versionId,
          versionCount: 2,
          classificationStale: true,
          processingState: "queued",
          period: null,
        });
    },
  );

  it("requires current staff membership and exact bank/application scope before any projection", async () => {
    const app = await fixture();
    await source(app);
    for (const actor of [
      { kind: "anonymous" } as Actor,
      { kind: "user", userId: ids.borrower } as Actor,
      { kind: "user", userId: ids.officerB } as Actor,
      { kind: "user", userId: ids.officerA, demoBankId: ids.bankB } as Actor,
      {
        kind: "system",
        bankId: ids.bankA,
        applicationIds: [app.id],
        capabilities: ["application:read"],
      } as Actor,
    ])
      await expect(overview(app.id, actor)).rejects.toMatchObject({ statusCode: 404 });
    await expect(overview(ids.applicationOtherBank)).rejects.toMatchObject({ statusCode: 404 });
    await expect(overview(app.id, officer, ids.bankB)).rejects.toMatchObject({ statusCode: 404 });
    await overview(app.id);
    const membership = and(
      eq(bankMemberships.bankId, ids.bankA),
      eq(bankMemberships.userId, ids.officerA),
    );
    await database.db.update(bankMemberships).set({ revokedAt: now }).where(membership);
    try {
      await expect(overview(app.id)).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      await database.db.update(bankMemberships).set({ revokedAt: null }).where(membership);
    }
  });
});
