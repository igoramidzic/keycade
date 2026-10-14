import { randomUUID } from "node:crypto";
import type { FinancingView, SaveFinancingDraft } from "@keylend/contracts";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  auditEvents,
  documents,
  documentVersions,
  financingCommands,
  financingFacilities,
  financingFacilityVersions,
  financingRequestRevisions,
  financingStructureRevisions,
} from "@keylend/db";
import { seedIds as ids, seedDatabase } from "@keylend/db/seed";
import { createTestDatabase } from "@keylend/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createActivityService,
  createClosingService,
  createDocumentsService,
  createFinancingService,
  createReviewService,
  createTasksService,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const now = new Date("2026-10-13T12:00:00Z");
const borrower: Actor = { kind: "user", userId: ids.borrower };
const officer: Actor = { kind: "user", userId: ids.officerA };
const outsider: Actor = { kind: "user", userId: ids.officerB };
const financing = () => createFinancingService(database.db, { clock: () => now });
const denied = { code: "NOT_FOUND", statusCode: 404 };
const invalidInput = { code: "INVALID_INPUT", statusCode: 400 };
const invalidState = { code: "INVALID_STATE", statusCode: 409 };
const conflict = { code: "REVISION_CONFLICT", statusCode: 409 };
const unavailable = { code: "FINANCING_LIFECYCLE_UNAVAILABLE", statusCode: 409 };

beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString, { isolationFixtures: true });
}, 30000);
afterAll(async () => database?.cleanup());

async function fixture(
  options: { status?: "collecting_information" | "draft" | "submitted" } = {},
) {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("missing seed");
  const id = randomUUID();
  await database.db.insert(applications).values({
    ...source,
    id,
    status: options.status ?? "collecting_information",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: options.status === "draft" ? null : now,
    completedByUserId: options.status === "draft" ? null : ids.borrower,
  });
  await database.db.insert(applicationParticipants).values({
    bankId: ids.bankA,
    applicationId: id,
    userId: ids.borrower,
    role: "applicant_admin",
    scope: "full",
    synthetic: true,
  });
  return id;
}
const request = (
  view: Pick<FinancingView, "revision">,
  requestedAmount: string | null,
  productPreference: string | null,
  reason?: string,
) => ({
  expectedRevision: view.revision,
  idempotencyKey: randomUUID(),
  requestedAmount,
  productPreference,
  ...(reason ? { reason } : {}),
});
type Facility = SaveFinancingDraft["facilities"][number];
const draft = (
  view: Pick<FinancingView, "draft">,
  facilities: Facility[],
  extra: Partial<SaveFinancingDraft> = {},
) => ({
  idempotencyKey: randomUUID(),
  expectedDraftRevision: view.draft?.draftRevision ?? null,
  facilities,
  uses: [],
  sources: [],
  allocations: [],
  lineage: [],
  ...extra,
});
const publish = (view: FinancingView, reason: string) => ({
  expectedRevision: view.revision,
  expectedDraftRevision: view.draft?.draftRevision ?? 0,
  idempotencyKey: randomUUID(),
  reason,
});
async function structured(amount = "9000000.00", preference = "sba_7a") {
  const id = await fixture();
  const legacy = await financing().read(officer, ids.bankA, id);
  const view = await financing().saveRequest(
    officer,
    ids.bankA,
    id,
    request(legacy, amount, preference),
    randomUUID(),
  );
  return { id, view };
}
const sba = (principal: string | null, key = "sba"): Facility => ({
  key,
  family: "sba_7a",
  principal,
});
const conventional = (principal: string | null, key = "conv"): Facility => ({
  key,
  family: "conventional_term",
  security: "secured",
  principal,
});
async function rows(id: string) {
  return {
    requests: await database.db
      .select()
      .from(financingRequestRevisions)
      .where(eq(financingRequestRevisions.applicationId, id))
      .orderBy(asc(financingRequestRevisions.id)),
    structures: await database.db
      .select()
      .from(financingStructureRevisions)
      .where(eq(financingStructureRevisions.applicationId, id))
      .orderBy(asc(financingStructureRevisions.id)),
    facilities: await database.db
      .select()
      .from(financingFacilities)
      .where(eq(financingFacilities.applicationId, id))
      .orderBy(asc(financingFacilities.id)),
    versions: await database.db
      .select()
      .from(financingFacilityVersions)
      .where(eq(financingFacilityVersions.applicationId, id))
      .orderBy(asc(financingFacilityVersions.id)),
    commands: await database.db
      .select()
      .from(financingCommands)
      .where(eq(financingCommands.applicationId, id))
      .orderBy(asc(financingCommands.id)),
  };
}

describe("structured financing requests and revisions", () => {
  it("starts from a legacy application and round-trips a $9M SBA need with a $5M/$4M split exactly", async () => {
    const id = await fixture();
    const legacy = await financing().read(officer, ids.bankA, id);
    expect(legacy).toMatchObject({
      mode: "legacy",
      lifecycle: { creditDecision: "legacy_amount_approval", funding: "legacy_single_funding" },
      capabilities: { saveRequest: true, saveDraft: false, approve: false, fund: false },
      legacy: {
        productName: "Synthetic Business Credit",
        productVersion: 1,
        requestedAmount: "10000.00",
        approvedAmount: null,
        loanAccountId: null,
      },
      request: null,
      products: expect.arrayContaining([
        expect.objectContaining({
          variant: "sba_7a_standard",
          maximum: "5000000.00",
          maximumBasis: "program_restriction",
        }),
      ]),
    });
    expect(legacy.products).toHaveLength(5);
    let view = await financing().saveRequest(
      officer,
      ids.bankA,
      id,
      request(legacy, "9000000.00", "sba_7a"),
      randomUUID(),
    );
    expect(view).toMatchObject({
      mode: "structured",
      revision: 2,
      lifecycle: { creditDecision: "unavailable", funding: "unavailable" },
      legacy: null,
      request: {
        revision: 1,
        requestedAmount: "9000000.00",
        productPreference: "sba_7a",
        authorKind: "staff",
        confirmedByApplicant: false,
        catalogVersion: "2026-10-12",
      },
    });
    // The applicant confirms the staff-entered need; the original staff revision stays in history.
    view = await financing().saveRequest(
      borrower,
      ids.bankA,
      id,
      request(view, "9000000.00", "sba_7a"),
      randomUUID(),
    );
    expect(view.requestHistory.map((r) => [r.revision, r.authorKind, r.reason])).toEqual([
      [1, "staff", null],
      [2, "applicant", "Confirmed by the applicant."],
    ]);
    const staffView = await financing().read(officer, ids.bankA, id);
    view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(staffView, [sba("5000000.00"), conventional("4000000.00")]),
      randomUUID(),
    );
    expect(view.draft).toMatchObject({
      state: "draft",
      draftRevision: 1,
      requestRevision: 2,
      totals: { requestedNeed: "9000000.00", financing: "9000000.00", financingGap: "0.00" },
      ready: { publication: true, approval: false, funding: false },
    });
    expect(
      view.draft?.facilities.map((f) => [f.ordinal, f.variant, f.principal, f.policy?.version]),
    ).toEqual([
      [1, "sba_7a_standard", "5000000.00", 1],
      [2, "conventional_term_secured", "4000000.00", 1],
    ]);
    expect(view.capabilities.publish).toBe(true);
    view = await financing().publish(
      officer,
      ids.bankA,
      id,
      publish(view, "Proposed SBA 7(a) with a conventional companion facility"),
      randomUUID(),
    );
    expect(view).toMatchObject({
      revision: 4,
      draft: null,
      published: { state: "published", sequence: 1, requestRevision: 2 },
      publishedHistory: [{ sequence: 1, facilityCount: 2, financing: "9000000.00" }],
    });
    const stored = await database.pool.query(
      `SELECT r.requested_amount::text AS need, v.principal::text AS principal, a.requested_amount::text AS mirrored, a.financing_mode
       FROM financing_facility_versions v
       JOIN financing_structure_revisions s ON s.id = v.structure_revision_id
       JOIN financing_request_revisions r ON r.id = s.request_revision_id
       JOIN applications a ON a.id = v.application_id
       WHERE v.application_id = $1 ORDER BY v.position`,
      [id],
    );
    expect(stored.rows).toEqual([
      {
        need: "9000000.00",
        principal: "5000000.00",
        mirrored: "9000000.00",
        financing_mode: "structured",
      },
      {
        need: "9000000.00",
        principal: "4000000.00",
        mirrored: "9000000.00",
        financing_mode: "structured",
      },
    ]);
    const applicant = await financing().read(borrower, ids.bankA, id);
    expect(applicant).toMatchObject({
      canManage: false,
      draft: null,
      products: [],
      published: { sequence: 1, reason: null, findings: [] },
      publishedHistory: [{ reason: null }],
    });
    expect(applicant.capabilities).toMatchObject({ saveRequest: true, saveDraft: false });
    // History shows the request and publication, never draft working copies.
    const activity = createActivityService(database.db);
    const financingHistory = async (actor: Actor) =>
      (await activity.list(actor, ids.bankA, id)).entries
        .map((entry) => entry.description)
        .filter((description) => /financing/i.test(description))
        .sort();
    const expected = [
      "Financing request revised",
      "Financing structure published",
      "Structured financing request started",
    ];
    expect(await financingHistory(officer)).toEqual(expected);
    expect(await financingHistory(borrower)).toEqual(expected);
  });

  it("saves a $6M single 7(a) proposal but blocks publication and every legacy decision or funding route", async () => {
    const { id, view: started } = await structured();
    const view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(started, [sba("6000000.00"), conventional("3000000.00")]),
      randomUUID(),
    );
    const facilityId = view.draft?.facilities[0]?.facilityId;
    expect(view.draft?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "facility_above_maximum",
          facilityId,
          amount: "5000000.00",
          basis: "program_restriction",
          blocks: ["publication", "approval", "funding"],
        }),
        expect.objectContaining({ code: "program_aggregate_exceeded", amount: "5000000.00" }),
      ]),
    );
    expect(view.draft?.ready).toEqual({ publication: false, approval: false, funding: false });
    expect(view.capabilities).toMatchObject({ publish: false, approve: false, fund: false });
    await expect(
      financing().publish(officer, ids.bankA, id, publish(view, "Not eligible"), randomUUID()),
    ).rejects.toMatchObject(invalidState);
    expect((await financing().read(officer, ids.bankA, id)).draft?.draftRevision).toBe(1);

    // Direct calls to the old single-product routes cannot reach a structured application.
    const review = createReviewService(database.db, { clock: () => now });
    const closing = createClosingService(database.db, { clock: () => now });
    const force = (status: "in_review" | "approved" | "closing") =>
      database.db.update(applications).set({ status }).where(eq(applications.id, id));
    const command = { expectedRevision: view.revision, idempotencyKey: randomUUID() };
    await force("in_review");
    expect((await review.read(officer, ids.bankA, id)).capabilities).toMatchObject({
      approve: false,
      decline: false,
    });
    await expect(
      review.approve(
        officer,
        ids.bankA,
        id,
        {
          ...command,
          humanDecisionConfirmed: true,
          reasonCode: "demo_criteria_met",
          approvedAmount: "5000000.00",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject(unavailable);
    await expect(
      review.decline(
        officer,
        ids.bankA,
        id,
        { ...command, humanDecisionConfirmed: true, reasonCode: "demo_criteria_not_met" },
        randomUUID(),
      ),
    ).rejects.toMatchObject(unavailable);
    await force("approved");
    await expect(
      closing.startClosing(officer, ids.bankA, id, command, randomUUID()),
    ).rejects.toMatchObject(unavailable);
    await force("closing");
    await expect(
      closing.recordFunding(
        officer,
        ids.bankA,
        id,
        {
          ...command,
          humanFundingConfirmed: true,
          fundedAmount: "6000000.00",
          fundedOn: "2026-10-13",
          reference: "BYPASS",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject(unavailable);
    // The database refuses legacy credit records even from code that skips the domain guard.
    await expect(
      database.pool.query(
        `INSERT INTO application_decisions (bank_id, application_id, submission_id, application_revision, outcome, reason_code, approved_amount, decided_by_user_id, evidence)
         VALUES ($1, $2, $3, 9, 'approved', 'demo_criteria_met', 6000000, $4, '{}')`,
        [ids.bankA, id, randomUUID(), ids.officerA],
      ),
    ).rejects.toThrow(/cannot use legacy decisions/);
    await expect(
      database.pool.query("UPDATE applications SET financing_mode = 'legacy' WHERE id = $1", [id]),
    ).rejects.toThrow(/cannot change financing mode/);
    for (const table of [
      "application_decisions",
      "application_closing_packages",
      "funding_records",
      "loan_accounts",
    ])
      expect(
        (await database.pool.query(`SELECT 1 FROM ${table} WHERE application_id = $1`, [id])).rows,
      ).toEqual([]);
  });

  it("validates exact totals, contributions and allocations and rejects foreign references", async () => {
    const { id, view: started } = await structured();
    const other = await structured();
    const otherDraft = await financing().saveDraft(
      officer,
      ids.bankA,
      other.id,
      draft(other.view, [sba("5000000.00")]),
      randomUUID(),
    );
    const foreignFacility = otherDraft.draft?.facilities[0]?.facilityId as string;
    const reject = (input: object, expected: object) =>
      expect(
        financing().saveDraft(officer, ids.bankA, id, input, randomUUID()),
      ).rejects.toMatchObject(expected);
    for (const principal of ["0.00", "-1.00", "1.001", "1000000"])
      await reject(draft(started, [sba(principal)]), invalidInput);
    const uses = [
      {
        key: "equipment",
        category: "equipment_purchase",
        description: "Line",
        amount: "6000000.00",
      },
      { key: "capital", category: "working_capital", description: "Cash", amount: "3500000.00" },
      { key: "fees", category: "fees_and_closing_costs", description: "Fees", amount: "500000.00" },
    ] as const;
    const sources = [
      { key: "equity", kind: "borrower_contribution", description: "Cash", amount: "1000000.00" },
    ] as const;
    const facilities = [sba("5000000.00"), conventional("4000000.00")];
    const allocations = [
      { useKey: "equipment", facilityKey: "sba", amount: "5000000.00" },
      { useKey: "equipment", sourceKey: "equity", amount: "1000000.00" },
      { useKey: "capital", facilityKey: "conv", amount: "3500000.00" },
      { useKey: "fees", facilityKey: "conv", amount: "500000.00" },
    ];
    const full = { uses: [...uses], sources: [...sources] };
    await reject(
      draft(started, facilities, { ...full, allocations: [...allocations, allocations[0]!] }),
      invalidInput,
    );
    await reject(
      draft(started, facilities, {
        ...full,
        allocations: [{ useKey: "fees", facilityKey: "sba", amount: "500000.01" }],
      }),
      invalidInput,
    );
    await reject(
      draft(started, [sba("1000000.00"), conventional("4000000.00")], {
        ...full,
        allocations: [{ useKey: "equipment", facilityKey: "sba", amount: "1000000.01" }],
      }),
      invalidInput,
    );
    await reject(
      draft(started, [{ ...sba("5000000.00"), facilityId: foreignFacility }]),
      invalidInput,
    );
    await reject(
      draft(started, [sba("2500000.00", "a"), sba("2500000.00", "b")], {
        lineage: [
          { kind: "split", predecessorFacilityIds: [foreignFacility], successorKeys: ["a", "b"] },
        ],
      }),
      invalidInput,
    );
    expect((await rows(id)).structures).toEqual([]);
    expect((await rows(id)).facilities).toEqual([]);
    await expect(financing().read(outsider, ids.bankA, id)).rejects.toMatchObject(denied);
    await expect(financing().read(officer, ids.bankB, id)).rejects.toMatchObject(denied);
    await expect(
      financing().saveDraft(outsider, ids.bankA, id, draft(started, facilities), randomUUID()),
    ).rejects.toMatchObject(denied);
    await expect(
      financing().saveDraft(borrower, ids.bankA, id, draft(started, facilities), randomUUID()),
    ).rejects.toMatchObject(denied);

    const view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(started, facilities, { ...full, allocations }),
      randomUUID(),
    );
    expect(view.draft?.totals).toEqual({
      requestedNeed: "9000000.00",
      financing: "9000000.00",
      contributions: "1000000.00",
      projectCost: "10000000.00",
      financingGap: "0.00",
      financingExcess: "0.00",
      unallocatedCost: "0.00",
    });
    expect(view.draft?.findings.map((f) => f.code)).not.toContain("uses_missing");
    expect(view.draft?.findings.map((f) => f.code)).not.toContain("allocation_incomplete");
    expect(view.draft?.uses.map((u) => [u.amount, u.allocated])).toEqual([
      ["6000000.00", "6000000.00"],
      ["3500000.00", "3500000.00"],
      ["500000.00", "500000.00"],
    ]);
    expect(view.draft?.sources).toEqual([
      expect.objectContaining({ kind: "borrower_contribution", allocated: "1000000.00" }),
    ]);

    // Composite keys keep every link inside one bank, application and revision.
    const structure = view.draft?.id as string;
    const policy = view.draft?.facilities[1]?.policy?.id as string;
    await expect(
      database.pool.query(
        `INSERT INTO financing_facility_versions (bank_id, application_id, structure_revision_id, facility_id, position, draft_key, family, principal)
         VALUES ($1, $2, $3, $4, 9, 'foreign', 'sba_7a', 1)`,
        [ids.bankA, id, structure, foreignFacility],
      ),
    ).rejects.toThrow(/financing_versions_facility_fk/);
    const spare = await database.pool.query<{ id: string }>(
      `INSERT INTO financing_facilities (bank_id, application_id, origin, ordinal, introduced_in_structure_id)
       VALUES ($1, $2, 'structured', 90, $3) RETURNING id`,
      [ids.bankA, id, structure],
    );
    await expect(
      database.pool.query(
        `INSERT INTO financing_facility_versions (bank_id, application_id, structure_revision_id, facility_id, position, draft_key, family, product_policy_id, principal)
         VALUES ($1, $2, $3, $4, 9, 'mismatch', 'sba_7a', $5, 1)`,
        [ids.bankA, id, structure, spare.rows[0]?.id, policy],
      ),
    ).rejects.toThrow(/financing_versions_policy_fk/);
    // An unreferenced identity introduced by a still-open draft may be discarded.
    await database.pool.query("DELETE FROM financing_facilities WHERE id = $1", [
      spare.rows[0]?.id,
    ]);
    await expect(
      database.pool.query(
        `INSERT INTO financing_allocations (bank_id, application_id, structure_revision_id, use_id, facility_version_id, amount)
         VALUES ($1, $2, $3, $4, $5, 1)`,
        [
          ids.bankA,
          id,
          structure,
          view.draft?.uses[0]?.id,
          otherDraft.draft?.facilities[0]?.versionId,
        ],
      ),
    ).rejects.toThrow(/financing_allocations_facility_fk/);
    // Structured versions can never point at a legacy single-product facility identity.
    const legacyFacility = await database.pool.query<{ id: string }>(
      `INSERT INTO financing_facilities (bank_id, application_id, origin, ordinal, legacy_product_id)
       VALUES ($1, $2, 'legacy', 91, $3) RETURNING id`,
      [ids.bankA, id, ids.productA],
    );
    await expect(
      database.pool.query(
        `INSERT INTO financing_facility_versions (bank_id, application_id, structure_revision_id, facility_id, position, draft_key, family, principal)
         VALUES ($1, $2, $3, $4, 9, 'legacy', 'equipment_term', 1)`,
        [ids.bankA, id, structure, legacyFacility.rows[0]?.id],
      ),
    ).rejects.toThrow(/financing_versions_facility_fk/);
  });

  it("supports three facilities, split/combine lineage and product replacement while preserving history and evidence", async () => {
    const { id, view: started } = await structured();
    const tasks = createTasksService(database.db, { clock: () => now });
    const documentService = createDocumentsService(database.db, { clock: () => now });
    const task = (await tasks.read(officer, ids.bankA, id)).tasks.find(
      (t) => t.visibility === "shared",
    );
    if (!task) throw new Error("missing shared task");
    const upload = await documentService.beginUpload(
      officer,
      ids.bankA,
      id,
      {
        fileName: "Synthetic evidence.pdf",
        mimeType: "application/pdf",
        expectedSize: 100,
        idempotencyKey: randomUUID(),
        taskId: task.id,
      },
      randomUUID(),
    );
    await documentService.finalizeUpload(
      officer,
      ids.bankA,
      id,
      upload.uploadId,
      { size: 100, sha256: "b".repeat(64) },
      randomUUID(),
    );
    const evidence = async () => ({
      documents: await database.db.select().from(documents).where(eq(documents.applicationId, id)),
      versions: await database.db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.applicationId, id)),
    });
    const before = await evidence();
    expect(before.documents).toHaveLength(1);

    let view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(started, [sba("5000000.00"), conventional("4000000.00")]),
      randomUUID(),
    );
    view = await financing().publish(
      officer,
      ids.bankA,
      id,
      publish(view, "Revision 1"),
      randomUUID(),
    );
    const [a, b] = view.published?.facilities ?? [];
    if (!a || !b) throw new Error("missing facilities");
    const firstRevision = (await rows(id)).versions;

    // Split B into a conventional and an equipment facility: three facilities, still $9M.
    view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(
        view,
        [
          { ...sba("5000000.00", "a"), facilityId: a.facilityId },
          conventional("3000000.00", "c"),
          { key: "d", family: "equipment_term", principal: "1000000.00" },
        ],
        {
          lineage: [
            { kind: "split", predecessorFacilityIds: [b.facilityId], successorKeys: ["c", "d"] },
          ],
        },
      ),
      randomUUID(),
    );
    expect(view.draft?.facilities.map((f) => [f.ordinal, f.variant, f.lineage])).toEqual([
      [1, "sba_7a_standard", []],
      [
        3,
        "conventional_term_secured",
        [{ kind: "split", predecessorFacilityId: b.facilityId, predecessorOrdinal: 2 }],
      ],
      [
        4,
        "equipment_term",
        [{ kind: "split", predecessorFacilityId: b.facilityId, predecessorOrdinal: 2 }],
      ],
    ]);
    view = await financing().publish(
      officer,
      ids.bankA,
      id,
      publish(view, "Three facilities"),
      randomUUID(),
    );
    const [, c, d] = view.published?.facilities ?? [];
    if (!c || !d) throw new Error("missing split facilities");

    // The need falls to $8M with a recorded reason; the original $9M request remains in history.
    await expect(
      financing().saveRequest(
        officer,
        ids.bankA,
        id,
        request(view, "8000000.00", "sba_7a"),
        randomUUID(),
      ),
    ).rejects.toMatchObject(invalidInput);
    view = await financing().saveRequest(
      officer,
      ids.bankA,
      id,
      request(view, "8000000.00", "sba_7a", "Borrower reduced the project scope"),
      randomUUID(),
    );
    view = await financing().read(officer, ids.bankA, id);
    view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(
        view,
        [{ ...sba("4500000.00", "a"), facilityId: a.facilityId }, conventional("3500000.00", "e")],
        {
          lineage: [
            {
              kind: "combine",
              predecessorFacilityIds: [c.facilityId, d.facilityId],
              successorKeys: ["e"],
            },
          ],
        },
      ),
      randomUUID(),
    );
    view = await financing().publish(
      officer,
      ids.bankA,
      id,
      publish(view, "Revised $8M need"),
      randomUUID(),
    );
    // Replacing facility A's product keeps its identity and every earlier revision.
    view = await financing().saveDraft(
      officer,
      ids.bankA,
      id,
      draft(view, [
        { ...conventional("4500000.00", "a"), facilityId: a.facilityId },
        {
          ...conventional("3500000.00", "e"),
          facilityId: view.published?.facilities[1]?.facilityId,
        },
      ]),
      randomUUID(),
    );
    view = await financing().publish(
      officer,
      ids.bankA,
      id,
      publish(view, "Product replaced"),
      randomUUID(),
    );
    expect(
      view.publishedHistory.map((h) => [
        h.sequence,
        h.requestRevision,
        h.facilityCount,
        h.financing,
      ]),
    ).toEqual([
      [1, 1, 2, "9000000.00"],
      [2, 1, 3, "9000000.00"],
      [3, 2, 2, "8000000.00"],
      [4, 2, 2, "8000000.00"],
    ]);
    expect(view.requestHistory.map((r) => [r.revision, r.requestedAmount, r.reason])).toEqual([
      [1, "9000000.00", null],
      [2, "8000000.00", "Borrower reduced the project scope"],
    ]);
    expect(view.published?.facilities.map((f) => [f.facilityId, f.variant])).toEqual([
      [a.facilityId, "conventional_term_secured"],
      [expect.any(String), "conventional_term_secured"],
    ]);
    const lineage = await database.pool.query(
      `SELECT s.sequence, l.kind, l.predecessor_facility_id AS p, l.successor_facility_id AS s
       FROM financing_facility_lineage l JOIN financing_structure_revisions s ON s.id = l.structure_revision_id
       WHERE l.application_id = $1 ORDER BY s.sequence, l.kind, l.predecessor_facility_id`,
      [id],
    );
    expect(lineage.rows).toEqual(
      expect.arrayContaining([
        { sequence: 2, kind: "split", p: b.facilityId, s: c.facilityId },
        { sequence: 2, kind: "split", p: b.facilityId, s: d.facilityId },
        {
          sequence: 3,
          kind: "combine",
          p: c.facilityId,
          s: view.published?.facilities[1]?.facilityId,
        },
        {
          sequence: 3,
          kind: "combine",
          p: d.facilityId,
          s: view.published?.facilities[1]?.facilityId,
        },
      ]),
    );
    expect(lineage.rows).toHaveLength(4);
    const after = await rows(id);
    expect(after.versions.filter((v) => firstRevision.some((f) => f.id === v.id))).toEqual(
      firstRevision,
    );
    expect(after.facilities.map((f) => f.ordinal).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await evidence()).toEqual(before);

    // Published revisions, requests, policies and identities are immutable in the database.
    const first = after.structures.find((s) => s.sequence === 1)?.id;
    for (const statement of [
      [
        "UPDATE financing_facility_versions SET principal = 1 WHERE structure_revision_id = $1",
        [first],
      ],
      ["DELETE FROM financing_facility_versions WHERE structure_revision_id = $1", [first]],
      ["UPDATE financing_structure_revisions SET reason = 'rewritten' WHERE id = $1", [first]],
      ["DELETE FROM financing_structure_revisions WHERE id = $1", [first]],
      [
        `INSERT INTO financing_uses (bank_id, application_id, structure_revision_id, position, draft_key, category, description, amount)
         VALUES ($1, $2, $3, 0, 'late', 'other', 'Late', 1)`,
        [ids.bankA, id, first],
      ],
      [
        "UPDATE financing_request_revisions SET requested_amount = 1 WHERE application_id = $1",
        [id],
      ],
      ["UPDATE financing_facilities SET ordinal = 99 WHERE id = $1", [a.facilityId]],
      ["DELETE FROM financing_facilities WHERE id = $1", [b.facilityId]],
      ["UPDATE financing_product_policies SET maximum_principal = 1 WHERE id = $1", [a.policy?.id]],
      ["DELETE FROM financing_commands WHERE application_id = $1", [id]],
    ] as const)
      await expect(database.pool.query(statement[0], [...statement[1]])).rejects.toThrow(
        /immutable/,
      );
    expect(await rows(id)).toEqual(after);
  });

  it("restricts who may start structuring and when", async () => {
    const draftApp = await fixture({ status: "draft" });
    await expect(financing().read(borrower, ids.bankA, draftApp)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    const unfinished = await financing().read(officer, ids.bankA, draftApp);
    expect(unfinished.capabilities.saveRequest).toBe(false);
    await expect(
      financing().saveRequest(
        officer,
        ids.bankA,
        draftApp,
        request(unfinished, "9000000.00", "sba_7a"),
        randomUUID(),
      ),
    ).rejects.toMatchObject(invalidState);
    const submitted = await fixture({ status: "submitted" });
    const locked = await financing().read(officer, ids.bankA, submitted);
    await expect(
      financing().saveRequest(
        officer,
        ids.bankA,
        submitted,
        request(locked, "9000000.00", null),
        randomUUID(),
      ),
    ).rejects.toMatchObject(invalidState);
    const restricted = await fixture();
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: restricted,
      userId: ids.adviser,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    });
    await expect(
      financing().read({ kind: "user", userId: ids.adviser }, ids.bankA, restricted),
    ).rejects.toMatchObject(denied);
    // The applicant may choose a preference from the portal; their revision is confirmed.
    const view = await financing().saveRequest(
      borrower,
      ids.bankA,
      restricted,
      request(await financing().read(borrower, ids.bankA, restricted), null, "help_me_choose"),
      randomUUID(),
    );
    expect(view.request).toMatchObject({
      requestedAmount: null,
      productPreference: "help_me_choose",
      authorKind: "applicant",
      confirmedByApplicant: true,
    });
    const [app] = await database.db
      .select()
      .from(applications)
      .where(eq(applications.id, restricted));
    expect(app).toMatchObject({ financingMode: "structured", requestedAmount: null });
    // Once a legacy application has a submission, the database refuses to change its mode.
    const legacy = await fixture();
    await database.pool.query(
      `INSERT INTO application_submissions (bank_id, application_id, sequence, application_revision, submitted_by_user_id, snapshot)
       VALUES ($1, $2, 1, 2, $3, '{}')`,
      [ids.bankA, legacy, ids.borrower],
    );
    await expect(
      database.pool.query("UPDATE applications SET financing_mode = 'structured' WHERE id = $1", [
        legacy,
      ]),
    ).rejects.toThrow(/cannot change financing mode/);
  });

  it("serializes concurrent edits, replays commands idempotently and rolls back failed saves", async () => {
    const id = await fixture();
    const legacy = await financing().read(officer, ids.bankA, id);
    const conversions = await Promise.allSettled([
      financing().saveRequest(
        officer,
        ids.bankA,
        id,
        request(legacy, "9000000.00", "sba_7a"),
        randomUUID(),
      ),
      financing().saveRequest(
        officer,
        ids.bankA,
        id,
        request(legacy, "7000000.00", "sba_7a"),
        randomUUID(),
      ),
    ]);
    expect(conversions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(conversions.find((r) => r.status === "rejected")).toMatchObject({ reason: conflict });
    expect((await rows(id)).requests).toHaveLength(1);
    let view = await financing().read(officer, ids.bankA, id);
    const saves = await Promise.allSettled([
      financing().saveDraft(officer, ids.bankA, id, draft(view, [sba("5000000.00")]), randomUUID()),
      financing().saveDraft(
        officer,
        ids.bankA,
        id,
        draft(view, [conventional("4000000.00")]),
        randomUUID(),
      ),
    ]);
    expect(saves.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(saves.find((r) => r.status === "rejected")).toMatchObject({ reason: conflict });
    view = await financing().read(officer, ids.bankA, id);
    expect(view.draft?.draftRevision).toBe(1);
    expect((await rows(id)).facilities).toHaveLength(1);

    // Replays return the current view without new records; a changed payload or actor conflicts.
    const input = draft(view, [sba("5000000.00"), conventional("4000000.00")]);
    const saved = await financing().saveDraft(officer, ids.bankA, id, input, randomUUID());
    const counts = await rows(id);
    expect(await financing().saveDraft(officer, ids.bankA, id, input, randomUUID())).toEqual(saved);
    expect(await rows(id)).toEqual(counts);
    await expect(
      financing().saveDraft(
        officer,
        ids.bankA,
        id,
        { ...input, facilities: [sba("1.00")] },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      financing().saveRequest(
        borrower,
        ids.bankA,
        id,
        { ...request(saved, "9000000.00", "sba_7a"), idempotencyKey: input.idempotencyKey },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(saved.draft?.facilities.map((f) => f.ordinal)).toEqual([1, 2]);

    // Publication and a request revision race on the same application revision.
    const race = await Promise.allSettled([
      financing().publish(officer, ids.bankA, id, publish(saved, "Race"), randomUUID()),
      financing().saveRequest(
        officer,
        ids.bankA,
        id,
        request(saved, "9500000.00", "sba_7a", "Racing change"),
        randomUUID(),
      ),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.find((r) => r.status === "rejected")).toMatchObject({ reason: conflict });

    // A failure after facility identities and versions were written leaves no partial draft.
    const fresh = await structured();
    const failing = draft(fresh.view, [sba("5000000.00"), conventional("4000000.00")], {
      uses: [{ key: "u", category: "other", description: "Cost", amount: "9000000.00" }],
      allocations: [{ useKey: "u", facilityKey: "sba", amount: "5000000.00" }],
    });
    await database.pool.query(
      "CREATE FUNCTION reject_test_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic allocation failure'; END $$",
    );
    await database.pool.query(
      "CREATE TRIGGER reject_test_allocation BEFORE INSERT ON financing_allocations FOR EACH ROW EXECUTE FUNCTION reject_test_allocation()",
    );
    try {
      await expect(
        financing().saveDraft(officer, ids.bankA, fresh.id, failing, randomUUID()),
      ).rejects.toThrow();
    } finally {
      await database.pool.query("DROP TRIGGER reject_test_allocation ON financing_allocations");
      await database.pool.query("DROP FUNCTION reject_test_allocation()");
    }
    const rolledBack = await rows(fresh.id);
    expect(rolledBack.structures).toEqual([]);
    expect(rolledBack.facilities).toEqual([]);
    expect(rolledBack.versions).toEqual([]);
    expect(rolledBack.commands).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.applicationId, fresh.id),
            eq(auditEvents.action, "financing.draft_saved"),
          ),
        ),
    ).toEqual([]);
    const retried = await financing().saveDraft(
      officer,
      ids.bankA,
      fresh.id,
      failing,
      randomUUID(),
    );
    expect(retried.draft?.allocations).toHaveLength(1);
  });
});
