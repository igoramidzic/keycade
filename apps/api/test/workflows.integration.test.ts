import { randomUUID } from "node:crypto";
import {
  checksViewSchema,
  notificationsViewSchema,
  readinessViewSchema,
  signaturesViewSchema,
  tasksViewSchema,
} from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  businessRelationships,
  documentVersions,
  notifications,
  signatureArtifacts,
  signatureProviderEvents,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { type Actor, createDocumentsService, createIdentifierCipher } from "@keycade/domain";
import { processCheckRun } from "@keycade/integrations/check-jobs";
import { processSignatureJobs } from "@keycade/integrations/signatures-jobs";
import { createSignatureWebhookAuthenticator } from "@keycade/integrations/signatures-provider";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";
import { signatureWebhookContentType, signatureWebhookPath } from "../src/workflows.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const encryptionKey = "18".repeat(32);
const origin = "http://localhost:3001";
const csrf = "synthetic-workflow-csrf-0123456789012345";
const borrower: Actor = { kind: "user", userId: ids.borrower };
const base = (applicationId: string) => `/api/v1/banks/${ids.bankA}/applications/${applicationId}`;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function fixture() {
  const [source] = await database.db
    .select()
    .from(applications)
    .where(eq(applications.id, ids.applicationSmall));
  if (!source) throw new Error("Missing synthetic application fixture.");
  const id = randomUUID();
  await database.db
    .insert(applications)
    .values({ ...source, id, status: "collecting_information", revision: 1 });
  await database.db.insert(applicationSetups).values({
    bankId: ids.bankA,
    applicationId: id,
    currentStep: "review",
    completedAt: new Date(),
    completedByUserId: ids.borrower,
  });
  const [participant] = await database.db
    .insert(applicationParticipants)
    .values({
      bankId: ids.bankA,
      applicationId: id,
      userId: ids.borrower,
      role: "applicant_admin",
      scope: "full",
      synthetic: true,
    })
    .returning();
  return { id, participant: participant!, source };
}
for (const transport of ["fastify", "worker"] as const)
  describe(`${transport} workflow routes`, () => {
    async function client(userId: string | null = ids.borrower) {
      let authenticationCalls = 0;
      const options = {
        db: database.db,
        encryptionKey,
        allowedOrigins: [origin],
        authenticate: async () => {
          authenticationCalls++;
          return {
            actor: userId ? { kind: "user" as const, userId } : { kind: "anonymous" as const },
            csrfToken: csrf,
          };
        },
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
        authentications: () => authenticationCalls,
        async call(
          path: string,
          body?: object | string,
          headersOverride: Record<string, string | null> = {},
          method?: "GET" | "POST" | "PATCH",
        ) {
          const headers: Record<string, string> = {
            origin,
            "content-type": "application/json",
            "x-csrf-token": csrf,
          };
          for (const [name, value] of Object.entries(headersOverride)) {
            if (value === null) delete headers[name];
            else headers[name] = value;
          }
          const verb = method ?? (body === undefined ? "GET" : "POST");
          const raw =
            typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
          let status: number, text: string;
          if (transport === "fastify") {
            const response = await server.inject({
              url: path,
              method: verb,
              headers,
              ...(raw === undefined ? {} : { payload: raw }),
            });
            status = response.statusCode;
            text = response.body;
          } else {
            const response = await handleWorkerRequest(
              new Request(origin + path, {
                method: verb,
                headers,
                ...(raw === undefined ? {} : { body: raw }),
              }),
              { ...options, rateLimiter: { limit: async () => ({ success: true }) } },
            );
            status = response.status;
            text = await response.text();
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          return { status, body: parsed };
        },
      };
    }
    it("loads secure metadata up front and enforces origin, CSRF, revision and staff resolution policy", async () => {
      const { id } = await fixture();
      const user = await client(),
        staff = await client(ids.officerA),
        outside = await client(ids.officerB);
      try {
        let view = tasksViewSchema.parse((await user.call(`${base(id)}/tasks`)).body);
        const task = view.tasks.find((t) => t.inputKind === "synthetic_business_identifier")!;
        expect(task.secureInput).toMatchObject({
          identifierPresent: false,
          revision: 0,
          canEdit: true,
        });
        const input = {
          expectedRevision: task.revision,
          expectedInputRevision: 0,
          value: "000000003",
        };
        expect(
          (
            await user.call(`${base(id)}/tasks/${task.id}/identifier`, input, {
              "x-csrf-token": "invalid",
            })
          ).status,
        ).toBe(403);
        expect(
          (await user.call(`${base(id)}/tasks/${task.id}/identifier`, input, { origin: null }))
            .status,
        ).toBe(403);
        expect(
          (
            await user.call(`${base(id)}/tasks/${task.id}/identifier`, {
              ...input,
              value: "123456789",
            })
          ).status,
        ).toBe(400);
        const saved = await user.call(`${base(id)}/tasks/${task.id}/identifier`, input);
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        view = tasksViewSchema.parse(saved.body);
        expect(view.tasks.find((t) => t.id === task.id)).toMatchObject({
          state: "completed",
          secureInput: { identifierMasked: "**-***0003" },
        });
        expect(JSON.stringify(view)).not.toContain('"000000003"');
        expect((await user.call(`${base(id)}/tasks/${task.id}/identifier`, input)).status).toBe(
          409,
        );
        const authorization = view.tasks.find((t) => t.inputKind === "tax_authorization")!;
        const consent = await user.call(`${base(id)}/tasks/${authorization.id}/tax-authorization`, {
          expectedRevision: authorization.revision,
          expectedInputRevision: authorization.secureInput!.revision,
          authorized: true,
          noticeVersion: "demo-tax-v1",
        });
        expect(consent.status).toBe(200);
        expect(
          tasksViewSchema.parse(consent.body).tasks.find((t) => t.id === authorization.id)
            ?.secureInput?.taxAuthorized,
        ).toBe(true);
        let checks = checksViewSchema.parse((await staff.call(`${base(id)}/checks`)).body);
        let check = checks.checks.find((c) => c.kind === "fraud")!;
        await processCheckRun(
          database.db,
          createIdentifierCipher(encryptionKey),
          check.currentRunId!,
          { delayMs: 0, deadlineMs: 1000 },
        );
        checks = checksViewSchema.parse((await staff.call(`${base(id)}/checks`)).body);
        check = checks.checks.find((c) => c.kind === "fraud")!;
        expect(check).toMatchObject({ passes: false, canResolve: true });
        const resolve = { runId: check.currentRunId, reason: "reviewed_synthetic_evidence" };
        expect((await user.call(`${base(id)}/checks/${check.id}/resolve`, resolve)).status).toBe(
          404,
        );
        const resolved = await staff.call(`${base(id)}/checks/${check.id}/resolve`, resolve);
        expect(resolved.status).toBe(200);
        expect(
          checksViewSchema.parse(resolved.body).checks.find((c) => c.id === check.id)?.passes,
        ).toBe(true);
        const borrowed = checksViewSchema.parse((await user.call(`${base(id)}/checks`)).body);
        expect(
          borrowed.checks
            .flatMap((c) => c.runs)
            .every((r) => r.evidence === null && r.resolution === null),
        ).toBe(true);
        const latest = tasksViewSchema
          .parse((await user.call(`${base(id)}/tasks`)).body)
          .tasks.find((item) => item.id === task.id)!;
        expect(
          (
            await user.call(`${base(id)}/tasks/${task.id}/identifier`, {
              expectedRevision: latest.revision,
              expectedInputRevision: latest.secureInput!.revision,
              value: "000000006",
            })
          ).status,
        ).toBe(200);
        const failing = checksViewSchema
          .parse((await staff.call(`${base(id)}/checks`)).body)
          .checks.find((item) => item.id === check.id)!;
        await processCheckRun(
          database.db,
          createIdentifierCipher(encryptionKey),
          failing.currentRunId!,
          { delayMs: 0, deadlineMs: 1000 },
        );
        const retry = { runId: failing.currentRunId, reason: "operator_review" };
        expect((await user.call(`${base(id)}/checks/${check.id}/retry`, retry)).status).toBe(404);
        const retried = await staff.call(`${base(id)}/checks/${check.id}/retry`, retry);
        expect(retried.status, JSON.stringify(retried.body)).toBe(200);
        expect(
          checksViewSchema
            .parse(retried.body)
            .checks.find((item) => item.id === check.id)
            ?.runs.find((item) => item.id === failing.currentRunId)?.status,
        ).toBe("queued");
        const ready = readinessViewSchema.parse((await user.call(`${base(id)}/readiness`)).body);
        expect(ready.scope).toBe("assigned");
        expect(
          ready.gates
            .find((g) => g.stage === "submission")
            ?.blockers.every((b) => b.stage === "submission"),
        ).toBe(true);
        expect((await outside.call(`${base(id)}/checks`)).status).toBe(404);
        expect((await outside.call(`${base(id)}/readiness`)).status).toBe(404);
      } finally {
        await user.close();
        await staff.close();
        await outside.close();
      }
    });
    it("keeps an owner's identifier tasks and writes private from the full applicant administrator", async () => {
      const { id, source } = await fixture();
      const ownerId = randomUUID();
      await database.db.insert(users).values({
        id: ownerId,
        email: `workflow-owner-${ownerId}@example.test`,
        displayName: "Synthetic private owner",
        emailVerifiedAt: new Date(),
        synthetic: true,
      });
      await database.db.insert(applicationParticipants).values({
        bankId: ids.bankA,
        applicationId: id,
        userId: ownerId,
        role: "owner",
        scope: "assigned",
        synthetic: true,
      });
      await database.db.insert(businessRelationships).values({
        bankId: ids.bankA,
        applicationId: id,
        businessId: source.businessId!,
        kind: "owner",
        userId: ownerId,
        displayName: "Synthetic private owner",
        createdByUserId: ids.borrower,
        synthetic: true,
      });
      const owner = await client(ownerId),
        admin = await client();
      try {
        const own = tasksViewSchema.parse((await owner.call(`${base(id)}/tasks`)).body);
        const task = own.tasks.find((t) => t.inputKind === "synthetic_personal_identifier")!;
        expect(own.tasks.every((t) => t.subjectUserId === ownerId)).toBe(true);
        const other = tasksViewSchema.parse((await admin.call(`${base(id)}/tasks`)).body);
        expect(other.tasks.some((t) => t.id === task.id)).toBe(false);
        const input = {
          expectedRevision: task.revision,
          expectedInputRevision: 0,
          value: "000000001",
        };
        expect((await admin.call(`${base(id)}/tasks/${task.id}/identifier`, input)).status).toBe(
          404,
        );
        const saved = await owner.call(`${base(id)}/tasks/${task.id}/identifier`, input);
        expect(saved.status).toBe(200);
        expect(
          tasksViewSchema.parse(saved.body).tasks.find((t) => t.id === task.id)?.secureInput
            ?.identifierMasked,
        ).toBe("***-**-0001");
        const checks = checksViewSchema.parse((await owner.call(`${base(id)}/checks`)).body);
        expect(checks.checks).toHaveLength(1);
        expect(checks.checks[0]?.subjectUserId).toBe(ownerId);
      } finally {
        await owner.close();
        await admin.close();
      }
    });
    it("scopes preferences to the user and restricts notification status and retries to bank staff", async () => {
      const { id } = await fixture();
      const user = await client(),
        staff = await client(ids.officerA),
        outside = await client(ids.officerB);
      const preferences = `/api/v1/banks/${ids.bankA}/notification-preferences`;
      try {
        expect((await user.call(preferences)).status).toBe(200);
        expect(
          (await user.call(preferences, { remindersEnabled: false }, { "x-csrf-token": null }))
            .status,
        ).toBe(403);
        expect((await user.call(preferences, { remindersEnabled: false })).body).toEqual({
          remindersEnabled: false,
        });
        expect((await user.call(preferences)).body).toEqual({ remindersEnabled: false });
        expect((await outside.call(preferences)).status).toBe(404);
        const [contact] = await database.db
          .select()
          .from(applicantContacts)
          .where(
            and(
              eq(applicantContacts.bankId, ids.bankA),
              eq(applicantContacts.userId, ids.borrower),
            ),
          );
        const [delivery] = await database.db
          .insert(accessDeliveryRequests)
          .values({
            bankId: ids.bankA,
            applicationId: id,
            contactId: contact!.id,
            portal: "borrower",
            origin,
            returnPath: `/applications/${id}`,
            expiresAt: new Date(Date.now() + 60000),
            status: "failed",
            attempts: 3,
            lastErrorCode: "synthetic_delivery_failed",
            requestId: randomUUID(),
          })
          .returning();
        const [notification] = await database.db
          .insert(notifications)
          .values({
            bankId: ids.bankA,
            applicationId: id,
            recipientUserId: ids.borrower,
            contactId: contact!.id,
            kind: "status_changed",
            resourceRevision: 1,
            deduplicationKey: randomUUID(),
            state: "queued",
            deliveryRequestId: delivery!.id,
          })
          .returning();
        expect((await user.call(`${base(id)}/notifications`)).status).toBe(404);
        expect((await outside.call(`${base(id)}/notifications`)).status).toBe(404);
        const statuses = notificationsViewSchema.parse(
          (await staff.call(`${base(id)}/notifications`)).body,
        );
        expect(statuses.notifications.find((n) => n.id === notification!.id)).toMatchObject({
          status: "failed",
          canRetry: true,
          simulated: true,
        });
        expect(
          (await user.call(`${base(id)}/notifications/${notification!.id}/retry`, {})).status,
        ).toBe(404);
        expect(
          (await outside.call(`${base(id)}/notifications/${notification!.id}/retry`, {})).status,
        ).toBe(404);
        const retried = await staff.call(`${base(id)}/notifications/${notification!.id}/retry`, {});
        expect(retried.status, JSON.stringify(retried.body)).toBe(200);
        expect(
          notificationsViewSchema
            .parse(retried.body)
            .notifications.find((n) => n.id === notification!.id),
        ).toMatchObject({ status: "queued", attempts: 0, canRetry: false });
        await user.call(preferences, { remindersEnabled: true });
      } finally {
        await user.close();
        await staff.close();
        await outside.close();
      }
    });
    it("verifies raw HMAC callbacks without browser credentials and deduplicates signed events", async () => {
      const { id, participant } = await fixture();
      const staff = await client(ids.officerA),
        anonymous = await client(null),
        user = await client();
      try {
        const docs = createDocumentsService(database.db, { scanDelayMs: 0 });
        const upload = await docs.beginUpload(
          borrower,
          ids.bankA,
          id,
          {
            fileName: "Synthetic signature source.pdf",
            mimeType: "application/pdf",
            expectedSize: 100,
            idempotencyKey: randomUUID(),
          },
          randomUUID(),
        );
        await docs.finalizeUpload(
          borrower,
          ids.bankA,
          id,
          upload.uploadId,
          { size: 100, sha256: "a".repeat(64) },
          randomUUID(),
        );
        await database.db
          .update(documentVersions)
          .set({ scanState: "clean", scannedAt: new Date() })
          .where(eq(documentVersions.id, upload.versionId));
        const [task] = await database.db
          .insert(applicationTasks)
          .values({
            bankId: ids.bankA,
            applicationId: id,
            stableKey: `signature-http:${randomUUID()}`,
            source: "manual",
            title: "Synthetic HTTP signature",
            description: "Synthetic source only",
            reason: "Transport fixture",
            stage: "approval",
            required: true,
            visibility: "shared",
            inputRevision: 1,
            assigneeParticipantId: participant.id,
          })
          .returning();
        const create = {
          taskId: task!.id,
          sourceVersionId: upload.versionId,
          signerParticipantIds: [participant.id],
          idempotencyKey: randomUUID(),
        };
        expect((await user.call(`${base(id)}/signatures`, create)).status).toBe(404);
        const made = await staff.call(`${base(id)}/signatures`, create);
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        const envelope = signaturesViewSchema
          .parse(made.body)
          .envelopes.find((e) => e.taskId === task!.id)!;
        expect(
          (await staff.call(`${base(id)}/signatures/${envelope.id}/send`, {}, { origin: null }))
            .status,
        ).toBe(403);
        expect((await staff.call(`${base(id)}/signatures/${envelope.id}/send`, {})).status).toBe(
          200,
        );
        await processSignatureJobs(database.db, { delayMs: 0 });
        const event = {
          eventId: randomUUID(),
          envelopeId: envelope.id,
          signerId: envelope.signers[0]!.id,
          type: "signer_signed",
          occurredAt: new Date().toISOString(),
        };
        const raw = JSON.stringify(event);
        const mac = createSignatureWebhookAuthenticator(encryptionKey);
        const headers = {
          origin: null,
          "x-csrf-token": null,
          "content-type": signatureWebhookContentType,
        };
        expect((await anonymous.call(signatureWebhookPath, raw, headers)).status).toBe(403);
        expect(
          (
            await anonymous.call(signatureWebhookPath, raw, {
              ...headers,
              "x-keycade-signature": "v1=" + "0".repeat(64),
            })
          ).status,
        ).toBe(403);
        const malformed = "{";
        expect(
          (
            await anonymous.call(signatureWebhookPath, malformed, {
              ...headers,
              "x-keycade-signature": mac.sign(malformed),
            })
          ).status,
        ).toBe(400);
        const invalid = JSON.stringify({ ...event, signerId: undefined });
        expect(
          (
            await anonymous.call(signatureWebhookPath, invalid, {
              ...headers,
              "x-keycade-signature": mac.sign(invalid),
            })
          ).status,
        ).toBe(400);
        const authenticated = { ...headers, "x-keycade-signature": mac.sign(raw) };
        expect((await anonymous.call(signatureWebhookPath, raw + " ", authenticated)).status).toBe(
          403,
        );
        for (let i = 0; i < 2; i++) {
          const callback = await anonymous.call(signatureWebhookPath, raw, authenticated);
          expect(callback.status, JSON.stringify(callback.body)).toBe(200);
          expect(callback.body).toEqual({ ok: true });
        }
        expect(anonymous.authentications()).toBe(0);
        expect(
          await database.db
            .select()
            .from(signatureProviderEvents)
            .where(eq(signatureProviderEvents.eventId, event.eventId)),
        ).toHaveLength(1);
        expect(
          await database.db
            .select()
            .from(signatureArtifacts)
            .where(eq(signatureArtifacts.envelopeId, envelope.id)),
        ).toHaveLength(1);
        const finished = signaturesViewSchema.parse(
          (await user.call(`${base(id)}/signatures`)).body,
        );
        expect(finished.envelopes.find((e) => e.id === envelope.id)).toMatchObject({
          state: "completed",
          canDownloadArtifact: true,
        });
      } finally {
        await staff.close();
        await anonymous.close();
        await user.close();
      }
    });
  });
