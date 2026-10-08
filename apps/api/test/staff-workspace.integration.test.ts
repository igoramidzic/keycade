import { randomUUID } from "node:crypto";
import {
  applicationSetupSchema,
  authSessionSchema,
  staffApplicationPageSchema,
  staffOptionsSchema,
  staffWorkspaceSchema,
} from "@keycade/contracts";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createIdentityService } from "@keycade/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupFixtureSteps } from "../../../tests/setup-fixture";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => database?.cleanup());

const borrowerOrigin = "http://localhost:3001";
const staffOrigin = "http://localhost:3002";
const bankPath = `/api/v1/banks/${seedIds.bankA}/applications`;
type Credentials = { cookie: string; csrf: string; origin: string };
const staffPath = `/api/v1/banks/${seedIds.bankA}/staff`;

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} staff workspace HTTP journey with PostgreSQL`, () => {
    async function client(authDeliveryEnabled = true) {
      const options = {
        db: database.db,
        authDeliveryEnabled,
        demoSignInEnabled: true,
        allowedOrigins: [borrowerOrigin, staffOrigin],
        portalOrigins: { borrower: [borrowerOrigin], staff: [staffOrigin] },
        nodeEnv: "development" as const,
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const app = await buildServer(options);
      const ip = `synthetic-${randomUUID()}`;
      async function call(
        path: string,
        input: {
          method?: "GET" | "POST" | "PATCH";
          origin?: string;
          cookie?: string;
          csrf?: string;
          body?: unknown;
        } = {},
      ) {
        const origin = input.origin ?? borrowerOrigin;
        const headers = {
          host: new URL(origin).host,
          origin,
          "cf-connecting-ip": ip,
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
          ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        };
        if (transport === "fastify") {
          const result = await app.inject({
            url: path,
            method: input.method ?? "GET",
            headers,
            remoteAddress: ip,
            ...(input.body === undefined ? {} : { payload: JSON.stringify(input.body) }),
          });
          return {
            status: result.statusCode,
            body: result.json(),
            cookie: String(result.headers["set-cookie"] ?? "").split(";")[0] ?? "",
            requestId: String(result.headers["x-request-id"]),
          };
        }
        const result = await handleWorkerRequest(
          new Request(origin + path, {
            method: input.method ?? "GET",
            headers,
            ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          }),
          { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
        );
        return {
          status: result.status,
          body: await result.json(),
          cookie: (result.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
          requestId: result.headers.get("x-request-id") ?? "",
        };
      }
      async function credentials(cookie: string, origin = borrowerOrigin): Promise<Credentials> {
        const response = await call("/api/v1/auth/session", { cookie, origin });
        const session = authSessionSchema.parse(response.body);
        if (!session.authenticated) throw new Error("Expected authenticated synthetic session.");
        return { cookie, origin, csrf: session.csrfToken };
      }
      async function demo(email: string, portal: "borrower" | "staff" = "borrower") {
        const origin = portal === "staff" ? staffOrigin : borrowerOrigin;
        const response = await call("/api/v1/auth/demo-sign-in", {
          method: "POST",
          origin,
          body: { email, bankSlug: "bank-a", portal, returnPath: "/" },
        });
        expect(response.status).toBe(200);
        return credentials(response.cookie, origin);
      }
      return { app, call, credentials, demo };
    }

    it("scopes queue, counts, filter options, and staff aliases to current membership", async () => {
      const c = await client();
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        const submittedId = randomUUID();
        await database.pool.query(
          "INSERT INTO applications (id, bank_id, product_id, business_name, source, status, synthetic) VALUES ($1, $2, $3, 'Synthetic submitted record', 'seed', 'submitted', true)",
          [submittedId, seedIds.bankA, seedIds.productA],
        );
        await database.pool.query(
          "INSERT INTO application_setups (application_id, bank_id, current_step, completed_at) VALUES ($1, $2, 'review', now())",
          [submittedId, seedIds.bankA],
        );
        const submitted = staffApplicationPageSchema.parse(
          (await c.call(`${staffPath}/applications?status=submitted`, staff)).body,
        );
        expect(submitted.items.some((row) => row.id === submittedId)).toBe(true);
        expect(
          submitted.items.every(
            (row) => row.status === "submitted" && row.bankId === seedIds.bankA,
          ),
        ).toBe(true);
        const first = await c.call(`${staffPath}/applications?limit=2&sort=created_asc`, staff);
        expect(first.status).toBe(200);
        const page = staffApplicationPageSchema.parse(first.body);
        expect(page.items).toHaveLength(2);
        expect(page.total).toBeGreaterThanOrEqual(6);
        expect(page.items.every((row) => row.bankId === seedIds.bankA)).toBe(true);
        const second = staffApplicationPageSchema.parse(
          (await c.call(`${staffPath}/applications?limit=2&page=2&sort=created_asc`, staff)).body,
        );
        expect(second.total).toBe(page.total);
        expect(
          second.items.every((row) => !page.items.some((firstRow) => firstRow.id === row.id)),
        ).toBe(true);
        const filtered = staffApplicationPageSchema.parse(
          (
            await c.call(
              `${staffPath}/applications?search=Cedar&productId=${seedIds.productA}&status=collecting_information&assigneeId=unassigned`,
              staff,
            )
          ).body,
        );
        expect(filtered.items.some((row) => row.id === seedIds.applicationSmall)).toBe(true);
        const empty = staffApplicationPageSchema.parse(
          (await c.call(`${staffPath}/applications?search=not-existing-${randomUUID()}`, staff))
            .body,
        );
        expect(empty).toMatchObject({ items: [], total: 0, totalPages: 0 });
        const options = staffOptionsSchema.parse(
          (await c.call(`${staffPath}/options`, staff)).body,
        );
        expect(options.officers.map((officer) => officer.id)).toEqual([seedIds.officerA]);
        expect(options.products.every((product) => product.id !== seedIds.productB)).toBe(true);
        for (const query of [
          "page=0",
          "limit=101",
          "sort=purpose",
          "status=approved_by_ai",
          "extra=all",
        ])
          expect((await c.call(`${staffPath}/applications?${query}`, staff)).status).toBe(400);
        const borrower = await c.demo("borrower@example.test");
        for (const suffix of [
          "options",
          "applications",
          `applications/${seedIds.applicationSmall}/workspace`,
          `applications/${seedIds.applicationSmall}/setup`,
        ]) {
          expect((await c.call(`${staffPath}/${suffix}`, borrower)).status).toBe(404);
          expect(
            (await c.call(`${staffPath.replace(seedIds.bankA, seedIds.bankB)}/${suffix}`, staff))
              .status,
          ).toBe(404);
        }
        expect(
          (
            await c.call(
              `${staffPath}/applications/${seedIds.applicationOtherBank}/workspace`,
              staff,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await c.call(`${staffPath}/applications`, {
              ...borrower,
              method: "POST",
              body: { email: "denied@example.test", idempotencyKey: randomUUID() },
            })
          ).status,
        ).toBe(404);
        const spec = await c.call("/api/openapi.json");
        expect(spec.status).toBe(200);
        expect(
          spec.body.paths["/api/v1/banks/{bankId}/staff/applications"].get.parameters.some(
            (parameter: { name: string }) => parameter.name === "assigneeId",
          ),
        ).toBe(true);
        expect(
          spec.body.paths[
            "/api/v1/banks/{bankId}/staff/applications/{applicationId}/notes/{noteId}"
          ].patch.responses,
        ).toHaveProperty("409");
      } finally {
        await c.app.close();
      }
    });

    it("creates one pending draft and continuation intent, audits changes, and excludes notes from borrower responses", async () => {
      const c = await client();
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        const email = `staff-http-${randomUUID()}@example.test`;
        const create = {
          email,
          idempotencyKey: randomUUID(),
          answers: {
            businessName: "Synthetic Initial Staff HTTP",
            requestedAmount: "10000.00",
            purpose: "Synthetic initial equipment",
          },
        };
        const created = await c.call(`${staffPath}/applications`, {
          ...staff,
          method: "POST",
          body: create,
        });
        expect(created.status, JSON.stringify(created.body)).toBe(200);
        const draft = applicationSetupSchema.parse(created.body);
        expect(draft).toMatchObject({
          ...create.answers,
          setupStatus: "in_progress",
          status: "draft",
          currentStep: "business_name",
          completedSteps: [],
          skippedSteps: [],
          completedAt: null,
        });
        expect(
          (await c.call(`${staffPath}/applications`, { ...staff, method: "POST", body: create }))
            .body.id,
        ).toBe(draft.id);
        expect(
          (
            await c.call(`${staffPath}/applications`, {
              ...staff,
              method: "POST",
              body: {
                ...create,
                answers: { ...create.answers, purpose: "Synthetic changed payload" },
              },
            })
          ).status,
        ).toBe(409);
        const deliveries = await database.pool.query<{
          id: string;
          origin: string;
          application_id: string;
        }>(
          "SELECT id, origin, application_id FROM access_delivery_requests WHERE application_id = $1",
          [draft.id],
        );
        expect(deliveries.rows).toHaveLength(1);
        expect(deliveries.rows[0]).toMatchObject({
          origin: borrowerOrigin,
          application_id: draft.id,
        });
        const base = `${staffPath}/applications/${draft.id}`;
        let workspace = staffWorkspaceSchema.parse((await c.call(`${base}/workspace`, staff)).body);
        expect(workspace).toMatchObject({
          ...create.answers,
          source: "staff",
          createdBy: { id: seedIds.officerA },
          contact: { email, status: "pending" },
        });
        const prefill = await c.call(`${base}/setup`, {
          ...staff,
          method: "PATCH",
          body: {
            expectedRevision: workspace.revision,
            definitionVersion: 2,
            currentStep: "review",
            answers: {
              businessName: "Synthetic Staff HTTP",
              requestedAmount: "10000.00",
              purpose: "Synthetic tools",
            },
          },
        });
        expect(prefill.status).toBe(200);
        expect(prefill.body).toMatchObject({ setupStatus: "in_progress", completedAt: null });
        workspace = staffWorkspaceSchema.parse((await c.call(`${base}/workspace`, staff)).body);
        const revision = workspace.revision;
        const assignment = { expectedRevision: revision, assignedStaffId: seedIds.officerA };
        expect(
          (
            await c.call(`${base}/assignment`, {
              ...staff,
              csrf: undefined,
              method: "PATCH",
              body: assignment,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await c.call(`${base}/assignment`, {
              ...staff,
              method: "PATCH",
              body: { ...assignment, assignedStaffId: seedIds.officerB },
            })
          ).status,
        ).toBe(404);
        workspace = staffWorkspaceSchema.parse(
          (await c.call(`${base}/assignment`, { ...staff, method: "PATCH", body: assignment }))
            .body,
        );
        expect(workspace.assignedStaffId).toBe(seedIds.officerA);
        expect(workspace.setup.revision).toBe(workspace.revision);
        expect(
          (await c.call(`${base}/assignment`, { ...staff, method: "PATCH", body: assignment }))
            .status,
        ).toBe(409);
        const secretNote = `Staff-only synthetic note ${randomUUID()}`;
        workspace = staffWorkspaceSchema.parse(
          (
            await c.call(`${base}/notes`, {
              ...staff,
              method: "POST",
              body: { expectedRevision: workspace.revision, body: secretNote },
            })
          ).body,
        );
        const note = workspace.notes[0];
        if (!note) throw new Error("Expected staff note.");
        const edit = { expectedRevision: workspace.revision, body: `${secretNote} amended` };
        expect(
          (await c.call(`${base}/notes/${randomUUID()}`, { ...staff, method: "PATCH", body: edit }))
            .status,
        ).toBe(404);
        const updated = await c.call(`${base}/notes/${note.id}`, {
          ...staff,
          method: "PATCH",
          body: edit,
        });
        expect(updated.status).toBe(200);
        workspace = staffWorkspaceSchema.parse(updated.body);
        expect(workspace.notes[0]?.body).toBe(edit.body);
        expect(
          (await c.call(`${base}/notes/${note.id}`, { ...staff, method: "PATCH", body: edit }))
            .status,
        ).toBe(409);
        const audit = await database.pool.query(
          "SELECT action, metadata, changed_fields FROM audit_events WHERE application_id = $1",
          [draft.id],
        );
        expect(audit.rows.length).toBeGreaterThanOrEqual(5);
        expect(JSON.stringify(audit.rows)).not.toContain(secretNote);
        const deliveryId = deliveries.rows[0]?.id;
        if (!deliveryId) throw new Error("Expected continuation intent.");
        const delivery = await createIdentityService(database.db).prepareDelivery(deliveryId);
        if (!delivery) throw new Error("Expected prepared local continuation.");
        const token = new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token");
        const consumed = await c.call("/api/v1/auth/consume", { method: "POST", body: { token } });
        expect(consumed.status).toBe(200);
        const borrower = await c.credentials(consumed.cookie);
        const resumed = await c.call(`${bankPath}/${draft.id}/setup`, borrower);
        expect(resumed.status).toBe(200);
        expect(resumed.body).toMatchObject({
          businessName: "Synthetic Staff HTTP",
          requestedAmount: "10000.00",
          currentStep: "business_name",
          setupStatus: "in_progress",
        });
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/setup/finish`, {
              ...staff,
              method: "POST",
              body: {
                definitionVersion: 2,
                expectedRevision: workspace.revision,
                idempotencyKey: randomUUID(),
              },
            })
          ).status,
        ).toBe(404);
        let acknowledged = applicationSetupSchema.parse(resumed.body);
        for (const step of setupFixtureSteps("Synthetic Staff HTTP", "10000.00")) {
          const saved = await c.call(`${bankPath}/${draft.id}/setup`, {
            ...borrower,
            method: "PATCH",
            body: { ...step, expectedRevision: acknowledged.revision },
          });
          expect(saved.status, JSON.stringify(saved.body)).toBe(200);
          acknowledged = applicationSetupSchema.parse(saved.body);
        }
        const completed = await c.call(`${bankPath}/${draft.id}/setup/finish`, {
          ...borrower,
          method: "POST",
          body: {
            definitionVersion: 2,
            expectedRevision: acknowledged.revision,
            idempotencyKey: randomUUID(),
          },
        });
        expect(completed.status).toBe(200);
        for (const path of [
          bankPath,
          `${bankPath}/${draft.id}`,
          `${bankPath}/${draft.id}/setup`,
          `${bankPath}/${draft.id}/destination`,
          `${bankPath}/${draft.id}/portal`,
        ]) {
          const result = await c.call(path, borrower);
          expect(result.status).toBe(200);
          expect(JSON.stringify(result.body)).not.toContain(secretNote);
          expect(result.body).not.toHaveProperty("notes");
        }
        for (const input of [
          { path: `${base}/workspace`, method: "GET" as const },
          {
            path: `${base}/assignment`,
            method: "PATCH" as const,
            body: { expectedRevision: workspace.revision, assignedStaffId: null },
          },
          { path: `${base}/notes`, method: "POST" as const, body: edit },
          { path: `${base}/notes/${note.id}`, method: "PATCH" as const, body: edit },
        ])
          expect((await c.call(input.path, { ...borrower, ...input })).status).toBe(404);
      } finally {
        await c.app.close();
      }
    });

    it("accepts email-only and partial staff creation and rejects invalid prefills atomically", async () => {
      const c = await client();
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        for (const answers of [undefined, { businessName: "Synthetic Partial HTTP" }]) {
          const input = {
            email: `staff-partial-${randomUUID()}@example.test`,
            idempotencyKey: randomUUID(),
            ...(answers ? { answers } : {}),
          };
          const response = await c.call(`${staffPath}/applications`, {
            ...staff,
            method: "POST",
            body: input,
          });
          expect(response.status).toBe(200);
          const created = applicationSetupSchema.parse(response.body);
          expect(created).toMatchObject({
            businessName: answers?.businessName ?? null,
            requestedAmount: null,
            purpose: null,
            setupStatus: "in_progress",
            completedAt: null,
          });
          const recipient = await c.demo(input.email);
          expect(
            (
              await c.call(`${bankPath}/${created.id}/claim`, {
                ...recipient,
                method: "POST",
                body: {},
              })
            ).status,
          ).toBe(200);
          expect((await c.call(`${bankPath}/${created.id}/portal`, recipient)).status).toBe(409);
          expect(
            (await c.call(`${staffPath}/applications/${created.id}/workspace`, recipient)).status,
          ).toBe(404);
        }
        const invalid = {
          email: `staff-invalid-${randomUUID()}@example.test`,
          idempotencyKey: randomUUID(),
          answers: { businessName: "Synthetic Invalid HTTP", requestedAmount: "7500000.01" },
        };
        const counts = () =>
          database.pool.query(
            "SELECT (SELECT count(*) FROM applications) AS applications, (SELECT count(*) FROM applicant_contacts) AS contacts, (SELECT count(*) FROM access_delivery_requests) AS deliveries, (SELECT count(*) FROM audit_events) AS audits, (SELECT count(*) FROM application_requests) AS requests",
          );
        const before = await counts();
        const rejected = await c.call(`${staffPath}/applications`, {
          ...staff,
          method: "POST",
          body: invalid,
        });
        expect(rejected.status).toBe(400);
        expect(rejected.body.error.code).toBe("INVALID_INPUT");
        expect((await counts()).rows).toEqual(before.rows);
        const corrected = await c.call(`${staffPath}/applications`, {
          ...staff,
          method: "POST",
          body: { ...invalid, answers: { ...invalid.answers, requestedAmount: "10000.00" } },
        });
        expect(corrected.status).toBe(200);
        expect(corrected.body.requestedAmount).toBe("10000.00");
      } finally {
        await c.app.close();
      }
    });

    it("does not create or promise a continuation when email delivery is unavailable", async () => {
      const c = await client(false);
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        const email = `unavailable-${randomUUID()}@example.test`;
        const result = await c.call(`${staffPath}/applications`, {
          ...staff,
          method: "POST",
          body: { email, idempotencyKey: randomUUID() },
        });
        expect(result.status).toBe(503);
        expect(result.body.error.code).toBe("AUTH_DELIVERY_UNAVAILABLE");
        const generic = await c.call(bankPath, {
          ...staff,
          method: "POST",
          body: { email, idempotencyKey: randomUUID() },
        });
        expect(generic.status).toBe(503);
        expect(generic.body.error.code).toBe("AUTH_DELIVERY_UNAVAILABLE");
        expect(
          (await database.pool.query("SELECT id FROM applicant_contacts WHERE email = $1", [email]))
            .rows,
        ).toHaveLength(0);
      } finally {
        await c.app.close();
      }
    });
  });
}
