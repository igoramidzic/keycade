import { randomUUID } from "node:crypto";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
});
const token = "synthetic-test-csrf-token-01234567890";
async function appFor(userId: string) {
  return buildServer({
    db: database.db,
    allowedOrigins: ["http://localhost:3001"],
    readiness: async () => ({
      status: "ready",
      database: "ready",
      worker: "ready",
      simulation: true,
    }),
    authenticate: async () => ({ actor: { kind: "user", userId }, csrfToken: token }),
  });
}

describe("HTTP authorization with PostgreSQL", () => {
  it("uses the same denial shape for foreign-bank, same-bank unshared, and missing records", async () => {
    const app = await appFor(ids.borrower);
    try {
      for (const [bankId, applicationId] of [
        [ids.bankB, ids.applicationOtherBank],
        [ids.bankA, ids.applicationUnshared],
        [ids.bankA, randomUUID()],
      ]) {
        const reply = await app.inject(`/api/v1/banks/${bankId}/applications/${applicationId}`);
        expect(reply.statusCode).toBe(404);
        expect(reply.json()).toEqual({
          error: {
            code: "NOT_FOUND",
            message: "Resource not found.",
            requestId: reply.headers["x-request-id"],
          },
        });
      }
      const allowed = await app.inject(
        `/api/v1/banks/${ids.bankA}/applications/${ids.applicationSmall}`,
      );
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json().requestedAmount).toBe("10000.00");
      expect(allowed.json()).not.toHaveProperty("contactId");
      expect(allowed.json()).not.toHaveProperty("createdByUserId");
    } finally {
      await app.close();
    }
  });
  it("requires CSRF proof and rejects malformed fields; validated writes return conflicts on stale revisions", async () => {
    const app = await appFor(ids.borrower);
    try {
      const url = `/api/v1/banks/${ids.bankA}/applications/${ids.applicationSmall}/purpose`;
      const headers = { origin: "http://localhost:3001", "x-csrf-token": token };
      const payload = { expectedRevision: 1, purpose: "Synthetic API update" };
      expect(
        (await app.inject({ method: "PATCH", url, headers: { origin: headers.origin }, payload }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "PATCH",
            url,
            headers,
            payload: { ...payload, secret: "not allowed" },
          })
        ).statusCode,
      ).toBe(400);
      const success = await app.inject({ method: "PATCH", url, headers, payload });
      expect(success.statusCode).toBe(200);
      expect(success.json().revision).toBe(2);
      const stale = await app.inject({ method: "PATCH", url, headers, payload });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("REVISION_CONFLICT");
    } finally {
      await app.close();
    }
  });
});
