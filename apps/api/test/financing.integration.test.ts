import { randomUUID } from "node:crypto";
import { financingViewSchema, reviewViewSchema } from "@keylend/contracts";
import { applicationParticipants, applicationSetups, applications } from "@keylend/db";
import { seedIds as ids, seedDatabase } from "@keylend/db/seed";
import { createTestDatabase } from "@keylend/db/testing";
import {
  type Actor,
  createChecksService,
  createIdentifierCipher,
  createReviewService,
  createTasksService,
} from "@keylend/domain";
import { processCheckRun } from "@keylend/integrations/check-jobs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const encryptionKey = "2a".repeat(32),
  origin = "http://localhost:3002",
  csrf = "synthetic-financing-csrf-01234567890123";
const borrower: Actor = { kind: "user", userId: ids.borrower },
  officer: Actor = { kind: "user", userId: ids.officerA };
const base = (id: string) => `/api/v1/banks/${ids.bankA}/applications/${id}`;
const command = (expectedRevision: number) => ({ expectedRevision, idempotencyKey: randomUUID() });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString, { isolationFixtures: true });
}, 30000);
afterAll(async () => database?.cleanup());

async function fixture() {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  const id = randomUUID();
  await database.db
    .insert(applications)
    .values({ ...source!, id, status: "collecting_information", revision: 1 });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: new Date(),
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
  return id;
}
const facilities = [
  { key: "sba", family: "sba_7a", principal: "5000000.00" },
  { key: "conv", family: "conventional_term", security: "secured", principal: "4000000.00" },
];
const draft = (expectedDraftRevision: number | null, items: object[] = facilities) => ({
  idempotencyKey: randomUUID(),
  expectedDraftRevision,
  facilities: items,
  uses: [],
  sources: [],
  allocations: [],
  lineage: [],
});

for (const transport of ["fastify", "worker"] as const)
  describe(`${transport} structured financing routes`, () => {
    async function client(userId: string | null = ids.borrower) {
      const options = {
        db: database.db,
        encryptionKey,
        allowedOrigins: [origin],
        authenticate: async () => ({
          actor: userId ? { kind: "user" as const, userId } : { kind: "anonymous" as const },
          csrfToken: csrf,
        }),
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const server = await buildServer(options);
      return {
        close: () => server.close(),
        async call(
          path: string,
          body?: object | string,
          overrides: Record<string, string | null> = {},
        ) {
          const headers: Record<string, string> = {
            origin,
            "content-type": "application/json",
            "x-csrf-token": csrf,
          };
          for (const [k, v] of Object.entries(overrides)) {
            if (v === null) delete headers[k];
            else headers[k] = v;
          }
          const method = body === undefined ? "GET" : "POST",
            raw =
              typeof body === "string"
                ? body
                : body === undefined
                  ? undefined
                  : JSON.stringify(body);
          if (transport === "fastify") {
            const r = await server.inject({
              url: path,
              method,
              headers,
              ...(raw === undefined ? {} : { payload: raw }),
            });
            return { status: r.statusCode, body: JSON.parse(r.body) as unknown };
          }
          const r = await handleWorkerRequest(
            new Request(origin + path, {
              method,
              headers,
              ...(raw === undefined ? {} : { body: raw }),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          return { status: r.status, body: (await r.json()) as unknown };
        },
      };
    }

    it("reads, converts, drafts and publishes a $9M structure with scoped denial and replay", async () => {
      const id = await fixture();
      const staff = await client(ids.officerA),
        user = await client(),
        outside = await client(ids.officerB),
        anonymous = await client(null);
      const route = `${base(id)}/financing`;
      try {
        let view = financingViewSchema.parse((await staff.call(route)).body);
        expect(view).toMatchObject({ mode: "legacy", capabilities: { saveRequest: true } });
        expect((await outside.call(route)).status).toBe(404);
        expect((await anonymous.call(route)).status).toBe(404);
        expect((await staff.call(route.replace(ids.bankA, ids.bankB))).status).toBe(404);
        const start = {
          ...command(view.revision),
          requestedAmount: "9000000.00",
          productPreference: "sba_7a",
        };
        expect(
          (await staff.call(`${route}/request`, { ...start, requestedAmount: "0.00" })).status,
        ).toBe(400);
        expect(
          (await staff.call(`${route}/request`, start, { "x-csrf-token": "wrong" })).status,
        ).toBe(403);
        expect((await staff.call(`${route}/request`, start, { origin: null })).status).toBe(403);
        expect((await outside.call(`${route}/request`, start)).status).toBe(404);
        const converted = await staff.call(`${route}/request`, start);
        expect(converted.status, JSON.stringify(converted.body)).toBe(200);
        view = financingViewSchema.parse(converted.body);
        expect(view).toMatchObject({
          mode: "structured",
          request: { revision: 1, requestedAmount: "9000000.00", productPreference: "sba_7a" },
        });
        expect((await staff.call(`${route}/request`, start)).body).toEqual(converted.body);
        expect((await user.call(`${route}/draft`, draft(null))).status).toBe(404);
        expect(
          (
            await staff.call(
              `${route}/draft`,
              draft(null, [{ ...facilities[0], principal: "-1.00" }]),
            )
          ).status,
        ).toBe(400);
        const saved = await staff.call(`${route}/draft`, draft(null));
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        view = financingViewSchema.parse(saved.body);
        expect(view.draft?.facilities.map((f) => [f.variant, f.principal])).toEqual([
          ["sba_7a_standard", "5000000.00"],
          ["conventional_term_secured", "4000000.00"],
        ]);
        expect((await staff.call(`${route}/draft`, draft(null))).status).toBe(409);
        const publication = {
          ...command(view.revision),
          expectedDraftRevision: 1,
          reason: "SBA 7(a) with a conventional companion",
        };
        expect((await user.call(`${route}/draft/publish`, publication)).status).toBe(404);
        const published = await staff.call(`${route}/draft/publish`, publication);
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        expect((await staff.call(`${route}/draft/publish`, publication)).body).toEqual(
          published.body,
        );
        expect(
          (
            await staff.call(`${route}/draft/publish`, {
              ...publication,
              idempotencyKey: randomUUID(),
            })
          ).status,
        ).toBe(409);
        const applicant = financingViewSchema.parse((await user.call(route)).body);
        expect(applicant).toMatchObject({
          canManage: false,
          draft: null,
          products: [],
          published: {
            sequence: 1,
            reason: null,
            findings: [],
            totals: { financing: "9000000.00" },
          },
        });
      } finally {
        await Promise.all([staff.close(), user.close(), outside.close(), anonymous.close()]);
      }
    });

    it("submits a structured application but denies direct legacy decision, closing and funding calls", async () => {
      const id = await fixture();
      const staff = await client(ids.officerA),
        user = await client();
      const route = `${base(id)}/financing`;
      try {
        let view = financingViewSchema.parse((await staff.call(route)).body);
        view = financingViewSchema.parse(
          (
            await staff.call(`${route}/request`, {
              ...command(view.revision),
              requestedAmount: "9000000.00",
              productPreference: "sba_7a",
            })
          ).body,
        );
        view = financingViewSchema.parse((await staff.call(`${route}/draft`, draft(null))).body);
        view = financingViewSchema.parse(
          (
            await staff.call(`${route}/draft/publish`, {
              ...command(view.revision),
              expectedDraftRevision: 1,
              reason: "Initial structure",
            })
          ).body,
        );
        const tasks = createTasksService(database.db),
          checks = createChecksService(database.db, {
            cipher: createIdentifierCipher(encryptionKey),
          });
        for (const t of (await tasks.read(officer, ids.bankA, id)).tasks.filter(
          (t) =>
            t.required && t.stage !== "closing" && t.inputKind !== "synthetic_business_identifier",
        ))
          await tasks.waive(
            officer,
            ids.bankA,
            id,
            t.id,
            { expectedRevision: t.revision, reason: "Audited synthetic HTTP fixture" },
            randomUUID(),
          );
        const t = (await tasks.read(borrower, ids.bankA, id)).tasks.find(
          (t) => t.inputKind === "synthetic_business_identifier",
        )!;
        await checks.captureIdentifier(
          borrower,
          ids.bankA,
          id,
          t.id,
          {
            expectedRevision: t.revision,
            expectedInputRevision: t.secureInput!.revision,
            value: "000000001",
          },
          randomUUID(),
        );
        for (const c of (await checks.read(officer, ids.bankA, id)).checks)
          await processCheckRun(
            database.db,
            createIdentifierCipher(encryptionKey),
            c.currentRunId!,
            {
              delayMs: 0,
              deadlineMs: 1000,
            },
          );
        const review = createReviewService(database.db);
        let reviewed = await review.read(borrower, ids.bankA, id);
        reviewed = reviewViewSchema.parse(
          (await user.call(`${base(id)}/review/submit`, command(reviewed.revision))).body,
        );
        expect(reviewed.status).toBe("submitted");
        reviewed = reviewViewSchema.parse(
          (await staff.call(`${base(id)}/review/start-review`, command(reviewed.revision))).body,
        );
        expect(reviewed).toMatchObject({
          status: "in_review",
          capabilities: { approve: false, decline: false, requestInformation: true },
        });
        const snapshot = (
          await database.pool.query(
            "SELECT snapshot FROM application_submissions WHERE application_id = $1",
            [id],
          )
        ).rows[0]?.snapshot;
        expect(snapshot.facts).toMatchObject({
          productName: "Structured financing request",
          requestedAmount: "9000000.00",
          financing: {
            mode: "structured",
            requestRevision: 1,
            requestedAmount: "9000000.00",
            productPreference: "sba_7a",
            structureSequence: 1,
          },
        });
        expect(snapshot.references.financing).toEqual({
          requestRevisionId: view.request?.id,
          structureRevisionId: view.published?.id,
        });
        const unavailable = {
          error: expect.objectContaining({ code: "FINANCING_LIFECYCLE_UNAVAILABLE" }),
        };
        const approve = await staff.call(`${base(id)}/review/approve`, {
          ...command(reviewed.revision),
          humanDecisionConfirmed: true,
          reasonCode: "demo_criteria_met",
          approvedAmount: "5000000.00",
        });
        expect(approve).toMatchObject({ status: 409, body: unavailable });
        expect(
          await staff.call(`${base(id)}/review/decline`, {
            ...command(reviewed.revision),
            humanDecisionConfirmed: true,
            reasonCode: "demo_criteria_not_met",
          }),
        ).toMatchObject({ status: 409, body: unavailable });
        await database.db
          .update(applications)
          .set({ status: "approved" })
          .where(eq(applications.id, id));
        expect(
          await staff.call(`${base(id)}/closing/start`, command(reviewed.revision)),
        ).toMatchObject({
          status: 409,
          body: unavailable,
        });
        await database.db
          .update(applications)
          .set({ status: "closing" })
          .where(eq(applications.id, id));
        expect(
          await staff.call(`${base(id)}/closing/fund`, {
            ...command(reviewed.revision),
            humanFundingConfirmed: true,
            fundedAmount: "9000000.00",
            fundedOn: new Date().toISOString().slice(0, 10),
            reference: "BYPASS-ATTEMPT",
          }),
        ).toMatchObject({ status: 409, body: unavailable });
        for (const table of [
          "application_decisions",
          "application_closing_packages",
          "funding_records",
          "loan_accounts",
        ])
          expect(
            (await database.pool.query(`SELECT 1 FROM ${table} WHERE application_id = $1`, [id]))
              .rows,
          ).toEqual([]);
      } finally {
        await Promise.all([staff.close(), user.close()]);
      }
    });
  });
