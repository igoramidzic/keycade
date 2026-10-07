import { randomBytes, randomUUID } from "node:crypto";
import {
  applicationPageSchema,
  applicationPortalSchema,
  applicationSelectionSchema,
  applicationSetupSchema,
  authSessionSchema,
} from "@keycade/contracts";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createIdentityService } from "@keycade/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
type Setup = ReturnType<typeof applicationSetupSchema.parse>;

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} application setup HTTP journey with PostgreSQL`, () => {
    async function client() {
      const options = {
        db: database.db,
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
      async function fill(setup: Setup, auth: Credentials) {
        let saved = setup;
        const steps = [
          {
            step: "business_name",
            currentStep: "amount",
            answers: { businessName: "Synthetic HTTP Workshop" },
          },
          { step: "product", currentStep: "amount", answers: { productId: seedIds.productA } },
          { step: "amount", currentStep: "purpose", answers: { requestedAmount: "7500000.00" } },
          {
            step: "purpose",
            currentStep: "industry",
            answers: { purpose: "Synthetic equipment expansion" },
          },
          { step: "industry", currentStep: "review", answers: {}, skip: true },
        ];
        for (const step of steps) {
          const result = await call(`${bankPath}/${saved.id}/setup`, {
            ...auth,
            method: "PATCH",
            body: { ...step, expectedRevision: saved.revision },
          });
          expect(result.status, JSON.stringify(result.body)).toBe(200);
          saved = applicationSetupSchema.parse(result.body);
        }
        return saved;
      }
      return { app, call, credentials, demo, fill };
    }

    it("paginates current grants with business/product summaries and guards portal entry", async () => {
      const c = await client();
      try {
        const auth = await c.demo("borrower@example.test");
        const first = applicationPageSchema.parse((await c.call(`${bankPath}?limit=2`, auth)).body);
        expect(first.items.map((item) => item.id)).toEqual([
          seedIds.applicationSmall,
          seedIds.applicationLarge,
        ]);
        expect(first.nextCursor).toBe(seedIds.applicationLarge);
        expect(first.items[0]).toMatchObject({
          businessId: seedIds.businessA,
          businessName: "Synthetic Cedar Workshop",
          productName: "Synthetic Business Credit",
          requestedAmount: "10000.00",
          accessScope: "full",
          setupStatus: "completed",
          nextDestination: "portal",
        });
        expect(first.items[0]?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(first.items[1]).toMatchObject({
          businessId: seedIds.businessB,
          requestedAmount: "5000000.00",
        });
        const second = applicationPageSchema.parse(
          (await c.call(`${bankPath}?limit=2&after=${first.nextCursor}`, auth)).body,
        );
        expect(second.items.map((item) => item.id)).toEqual([
          seedIds.applicationSetupDraft,
          seedIds.applicationClosedDraft,
        ]);
        expect(second.nextCursor).toBeNull();
        expect(second.items[0]).toMatchObject({
          businessId: seedIds.businessA,
          nextDestination: "setup",
          currentStep: "amount",
        });
        expect(second.items[1]).toMatchObject({
          status: "withdrawn",
          setupStatus: "in_progress",
          nextDestination: "closed",
        });
        const portal = await c.call(`${bankPath}/${seedIds.applicationSmall}/portal`, auth);
        expect(portal.status).toBe(200);
        expect(applicationPortalSchema.parse(portal.body)).toMatchObject({
          id: seedIds.applicationSmall,
          purpose: "Synthetic equipment purchase",
          remainingTasks: null,
          accessScope: "full",
        });
        for (const [applicationId, code] of [
          [seedIds.applicationSetupDraft, "SETUP_REQUIRED"],
          [seedIds.applicationClosedDraft, "INVALID_STATE"],
        ]) {
          const denied = await c.call(`${bankPath}/${applicationId}/portal`, auth);
          expect(denied.status).toBe(409);
          expect(denied.body.error.code).toBe(code);
          expect((await c.call(`${bankPath}/${applicationId}/destination`, auth)).status).toBe(200);
        }
        for (const path of [
          `${bankPath}/${seedIds.applicationUnshared}/portal`,
          `${bankPath}/${randomUUID()}/portal`,
          `/api/v1/banks/${seedIds.bankB}/applications/${seedIds.applicationOtherBank}/portal`,
        ]) {
          const denied = await c.call(path, auth);
          expect(denied.status).toBe(404);
          expect(denied.body.error.code).toBe("NOT_FOUND");
        }
        const empty = await c.demo(`no-grants-${randomUUID()}@example.test`);
        expect(applicationPageSchema.parse((await c.call(bankPath, empty)).body)).toEqual({
          items: [],
          nextCursor: null,
        });
        const docs = await c.call("/api/openapi.json");
        expect(
          docs.body.paths["/api/v1/banks/{bankId}/applications/{applicationId}/portal"].get
            .responses,
        ).toHaveProperty("409");
      } finally {
        await c.app.close();
      }
    });

    it("redacts assigned summaries, bypasses the applicant setup gate for invited participants, and rechecks grants", async () => {
      const c = await client();
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        const created = await c.call(bankPath, {
          ...staff,
          method: "POST",
          body: { email: `limited-${randomUUID()}@example.test`, idempotencyKey: randomUUID() },
        });
        const draft = await c.fill(applicationSetupSchema.parse(created.body), staff);
        await database.pool.query(
          "INSERT INTO application_participants (bank_id,application_id,user_id,role,scope,synthetic) VALUES ($1,$2,$3,'adviser','assigned',true)",
          [seedIds.bankA, draft.id, seedIds.adviser],
        );
        const adviser = await c.demo("adviser@example.test");
        const page = applicationPageSchema.parse((await c.call(bankPath, adviser)).body);
        expect(page.items.map((item) => item.id).sort()).toEqual(
          [seedIds.applicationSmall, draft.id].sort(),
        );
        for (const item of page.items) {
          expect(item.accessScope).toBe("assigned");
          expect(item.requestedAmount).toBeNull();
        }
        const selected = applicationSelectionSchema.parse(
          (await c.call(`${bankPath}/${draft.id}/destination`, adviser)).body,
        );
        expect(selected).toMatchObject({
          nextDestination: "assigned",
          setupStatus: "in_progress",
          requestedAmount: null,
          accessScope: "assigned",
        });
        const portal = await c.call(`${bankPath}/${draft.id}/portal`, adviser);
        expect(portal.status).toBe(200);
        expect(applicationPortalSchema.parse(portal.body)).toMatchObject({
          purpose: null,
          requestedAmount: null,
          remainingTasks: null,
          accessScope: "assigned",
        });
        expect((await c.call(`${bankPath}/${draft.id}`, adviser)).body).toMatchObject({
          purpose: null,
          requestedAmount: null,
        });
        expect((await c.call(`${bankPath}/${draft.id}/setup`, adviser)).status).toBe(404);
        const staffPortal = await c.call(`${bankPath}/${draft.id}/portal`, staff);
        expect(staffPortal.status).toBe(200);
        expect(staffPortal.body).toMatchObject({
          accessScope: "full",
          purpose: "Synthetic equipment expansion",
          requestedAmount: "7500000.00",
        });
        await database.pool.query(
          "UPDATE application_participants SET revoked_at = now() WHERE application_id = $1 AND user_id = $2",
          [draft.id, seedIds.adviser],
        );
        for (const suffix of ["portal", "destination"])
          expect((await c.call(`${bankPath}/${draft.id}/${suffix}`, adviser)).status).toBe(404);
        const afterRevocation = applicationPageSchema.parse((await c.call(bankPath, adviser)).body);
        expect(afterRevocation.items.map((item) => item.id)).toEqual([seedIds.applicationSmall]);
      } finally {
        await c.app.close();
      }
    });

    it("persists demo setup across sessions and gates each portal until explicit idempotent completion", async () => {
      const c = await client();
      const email = `setup-${randomUUID()}@example.test`;
      try {
        const auth = await c.demo(email);
        const input = { idempotencyKey: randomUUID() };
        const created = await c.call(bankPath, { ...auth, method: "POST", body: input });
        expect(created.status).toBe(200);
        const draft = applicationSetupSchema.parse(created.body);
        expect(draft).toMatchObject({
          setupStatus: "in_progress",
          nextDestination: "setup",
          synthetic: true,
        });
        const retry = await c.call(bankPath, { ...auth, method: "POST", body: input });
        expect(retry.body.id).toBe(draft.id);
        const second = await c.call(bankPath, {
          ...auth,
          method: "POST",
          body: { idempotencyKey: randomUUID() },
        });
        expect(second.body.id).not.toBe(draft.id);
        expect((await c.call(`${bankPath}/${draft.id}`, auth)).status).toBe(409);
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/purpose`, {
              ...auth,
              method: "PATCH",
              body: { expectedRevision: 1, purpose: "Bypass attempt" },
            })
          ).status,
        ).toBe(409);
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/setup/finish`, {
              ...auth,
              method: "POST",
              body: { expectedRevision: 1, idempotencyKey: randomUUID() },
            })
          ).status,
        ).toBe(400);
        const save = {
          expectedRevision: draft.revision,
          answers: { businessName: "Unsaved" },
          currentStep: "business_name",
        };
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/setup`, {
              ...auth,
              csrf: undefined,
              method: "PATCH",
              body: save,
            })
          ).status,
        ).toBe(403);
        for (const invalid of [
          { ...save, completedAt: new Date().toISOString() },
          { ...save, answers: { ein: "synthetic-private" } },
          { ...save, answers: { ssn: "synthetic-private" } },
        ])
          expect(
            (
              await c.call(`${bankPath}/${draft.id}/setup`, {
                ...auth,
                method: "PATCH",
                body: invalid,
              })
            ).status,
          ).toBe(400);
        const filled = await c.fill(draft, auth);
        expect(filled.requestedAmount).toBe("7500000.00");
        expect(filled.skippedSteps).toContain("industry");
        expect(
          (await c.call(`${bankPath}/${draft.id}/setup`, { ...auth, method: "PATCH", body: save }))
            .status,
        ).toBe(409);
        const resumed = await c.demo(email);
        const restored = await c.call(`${bankPath}/${draft.id}/setup`, resumed);
        expect(restored.body).toEqual(filled);
        const destination = await c.call(`${bankPath}/${draft.id}/destination`, resumed);
        expect(destination.body).toMatchObject({ nextDestination: "setup", currentStep: "review" });
        const finish = { expectedRevision: filled.revision, idempotencyKey: randomUUID() };
        const complete = await c.call(`${bankPath}/${draft.id}/setup/finish`, {
          ...resumed,
          method: "POST",
          body: finish,
        });
        expect(complete.status).toBe(200);
        expect(complete.body).toMatchObject({
          setupStatus: "completed",
          nextDestination: "portal",
          status: "collecting_information",
        });
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/setup/finish`, {
              ...resumed,
              method: "POST",
              body: finish,
            })
          ).body,
        ).toEqual(complete.body);
        expect((await c.call(`${bankPath}/${draft.id}`, resumed)).status).toBe(200);
        expect((await c.call(`${bankPath}/${second.body.id}`, resumed)).status).toBe(409);
        expect(
          (
            await c.call(`/api/v1/banks/${seedIds.bankB}/applications`, {
              ...resumed,
              method: "POST",
              body: { idempotencyKey: randomUUID() },
            })
          ).status,
        ).toBe(404);
        const page = applicationPageSchema.parse(
          (await c.call(`${bankPath}?limit=1`, resumed)).body,
        );
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).not.toBeNull();
        const next = applicationPageSchema.parse(
          (await c.call(`${bankPath}?limit=1&after=${page.nextCursor}`, resumed)).body,
        );
        expect(next.items).toHaveLength(1);
        expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
        expect((await c.call(`${bankPath}?limit=0`, resumed)).status).toBe(400);
      } finally {
        await c.app.close();
      }
    });

    it("lets staff prefill while requiring the selected synthetic recipient to claim and finish", async () => {
      const c = await client();
      const email = `staff-created-${randomUUID()}@example.test`;
      try {
        const staff = await c.demo("officer-a@example.test", "staff");
        const response = await c.call(bankPath, {
          ...staff,
          method: "POST",
          body: { email, idempotencyKey: randomUUID() },
        });
        expect(response.status).toBe(200);
        const draft = applicationSetupSchema.parse(response.body);
        const filled = await c.fill(draft, staff);
        expect((await c.call(`${bankPath}/${draft.id}`, staff)).status).toBe(200);
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/setup/finish`, {
              ...staff,
              method: "POST",
              body: { expectedRevision: filled.revision, idempotencyKey: randomUUID() },
            })
          ).status,
        ).toBe(404);
        const recipient = await c.demo(email);
        const page = applicationPageSchema.parse((await c.call(bankPath, recipient)).body);
        expect(page.items.some((item) => item.id === draft.id)).toBe(true);
        const claimed = await c.call(`${bankPath}/${draft.id}/claim`, {
          ...recipient,
          method: "POST",
          body: {},
        });
        expect(claimed.status).toBe(200);
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/claim`, {
              ...recipient,
              method: "POST",
              body: {},
            })
          ).body,
        ).toEqual(claimed.body);
        expect(
          (
            await c.call(`${bankPath}/${draft.id}/setup/finish`, {
              ...recipient,
              method: "POST",
              body: { expectedRevision: claimed.body.revision, idempotencyKey: randomUUID() },
            })
          ).status,
        ).toBe(200);
        const adviser = await c.demo("adviser@example.test");
        expect((await c.call(`${bankPath}/${draft.id}/setup`, adviser)).status).toBe(404);
        expect(
          (await c.call(`${bankPath}/${draft.id}/claim`, { ...adviser, method: "POST", body: {} }))
            .status,
        ).toBe(404);
      } finally {
        await c.app.close();
      }
    });

    it("starts privately and resumes pending drafts through a fresh verified link without browser state", async () => {
      const c = await client();
      const email = `public-start-${randomUUID()}@example.test`;
      try {
        const input = {
          email,
          bankSlug: "bank-a",
          idempotencyKey: Buffer.from(randomBytes(32)).toString("hex"),
        };
        const first = await c.call("/api/v1/applications/start", { method: "POST", body: input });
        expect(first.status).toBe(202);
        expect(first.body).toEqual({
          message: "If the request is eligible, a continuation link will be sent.",
        });
        const duplicate = await c.call("/api/v1/applications/start", {
          method: "POST",
          body: input,
        });
        expect(duplicate.body).toEqual(first.body);
        const second = await c.call("/api/v1/applications/start", {
          method: "POST",
          body: { ...input, idempotencyKey: Buffer.from(randomBytes(32)).toString("hex") },
        });
        expect(second.status).toBe(202);
        const unavailable = await c.call("/api/v1/applications/start", {
          method: "POST",
          body: {
            ...input,
            bankSlug: "unknown-bank",
            idempotencyKey: Buffer.from(randomBytes(32)).toString("hex"),
          },
        });
        expect(unavailable.body).toEqual(first.body);
        expect((await c.call(bankPath)).status).toBe(404);
        const drafts = await database.pool.query<{ id: string }>(
          "SELECT a.id FROM applications a JOIN applicant_contacts c ON c.id = a.contact_id WHERE c.email = $1",
          [email],
        );
        expect(drafts.rowCount).toBe(2);
        for (const draft of drafts.rows)
          expect((await c.call(`${bankPath}/${draft.id}/setup`)).status).toBe(404);
        // A generic fresh link must find existing drafts, without using the original start response or link.
        const link = await c.call("/api/v1/auth/request-link", {
          method: "POST",
          body: { email, bankSlug: "bank-a", portal: "borrower", returnPath: "/" },
        });
        expect(link.status).toBe(202);
        const queued = await database.pool.query<{ id: string }>(
          "SELECT id FROM access_delivery_requests WHERE request_id = $1",
          [link.requestId],
        );
        const id = queued.rows[0]?.id;
        if (!id) throw new Error("Expected queued synthetic continuation.");
        const delivery = await createIdentityService(database.db).prepareDelivery(id);
        if (!delivery) throw new Error("Expected synthetic continuation credential.");
        const token = new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token");
        const consumed = await c.call("/api/v1/auth/consume", { method: "POST", body: { token } });
        expect(consumed.status).toBe(200);
        const verified = await c.credentials(consumed.cookie);
        // Membership in another bank cannot change the bank selected by this verified session.
        await database.pool.query(
          "INSERT INTO bank_memberships (bank_id,user_id,role,synthetic) SELECT $1,id,'officer',true FROM users WHERE email = $2",
          [seedIds.bankB, email],
        );
        expect((await c.call(`/api/v1/banks/${seedIds.bankB}/applications`, verified)).status).toBe(
          404,
        );
        expect(
          (
            await c.call(
              `/api/v1/banks/${seedIds.bankB}/staff/applications/${seedIds.applicationOtherBank}`,
              verified,
            )
          ).status,
        ).toBe(404);
        const page = applicationPageSchema.parse((await c.call(bankPath, verified)).body);
        expect(page.items.map((item) => item.id).sort()).toEqual(
          drafts.rows.map((row) => row.id).sort(),
        );
        expect(page.items.every((item) => item.claimRequired)).toBe(true);
        const selected = page.items[0];
        if (!selected) throw new Error("Expected a pending draft.");
        const claimed = await c.call(`${bankPath}/${selected.id}/claim`, {
          ...verified,
          method: "POST",
          body: {},
        });
        expect(claimed.status).toBe(200);
        expect(claimed.body.nextDestination).toBe("setup");
        const remaining = applicationPageSchema.parse((await c.call(bankPath, verified)).body);
        expect(remaining.items.filter((item) => item.claimRequired)).toHaveLength(1);
      } finally {
        await c.app.close();
      }
    });
  });
}
