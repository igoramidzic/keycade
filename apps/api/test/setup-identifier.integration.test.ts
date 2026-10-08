import { randomUUID } from "node:crypto";
import { applicationSetupSchema } from "@keycade/contracts";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  auditEvents,
  enrichmentInputs,
  enrichmentRuns,
  sensitiveIdentifierVersions,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  createApplicationService,
  createEnrichmentService,
  createIdentifierCipher,
} from "@keycade/domain";
import { and, asc, eq } from "drizzle-orm";
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
const csrf = "synthetic-setup-ein-csrf-0123456789012345";
const actor = { kind: "user" as const, userId: ids.borrower };
const command = (expectedRevision: number, value = "000000001") => ({
  definitionVersion: 2,
  expectedRevision,
  action: "save",
  value,
  currentStep: "industry",
});
async function draft() {
  return createApplicationService(database.db).create(
    actor,
    ids.bankA,
    { idempotencyKey: randomUUID() },
    randomUUID(),
  );
}

for (const transport of ["fastify", "worker"] as const) {
  describe(`${transport} narrow setup EIN command with PostgreSQL`, () => {
    async function client(
      userId = ids.borrower as string,
      configuredKey: string | undefined = encryptionKey,
    ) {
      const options = {
        db: database.db,
        encryptionKey: configuredKey,
        allowedOrigins: [origin],
        authenticate: async () => ({ actor: { kind: "user" as const, userId }, csrfToken: csrf }),
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
          applicationId: string,
          body?: object,
          optionsInput: {
            method?: "GET" | "POST" | "PATCH";
            bankId?: string;
            resource?: string;
            proof?: string;
          } = {},
        ) {
          const url = `/api/v1/banks/${optionsInput.bankId ?? ids.bankA}/applications/${applicationId}/${optionsInput.resource ?? "setup/identifier"}`;
          const method = optionsInput.method ?? (body ? "PATCH" : "GET");
          const headers = {
            origin,
            "content-type": "application/json",
            "x-csrf-token": optionsInput.proof ?? csrf,
          };
          if (transport === "fastify") {
            const response = await server.inject({
              url,
              method,
              headers,
              ...(body ? { payload: body } : {}),
            });
            return { status: response.statusCode, body: response.json() };
          }
          const response = await handleWorkerRequest(
            new Request(origin + url, {
              method,
              headers,
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
            { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
          );
          return { status: response.status, body: await response.json() };
        },
      };
    }

    it("saves, resumes, replaces and explicitly clears encrypted EIN versions without consent or checks", async () => {
      let setup = await draft();
      const user = await client();
      try {
        expect(setup.businessId).toBeNull();
        const revision = setup.revision;
        const response = await user.call(setup.id, command(revision));
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        setup = applicationSetupSchema.parse(response.body);
        expect(setup.revision).toBe(revision + 1);
        expect(setup.businessEin).toEqual({ present: true, mask: "**-***0001" });
        expect(setup.completedSteps).toContain("business_ein");
        expect(setup.currentStep).toBe("industry");
        expect(JSON.stringify(response.body)).not.toContain('"000000001"');
        expect((await user.call(setup.id, command(revision))).status).toBe(409);
        const resumed = await user.call(setup.id, undefined, { resource: "setup" });
        expect(resumed.status).toBe(200);
        expect(applicationSetupSchema.parse(resumed.body).businessEin).toEqual(setup.businessEin);
        const skip = await user.call(
          setup.id,
          {
            definitionVersion: 2,
            expectedRevision: setup.revision,
            answers: {},
            step: "business_ein",
            skip: true,
            currentStep: "industry",
          },
          { resource: "setup" },
        );
        expect(skip.status, JSON.stringify(skip.body)).toBe(200);
        setup = applicationSetupSchema.parse(skip.body);
        expect(setup.businessEin.present).toBe(true);
        const replaced = await user.call(setup.id, command(setup.revision, "000000002"));
        expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
        setup = applicationSetupSchema.parse(replaced.body);
        expect(setup.businessEin.mask).toBe("**-***0002");
        const cleared = await user.call(setup.id, {
          definitionVersion: 2,
          expectedRevision: setup.revision,
          action: "clear",
          currentStep: "business_ein",
        });
        expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
        setup = applicationSetupSchema.parse(cleared.body);
        expect(setup.businessEin).toEqual({ present: false, mask: null });
        expect(setup.skippedSteps).toContain("business_ein");
        const savedAgain = await user.call(setup.id, command(setup.revision, "000000003"));
        expect(savedAgain.status, JSON.stringify(savedAgain.body)).toBe(200);
        const versions = await database.db
          .select()
          .from(sensitiveIdentifierVersions)
          .where(eq(sensitiveIdentifierVersions.applicationId, setup.id))
          .orderBy(asc(sensitiveIdentifierVersions.revision));
        expect(versions.map((v) => v.revision)).toEqual([1, 2, 3]);
        for (const [index, version] of versions.entries()) {
          expect(version.kind).toBe("ein");
          expect(version.subjectKey).toBe("business");
          expect(version.encryptedValue).not.toContain(`00000000${index + 1}`);
          expect(
            createIdentifierCipher(encryptionKey).decrypt(version.encryptedValue, {
              bankId: ids.bankA,
              applicationId: setup.id,
              subjectKey: "business",
              revision: version.revision,
            }),
          ).toBe(`00000000${index + 1}`);
        }
        const [input] = await database.db
          .select()
          .from(enrichmentInputs)
          .where(eq(enrichmentInputs.applicationId, setup.id));
        expect(input).toMatchObject({
          taxAuthorizedAt: null,
          taxAuthorizedByUserId: null,
          taxNoticeVersion: null,
        });
        expect(
          await database.db
            .select()
            .from(enrichmentRuns)
            .where(eq(enrichmentRuns.applicationId, setup.id)),
        ).toHaveLength(0);
        const audits = await database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.applicationId, setup.id));
        expect(audits.filter((event) => event.action === "identifier.setup_saved")).toHaveLength(3);
        expect(audits.filter((event) => event.action === "identifier.setup_cleared")).toHaveLength(
          1,
        );
        for (const raw of ["000000001", "000000002", "000000003"])
          expect(JSON.stringify(audits)).not.toContain(JSON.stringify(raw));
        const appRows = await database.db
          .select()
          .from(applications)
          .where(eq(applications.id, setup.id));
        expect(JSON.stringify(appRows)).not.toContain('"000000003"');
      } finally {
        await user.close();
      }
    });

    it("rejects invalid/SSN/consent input, missing CSRF, stale revisions and completed or closed setups without writes", async () => {
      const setup = await draft();
      const user = await client();
      try {
        for (const invalid of [
          command(setup.revision, "123456789"),
          { ...command(setup.revision), subjectUserId: ids.borrower },
          { ...command(setup.revision), kind: "ssn" },
          { ...command(setup.revision), authorized: true },
          { ...command(setup.revision), action: "clear" },
          { ...command(setup.revision), definitionVersion: 1 },
        ])
          expect((await user.call(setup.id, invalid)).status).toBe(400);
        expect(
          (await user.call(setup.id, command(setup.revision), { proof: "invalid" })).status,
        ).toBe(403);
        expect((await user.call(setup.id, command(setup.revision + 1))).status).toBe(409);
        expect(
          (
            await user.call(
              setup.id,
              { value: "000000001", expectedRevision: 0 },
              { resource: "enrichment/identifier", method: "POST" },
            )
          ).body.error.code,
        ).toBe("SETUP_REQUIRED");
        expect(
          (
            await user.call(
              setup.id,
              { authorized: true, noticeVersion: "demo-tax-v1", expectedRevision: 0 },
              { resource: "enrichment/tax-authorization", method: "POST" },
            )
          ).body.error.code,
        ).toBe("SETUP_REQUIRED");
        await database.db
          .update(applications)
          .set({ status: "withdrawn" })
          .where(eq(applications.id, setup.id));
        expect((await user.call(setup.id, command(setup.revision))).status).toBe(409);
        await database.db
          .update(applications)
          .set({ status: "draft" })
          .where(eq(applications.id, setup.id));
        await database.db
          .update(applicationSetups)
          .set({ completedAt: new Date(), completedByUserId: ids.borrower })
          .where(eq(applicationSetups.applicationId, setup.id));
        expect((await user.call(setup.id, command(setup.revision))).status).toBe(409);
        expect(
          await database.db
            .select()
            .from(sensitiveIdentifierVersions)
            .where(eq(sensitiveIdentifierVersions.applicationId, setup.id)),
        ).toHaveLength(0);
        expect(
          await database.db
            .select()
            .from(enrichmentInputs)
            .where(eq(enrichmentInputs.applicationId, setup.id)),
        ).toHaveLength(0);
      } finally {
        await user.close();
      }
    });

    it("permits same-bank staff and denies other applications, cross-bank users, restricted roles and revoked grants", async () => {
      const setup = await draft();
      await database.db.insert(applicationParticipants).values({
        bankId: ids.bankA,
        applicationId: setup.id,
        userId: ids.adviser,
        role: "adviser",
        scope: "assigned",
        synthetic: true,
      });
      await database.db.insert(applicationParticipants).values({
        bankId: ids.bankA,
        applicationId: setup.id,
        userId: ids.revokedOwner,
        role: "owner",
        scope: "full",
        synthetic: true,
      });
      for (const userId of [ids.officerB, ids.adviser, ids.revokedOwner]) {
        const user = await client(userId);
        try {
          expect((await user.call(setup.id, command(setup.revision))).status).toBe(404);
        } finally {
          await user.close();
        }
      }
      const borrower = await client();
      try {
        expect((await borrower.call(ids.applicationUnshared, command(1))).status).toBe(404);
        expect(
          (await borrower.call(setup.id, command(setup.revision), { bankId: ids.bankB })).status,
        ).toBe(404);
        await database.db
          .update(applicationParticipants)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(applicationParticipants.applicationId, setup.id),
              eq(applicationParticipants.userId, ids.borrower),
            ),
          );
        expect((await borrower.call(setup.id, command(setup.revision))).status).toBe(404);
        expect((await borrower.call(setup.id, undefined, { resource: "setup" })).status).toBe(404);
      } finally {
        await borrower.close();
      }
      const staff = await client(ids.officerA);
      try {
        const response = await staff.call(setup.id, command(setup.revision));
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(applicationSetupSchema.parse(response.body).businessEin.mask).toBe("**-***0001");
      } finally {
        await staff.close();
      }
    });

    it("keeps staff EIN prefills unacknowledged until the borrower confirms or skips the question", async () => {
      let setup = await draft();
      const staff = await client(ids.officerA);
      const borrower = await client();
      try {
        const initialStep = setup.currentStep;
        const prefilled = await staff.call(setup.id, command(setup.revision));
        expect(prefilled.status, JSON.stringify(prefilled.body)).toBe(200);
        setup = applicationSetupSchema.parse(prefilled.body);
        expect(setup.currentStep).toBe(initialStep);
        expect(setup.completedSteps).not.toContain("business_ein");
        expect(setup.skippedSteps).not.toContain("business_ein");
        const resumed = await borrower.call(setup.id, undefined, { resource: "setup" });
        setup = applicationSetupSchema.parse(resumed.body);
        expect(setup.businessEin).toEqual({ present: true, mask: "**-***0001" });
        expect(JSON.stringify(resumed.body)).not.toContain('"000000001"');
        const confirmed = await borrower.call(
          setup.id,
          {
            definitionVersion: 2,
            expectedRevision: setup.revision,
            answers: {},
            step: "business_ein",
            currentStep: "industry",
          },
          { resource: "setup" },
        );
        expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
        setup = applicationSetupSchema.parse(confirmed.body);
        expect(setup.completedSteps).toContain("business_ein");
        const replaced = await staff.call(setup.id, {
          ...command(setup.revision, "000000002"),
          currentStep: "review",
        });
        expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
        setup = applicationSetupSchema.parse(replaced.body);
        expect(setup.currentStep).toBe("industry");
        expect(setup.businessEin.mask).toBe("**-***0002");
        expect(setup.completedSteps).not.toContain("business_ein");
        expect(setup.skippedSteps).not.toContain("business_ein");
        const cleared = await staff.call(setup.id, {
          definitionVersion: 2,
          expectedRevision: setup.revision,
          action: "clear",
          currentStep: "review",
        });
        expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
        setup = applicationSetupSchema.parse(cleared.body);
        expect(setup.currentStep).toBe("industry");
        expect(setup.businessEin.present).toBe(false);
        expect(setup.completedSteps).not.toContain("business_ein");
        expect(setup.skippedSteps).not.toContain("business_ein");
        const skipped = await borrower.call(
          setup.id,
          {
            definitionVersion: 2,
            expectedRevision: setup.revision,
            answers: {},
            step: "business_ein",
            skip: true,
            currentStep: "industry",
          },
          { resource: "setup" },
        );
        expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
        expect(applicationSetupSchema.parse(skipped.body).skippedSteps).toContain("business_ein");
      } finally {
        await staff.close();
        await borrower.close();
      }
    });

    it("prevents the general staff enrichment route from bypassing draft EIN revision and confirmation", async () => {
      const draftSetup = await draft();
      const borrower = await client();
      const staff = await client(ids.officerA);
      try {
        const response = await borrower.call(draftSetup.id, command(draftSetup.revision));
        expect(response.status).toBe(200);
        const saved = applicationSetupSchema.parse(response.body);
        expect(saved.completedSteps).toContain("business_ein");
        const bypass = await staff.call(
          saved.id,
          { expectedRevision: 1, value: "000000002" },
          {
            method: "POST",
            resource: "enrichment/identifier",
          },
        );
        expect(bypass.status, JSON.stringify(bypass.body)).toBe(409);
        expect(bypass.body.error.code).toBe("SETUP_REQUIRED");
        expect(
          applicationSetupSchema.parse(
            (await borrower.call(saved.id, undefined, { resource: "setup" })).body,
          ),
        ).toEqual(saved);
        const [input] = await database.db
          .select()
          .from(enrichmentInputs)
          .where(eq(enrichmentInputs.applicationId, saved.id));
        expect(input?.revision).toBe(1);
        expect(
          await database.db
            .select()
            .from(sensitiveIdentifierVersions)
            .where(eq(sensitiveIdentifierVersions.applicationId, saved.id)),
        ).toHaveLength(1);
        const updated = await staff.call(saved.id, command(saved.revision, "000000002"));
        expect(updated.status).toBe(200);
        const prefilled = applicationSetupSchema.parse(updated.body);
        expect(prefilled.businessEin.mask).toBe("**-***0002");
        expect(prefilled.revision).toBe(saved.revision + 1);
        expect(prefilled.completedSteps).not.toContain("business_ein");
      } finally {
        await borrower.close();
        await staff.close();
      }
    });

    it("allows a staff member with an active full applicant grant to acknowledge their own EIN", async () => {
      const setup = await draft();
      await database.db.insert(applicationParticipants).values({
        bankId: ids.bankA,
        applicationId: setup.id,
        userId: ids.officerA,
        role: "applicant_admin",
        scope: "full",
        synthetic: true,
      });
      const user = await client(ids.officerA);
      try {
        const response = await user.call(setup.id, command(setup.revision));
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const saved = applicationSetupSchema.parse(response.body);
        expect(saved.completedSteps).toContain("business_ein");
        expect(saved.currentStep).toBe("industry");
        await database.db
          .update(applicationParticipants)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(applicationParticipants.applicationId, setup.id),
              eq(applicationParticipants.userId, ids.officerA),
            ),
          );
        const prefill = await user.call(setup.id, {
          ...command(saved.revision, "000000002"),
          currentStep: "review",
        });
        expect(prefill.status).toBe(200);
        expect(applicationSetupSchema.parse(prefill.body).completedSteps).not.toContain(
          "business_ein",
        );
        expect(applicationSetupSchema.parse(prefill.body).currentStep).toBe("industry");
      } finally {
        await user.close();
      }
    });

    it("serializes competing writes and rejects a stale clear without losing the saved EIN", async () => {
      const setup = await draft();
      const user = await client();
      try {
        const results = await Promise.all([
          user.call(setup.id, command(setup.revision)),
          user.call(setup.id, command(setup.revision, "000000002")),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(
          (
            await user.call(setup.id, {
              definitionVersion: 2,
              expectedRevision: setup.revision,
              action: "clear",
            })
          ).status,
        ).toBe(409);
        const current = applicationSetupSchema.parse(
          (await user.call(setup.id, undefined, { resource: "setup" })).body,
        );
        expect(current.businessEin.present).toBe(true);
        expect(current.revision).toBe(setup.revision + 1);
        expect(
          await database.db
            .select()
            .from(sensitiveIdentifierVersions)
            .where(eq(sensitiveIdentifierVersions.applicationId, setup.id)),
        ).toHaveLength(1);
        const [record] = await database.db
          .select()
          .from(applicationSetups)
          .where(eq(applicationSetups.applicationId, setup.id));
        expect(record?.revision).toBe(current.revision);
      } finally {
        await user.close();
      }
    });
  });
}

it("rolls back input creation and setup progress when private identifier encryption fails", async () => {
  const setup = await draft();
  const service = createEnrichmentService(database.db, {
    cipher: {
      encrypt() {
        throw new Error("Injected encryption failure.");
      },
      decrypt() {
        throw new Error("Unexpected decryption.");
      },
    },
  });
  await expect(
    service.saveSetupIdentifier(actor, ids.bankA, setup.id, command(setup.revision), randomUUID()),
  ).rejects.toThrow("Injected encryption failure.");
  const current = await createApplicationService(database.db).readSetup(actor, ids.bankA, setup.id);
  expect(current.revision).toBe(setup.revision);
  expect(current.businessEin.present).toBe(false);
  expect(current.completedSteps).not.toContain("business_ein");
  expect(
    await database.db
      .select()
      .from(enrichmentInputs)
      .where(eq(enrichmentInputs.applicationId, setup.id)),
  ).toHaveLength(0);
  expect(
    await database.db
      .select()
      .from(sensitiveIdentifierVersions)
      .where(eq(sensitiveIdentifierVersions.applicationId, setup.id)),
  ).toHaveLength(0);
});
