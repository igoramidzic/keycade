import { enrichmentViewSchema } from "@keycade/contracts";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createIdentifierCipher } from "@keycade/domain";
import { processEnrichmentJobs } from "@keycade/integrations/enrichment-jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
});
afterAll(async () => database?.cleanup());
const encryptionKey = "17".repeat(32);
const origin = "http://localhost:3001";
const csrf = "synthetic-enrichment-csrf-0123456789012345";
for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} private enrichment API`, () => {
    const applicationId = transport === "fastify" ? ids.applicationSmall : ids.applicationLarge;
    const base = `/api/v1/banks/${ids.bankA}/applications/${applicationId}/enrichment`;
    async function client(userId: string) {
      const options = {
        db: database.db,
        encryptionKey,
        allowedOrigins: [origin],
        authenticate: async () => ({ actor: { kind: "user" as const, userId }, csrfToken: csrf }),
        readiness: async () => ({
          status: "ready" as const,
          database: "ready" as const,
          worker: "ready" as const,
          simulation: true as const,
        }),
      };
      const app = await buildServer(options);
      return {
        close: () => app.close(),
        async call(url: string, body?: object, proof = csrf) {
          const method = body ? "POST" : "GET",
            headers = { origin, "content-type": "application/json", "x-csrf-token": proof };
          if (transport === "fastify") {
            const r = await app.inject({
              url,
              method,
              headers,
              ...(body ? { payload: body } : {}),
            });
            return { status: r.statusCode, body: r.json() };
          }
          const r = await handleWorkerRequest(
            new Request(origin + url, {
              method,
              headers,
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          return { status: r.status, body: await r.json() };
        },
      };
    }
    it("waits for identifier/authorization, exposes only masked values and reviewable simulated results", async () => {
      const user = await client(ids.borrower);
      try {
        let view = enrichmentViewSchema.parse((await user.call(base)).body);
        expect(view.identifier.present).toBe(false);
        let response = await user.call(`${base}/requests`, {
          kind: "tax",
          expectedRevision: view.revision,
        });
        expect(response.status).toBe(200);
        view = enrichmentViewSchema.parse(response.body);
        expect(view.runs.find((r) => !r.stale && r.kind === "tax")).toMatchObject({
          status: "waiting_for_input",
          missingPrerequisites: ["identifier", "tax_authorization"],
        });
        expect(
          (
            await user.call(
              `${base}/identifier`,
              { value: "000000001", expectedRevision: view.revision },
              "invalid",
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await user.call(`${base}/identifier`, {
              value: "123456789",
              expectedRevision: view.revision,
            })
          ).status,
        ).toBe(400);
        response = await user.call(`${base}/identifier`, {
          value: "000000001",
          expectedRevision: view.revision,
        });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        view = enrichmentViewSchema.parse(response.body);
        expect(view.identifier.masked).toBe("**-***0001");
        expect(JSON.stringify(view)).not.toContain('"000000001"');
        response = await user.call(`${base}/tax-authorization`, {
          authorized: true,
          noticeVersion: "demo-tax-v1",
          expectedRevision: view.revision,
        });
        expect(response.status).toBe(200);
        view = enrichmentViewSchema.parse(response.body);
        response = await user.call(`${base}/requests`, {
          kind: "business",
          expectedRevision: view.revision,
        });
        expect(response.status).toBe(200);
        await processEnrichmentJobs(database.db, createIdentifierCipher(encryptionKey), {
          delayMs: 0,
          deadlineMs: 100,
        });
        view = enrichmentViewSchema.parse((await user.call(base)).body);
        const tax = view.runs.find((r) => !r.stale && r.kind === "tax");
        const business = view.runs.find((r) => !r.stale && r.kind === "business");
        expect(tax?.result).toMatchObject({ simulated: true, outcome: "complete" });
        expect(business?.result?.suggestions).toHaveLength(2);
        expect(view.confirmedFacts).toHaveLength(0);
        response = await user.call(`${base}/confirm-fact`, {
          runId: business?.id,
          key: "entity_type",
          expectedRevision: view.revision,
        });
        expect(response.status).toBe(200);
        view = enrichmentViewSchema.parse(response.body);
        expect(view.confirmedFacts).toHaveLength(1);
        response = await user.call(`${base}/identifier`, {
          value: "000000003",
          expectedRevision: view.revision,
        });
        expect(response.status).toBe(200);
        view = enrichmentViewSchema.parse(response.body);
        expect(view.taxAuthorization.authorized).toBe(false);
        expect(view.runs.find((r) => r.id === tax?.id)?.stale).toBe(true);
        const rows = await database.pool.query(
          "SELECT encrypted_value FROM sensitive_identifier_versions WHERE application_id=$1",
          [applicationId],
        );
        expect(
          rows.rows.every(
            (r) => r.encrypted_value.startsWith("v1.") && !r.encrypted_value.includes("000000001"),
          ),
        ).toBe(true);
      } finally {
        await user.close();
      }
    });
    it("conceals other banks and owner identifiers from advisers and other participants", async () => {
      const outside = await client(ids.officerB),
        adviser = await client(ids.adviser),
        staff = await client(ids.officerA);
      try {
        expect((await outside.call(base)).status).toBe(404);
        expect((await adviser.call(base)).status).toBe(404);
        expect((await adviser.call(`${base}?subjectUserId=${ids.borrower}`)).status).toBe(404);
        expect((await staff.call(`${base}?subjectUserId=${ids.officerB}`)).status).toBe(404);
        expect((await staff.call(base)).status).toBe(200);
      } finally {
        await outside.close();
        await adviser.close();
        await staff.close();
      }
    });
  });
}
