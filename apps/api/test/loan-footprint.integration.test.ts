import { randomUUID } from "node:crypto";
import {
  type BusinessAddress,
  type ChecksView,
  checksViewSchema,
  readinessViewSchema,
} from "@keycade/contracts";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  bankMemberships,
  checkRuns,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { createIdentifierCipher } from "@keycade/domain";
import { processCheckRun } from "@keycade/integrations/check-jobs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invokeCheckProvider } from "../../../packages/integrations/src/check-provider.js";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const encryptionKey = "18".repeat(32);
const cipher = createIdentifierCipher(encryptionKey);
const origin = "http://localhost:3002";
const csrf = "synthetic-footprint-csrf-0123456789012345";
const address: BusinessAddress = {
  line1: "123 Synthetic Avenue",
  locality: "Portland",
  region: "ME",
  postalCode: "04101",
  countryCode: "US",
};
const base = (id: string) => `/api/v1/banks/${ids.bankA}/applications/${id}`;
const footprint = (view: ChecksView) => {
  const check = view.checks.find((item) => item.kind === "loan_footprint");
  if (!check) throw new Error("Expected the staff-only Loan Footprint check.");
  return check;
};
const current = (check: ReturnType<typeof footprint>) => {
  const run = check.runs.find((run) => run.id === check.currentRunId);
  if (!run) throw new Error("Expected a current Loan Footprint run.");
  return run;
};
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());

async function fixture(businessAddress: BusinessAddress | null = address, draft = false) {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing synthetic application fixture.");
  const id = randomUUID();
  await database.db.insert(applications).values({
    ...source,
    id,
    status: draft ? "draft" : "collecting_information",
    revision: 1,
    businessAddress,
    businessAddressRevision: businessAddress ? 1 : 0,
  });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: draft ? "business_address" : "review",
    ...(draft ? {} : { completedAt: new Date(), completedByUserId: ids.borrower }),
  });
  await database.db.insert(applicationParticipants).values([
    {
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.borrower,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    },
    {
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.adviser,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    },
  ]);
  return id;
}

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} staff Loan Footprint transport`, () => {
    async function client(userId: string | null = ids.officerA) {
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
      const app = await buildServer(options);
      async function call(
        path: string,
        body?: object,
        overrides: Record<string, string> = {},
        method: "GET" | "POST" | "PATCH" = body ? "POST" : "GET",
      ) {
        const headers = {
          origin,
          "content-type": "application/json",
          "x-csrf-token": csrf,
          ...overrides,
        };
        if (transport === "fastify") {
          const response = await app.inject({
            method,
            url: path,
            headers,
            ...(body ? { payload: JSON.stringify(body) } : {}),
          });
          return { status: response.statusCode, body: response.json() };
        }
        const response = await handleWorkerRequest(
          new Request(origin + path, {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
          { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
        );
        return { status: response.status, body: await response.json() };
      }
      async function read(id: string) {
        const response = await call(`${base(id)}/checks`);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return checksViewSchema.parse(response.body);
      }
      return { call, read, close: () => app.close() };
    }

    it("returns current, simulated address-bound results without introducing readiness gates", async () => {
      const id = await fixture();
      const staff = await client();
      try {
        const initial = footprint(await staff.read(id));
        expect(initial).toMatchObject({
          required: false,
          passes: false,
          canResolve: false,
          canRefresh: false,
        });
        expect(current(initial)).toMatchObject({
          status: "queued",
          outcome: null,
          footprintInput: { address, addressRevision: 1, policyVersion: "US-only-demo-v1" },
        });
        const before = readinessViewSchema.parse((await staff.call(`${base(id)}/readiness`)).body);
        expect(before.gates.flatMap((gate) => gate.blockers).some((b) => b.id === initial.id)).toBe(
          false,
        );
        await processCheckRun(database.db, cipher, initial.currentRunId!, {
          delayMs: 0,
          deadlineMs: 1000,
        });
        const completed = footprint(await staff.read(id));
        expect(completed).toMatchObject({
          passes: true,
          required: false,
          canResolve: false,
          canRefresh: true,
        });
        expect(current(completed)).toMatchObject({
          status: "succeeded",
          stale: false,
          outcome: "clear",
          evidence: {
            simulated: true,
            kind: "loan_footprint",
            footprint: {
              address,
              addressRevision: 1,
              policyVersion: "US-only-demo-v1",
              countryCode: "US",
              reason: "inside_us_demo",
              coordinates: { source: "registered_synthetic_fixture" },
            },
          },
        });
        expect(
          readinessViewSchema.parse((await staff.call(`${base(id)}/readiness`)).body).gates,
        ).toEqual(before.gates);
        expect(
          await processCheckRun(database.db, cipher, initial.currentRunId!, { delayMs: 0 }),
        ).toBe(false);
        expect(current(footprint(await staff.read(id)))).toEqual(current(completed));
      } finally {
        await staff.close();
      }
    });

    it("keeps unknown coordinates eligible and absent or non-US addresses non-clear", async () => {
      const staff = await client();
      try {
        for (const example of [
          { address: { ...address, line1: "999 Unregistered Synthetic Lane" }, outcome: "clear" },
          {
            address: { ...address, countryCode: "CA", region: "ON", postalCode: "A1A 1A1" },
            outcome: "needs_review",
          },
          { address: null, outcome: null },
        ]) {
          const id = await fixture(example.address);
          const initial = footprint(await staff.read(id));
          await processCheckRun(database.db, cipher, initial.currentRunId!, { delayMs: 0 });
          const result = footprint(await staff.read(id));
          expect(result.passes).toBe(example.outcome === "clear");
          expect(result.required).toBe(false);
          expect(current(result).outcome).toBe(example.outcome);
          if (example.address) {
            expect(current(result).evidence?.footprint?.coordinates).toBeNull();
            expect(current(result).evidence?.footprint?.reason).toBe(
              example.outcome === "clear" ? "inside_us_demo" : "outside_us_demo",
            );
          } else {
            expect(current(result)).toMatchObject({
              status: "waiting_for_input",
              evidence: null,
            });
          }
          const readiness = readinessViewSchema.parse(
            (await staff.call(`${base(id)}/readiness`)).body,
          );
          expect(readiness.gates.flatMap((g) => g.blockers).some((b) => b.id === result.id)).toBe(
            false,
          );
        }
      } finally {
        await staff.close();
      }
    });

    it("refreshes asynchronously once per source run and rejects stale address commands", async () => {
      const id = await fixture(address, true);
      const staff = await client();
      try {
        const check = footprint(await staff.read(id));
        await processCheckRun(database.db, cipher, check.currentRunId!, { delayMs: 0 });
        const path = `${base(id)}/checks/${check.id}/refresh`;
        const input = { runId: check.currentRunId, expectedAddressRevision: 1 };
        const refresh = await staff.call(path, input);
        expect(refresh.status, JSON.stringify(refresh.body)).toBe(200);
        const refreshed = footprint(checksViewSchema.parse(refresh.body));
        expect(refreshed.currentRunId).not.toBe(check.currentRunId);
        expect(current(refreshed)).toMatchObject({ status: "queued", outcome: null });
        expect(refreshed.passes).toBe(false);
        expect(refreshed.canRefresh).toBe(false);
        expect(refreshed.runs.find((run) => run.id === check.currentRunId)?.stale).toBe(true);
        expect(await staff.call(path, input)).toEqual(refresh);
        const started = gate();
        const release = gate();
        const delayed = processCheckRun(database.db, cipher, refreshed.currentRunId!, {
          delayMs: 0,
          provider: async (request, options) => {
            started.resolve();
            await release.promise;
            return invokeCheckProvider(request, options);
          },
        });
        await Promise.race([
          started.promise,
          delayed.then(() => {
            throw new Error("Expected an in-flight synthetic footprint evaluation.");
          }),
        ]);
        try {
          const changed = await staff.call(
            `${base(id)}/setup`,
            {
              definitionVersion: 2,
              expectedRevision: 1,
              currentStep: "business_address",
              answers: { businessAddress: { ...address, countryCode: "CA" } },
            },
            {},
            "PATCH",
          );
          expect(changed.status, JSON.stringify(changed.body)).toBe(200);
          expect(changed.body.businessAddressRevision).toBe(2);
        } finally {
          release.resolve();
          await delayed;
        }
        const newAddress = footprint(await staff.read(id));
        expect(newAddress.passes).toBe(false);
        expect(newAddress.currentRunId).not.toBe(refreshed.currentRunId);
        expect(current(newAddress)).toMatchObject({
          status: "queued",
          footprintInput: { addressRevision: 2, address: { countryCode: "CA" } },
        });
        expect((await staff.call(path, input)).status).toBe(409);
        expect(
          (
            await staff.call(path, {
              runId: newAddress.currentRunId,
              expectedAddressRevision: 1,
            })
          ).status,
        ).toBe(409);
        expect(
          await processCheckRun(database.db, cipher, refreshed.currentRunId!, { delayMs: 0 }),
        ).toBe(false);
        await processCheckRun(database.db, cipher, newAddress.currentRunId!, { delayMs: 0 });
        const final = footprint(await staff.read(id));
        expect(final.passes).toBe(false);
        expect(final.runs.find((run) => run.id === refreshed.currentRunId)).toMatchObject({
          stale: true,
          outcome: null,
          evidence: null,
        });
        expect(current(final)).toMatchObject({
          status: "succeeded",
          outcome: "needs_review",
          evidence: { footprint: { addressRevision: 2, coordinates: null } },
        });
        const rows = await database.db
          .select()
          .from(checkRuns)
          .where(eq(checkRuns.checkId, check.id));
        expect(rows).toHaveLength(3);
        expect(rows.filter((run) => !run.stale)).toHaveLength(1);
      } finally {
        await staff.close();
      }
    });

    it("enforces staff, bank, application and revocation scope on reads and refreshes", async () => {
      const id = await fixture();
      const otherId = await fixture();
      const userId = randomUUID();
      await database.db.insert(users).values({
        id: userId,
        email: `footprint-staff-${userId}@example.test`,
        displayName: "Synthetic footprint officer",
        synthetic: true,
      });
      const [membership] = await database.db
        .insert(bankMemberships)
        .values({ bankId: ids.bankA, userId, role: "officer", synthetic: true })
        .returning();
      const staff = await client(userId),
        borrower = await client(ids.borrower),
        adviser = await client(ids.adviser),
        outside = await client(ids.officerB),
        anonymous = await client(null);
      try {
        const check = footprint(await staff.read(id));
        const other = footprint(await staff.read(otherId));
        const refreshPath = `${base(id)}/checks/${check.id}/refresh`;
        const input = { runId: check.currentRunId, expectedAddressRevision: 1 };
        for (const participant of [borrower, adviser]) {
          expect((await participant.read(id)).checks.some((c) => c.kind === "loan_footprint")).toBe(
            false,
          );
          expect((await participant.call(refreshPath, input)).status).toBe(404);
        }
        for (const unauthorized of [outside, anonymous]) {
          expect((await unauthorized.call(`${base(id)}/checks`)).status).toBe(404);
          expect((await unauthorized.call(refreshPath, input)).status).toBe(404);
        }
        expect(
          (await staff.call(`${base(otherId)}/checks/${check.id}/refresh`, input)).status,
        ).toBe(404);
        expect(
          (await staff.call(refreshPath, { ...input, runId: other.currentRunId })).status,
        ).toBe(404);
        expect((await staff.call(`${base(ids.applicationOtherBank)}/checks`)).status).toBe(404);
        expect((await staff.call(refreshPath.replace(ids.bankA, ids.bankB), input)).status).toBe(
          404,
        );
        await database.db
          .update(bankMemberships)
          .set({ revokedAt: new Date() })
          .where(eq(bankMemberships.id, membership!.id));
        expect((await staff.call(`${base(id)}/checks`)).status).toBe(404);
        expect((await staff.call(refreshPath, input)).status).toBe(404);
      } finally {
        await Promise.all([staff, borrower, adviser, outside, anonymous].map((c) => c.close()));
      }
    });

    it("validates command origin, CSRF and body and describes the same public contract", async () => {
      const id = await fixture();
      const staff = await client();
      try {
        const check = footprint(await staff.read(id));
        const path = `${base(id)}/checks/${check.id}/refresh`;
        const input = { runId: check.currentRunId, expectedAddressRevision: 1 };
        expect((await staff.call(path, input, { "x-csrf-token": "invalid" })).status).toBe(403);
        expect(
          (await staff.call(path, input, { origin: "https://untrusted.example.test" })).status,
        ).toBe(403);
        for (const invalid of [
          { ...input, expectedAddressRevision: -1 },
          { ...input, runId: "not-a-run" },
          { ...input, unexpected: true },
          { runId: check.currentRunId },
        ])
          expect((await staff.call(path, invalid)).status).toBe(400);
        const docs = await staff.call("/api/openapi.json");
        expect(docs.status).toBe(200);
        const route =
          docs.body.paths[
            "/api/v1/banks/{bankId}/applications/{applicationId}/checks/{resourceId}/refresh"
          ].post;
        const inputSchema = route.requestBody.content["application/json"].schema;
        expect(inputSchema.required).toEqual(
          expect.arrayContaining(["runId", "expectedAddressRevision"]),
        );
        expect(inputSchema.additionalProperties).toBe(false);
        expect(route.responses).toHaveProperty("409");
        expect(JSON.stringify(route.responses["200"])).toContain("loan_footprint");
        expect(JSON.stringify(route.responses["200"])).toContain("footprintInput");
        expect(
          (await staff.read(id)).checks.find((item) => item.id === check.id)?.currentRunId,
        ).toBe(check.currentRunId);
      } finally {
        await staff.close();
      }
    });
  });
}
