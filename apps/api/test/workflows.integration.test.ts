import { randomUUID } from "node:crypto";
import {
  checksViewSchema,
  notificationsViewSchema,
  readinessViewSchema,
  reviewViewSchema,
  signaturesViewSchema,
  tasksViewSchema,
} from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationDecisions,
  applicationParticipants,
  applicationReviewEvents,
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
import {
  type Actor,
  createDocumentsService,
  createIdentifierCipher,
  createTasksService,
} from "@keycade/domain";
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
    it("serves scoped review history and enforces human actor, stage, idempotency, revision and private-note boundaries", async () => {
      const { id, participant } = await fixture();
      const user = await client(),
        staff = await client(ids.officerA),
        outside = await client(ids.officerB),
        anonymous = await client(null);
      const route = `${base(id)}/review`;
      const key = (expectedRevision: number) => ({
        expectedRevision,
        idempotencyKey: randomUUID(),
      });
      try {
        const initial = reviewViewSchema.parse((await user.call(route)).body);
        expect(initial.status).toBe("collecting_information");
        expect(initial.canManage).toBe(false);
        expect(initial.capabilities.submit).toBe(true);
        expect((await outside.call(route)).status).toBe(404);
        expect((await staff.call(route.replace(ids.bankA, ids.bankB))).status).toBe(404);
        expect((await anonymous.call(route)).status).toBe(404);
        const otherUser = randomUUID();
        await database.db.insert(users).values({
          id: otherUser,
          email: `review-collaborator-${otherUser}@example.test`,
          displayName: "Synthetic review collaborator",
          emailVerifiedAt: new Date(),
          synthetic: true,
        });
        await database.db.insert(applicationParticipants).values({
          bankId: ids.bankA,
          applicationId: id,
          userId: otherUser,
          role: "adviser",
          scope: "assigned",
          synthetic: true,
        });
        const collaborator = await client(otherUser);
        try {
          expect((await collaborator.call(route)).status).toBe(404);
        } finally {
          await collaborator.close();
        }
        expect((await user.call(`${route}/submit`, key(initial.revision))).status).toBe(409);
        expect((await user.call(`${route}/start-review`, key(initial.revision))).status).toBe(404);
        const tasks = createTasksService(database.db);
        const all = await tasks.read({ kind: "user", userId: ids.officerA }, ids.bankA, id);
        for (const task of all.tasks.filter((t) => t.stage === "submission" && t.required))
          await tasks.waive(
            { kind: "user", userId: ids.officerA },
            ids.bankA,
            id,
            task.id,
            {
              expectedRevision: task.revision,
              reason: "Synthetic submission waiver for transport fixture",
            },
            randomUUID(),
          );
        const submit = key(initial.revision);
        expect((await staff.call(`${route}/submit`, submit, { origin: null })).status).toBe(403);
        expect(
          (await staff.call(`${route}/submit`, submit, { "x-csrf-token": "wrong" })).status,
        ).toBe(403);
        const submittedResponse = await staff.call(`${route}/submit`, submit);
        expect(submittedResponse.status, JSON.stringify(submittedResponse.body)).toBe(200);
        let v = reviewViewSchema.parse(submittedResponse.body);
        expect(v.submissions[0]?.submittedOnBehalf).toBe(true);
        expect((await staff.call(`${route}/submit`, submit)).status).toBe(200);
        expect((await user.call(`${route}/submit`, submit)).status).toBe(409);
        expect((await staff.call(`${route}/start-review`, key(initial.revision))).status).toBe(409);
        v = reviewViewSchema.parse(
          (await staff.call(`${route}/start-review`, key(v.revision))).body,
        );
        expect(
          (
            await staff.call(`${route}/approve`, {
              ...key(v.revision),
              reasonCode: "demo_criteria_met",
              approvedAmount: "10000.00",
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await staff.call(`${route}/approve`, {
              ...key(v.revision),
              reasonCode: "demo_criteria_met",
              approvedAmount: "10000.00",
              humanDecisionConfirmed: true,
            })
          ).status,
        ).toBe(409);
        const task = v.requestableTasks.find((t) => t.stage === "submission")!;
        v = reviewViewSchema.parse(
          (
            await staff.call(`${route}/request-information`, {
              ...key(v.revision),
              reasonCode: "current_evidence_required",
              privateNote: "Private transport-only review context",
              taskIds: [task.id],
            })
          ).body,
        );
        expect(v.status).toBe("needs_information");
        expect(v.history[0]?.privateNote).toBe("Private transport-only review context");
        const publicView = reviewViewSchema.parse((await user.call(route)).body);
        expect(publicView.history[0]?.publicReason).toBe(
          "Current supporting evidence is required before a decision.",
        );
        expect(publicView.history[0]?.privateNote).toBeNull();
        expect(publicView.history.every((e) => e.actorUserId === null)).toBe(true);
        expect(JSON.stringify(publicView)).not.toContain("transport-only");
        expect(
          (
            await user.call(`${route}/withdraw`, {
              ...key(v.revision),
              reasonCode: "applicant_requested",
              privateNote: "Trying staff note",
            })
          ).status,
        ).toBe(404);
        const withdrawal = { ...key(v.revision), reasonCode: "applicant_requested" };
        v = reviewViewSchema.parse((await user.call(`${route}/withdraw`, withdrawal)).body);
        expect(v.status).toBe("withdrawn");
        expect((await user.call(`${route}/withdraw`, withdrawal)).status).toBe(200);
        await database.db
          .update(applicationParticipants)
          .set({ revokedAt: new Date() })
          .where(eq(applicationParticipants.id, participant.id));
        expect((await user.call(`${route}/withdraw`, withdrawal)).status).toBe(404);
        const events = await database.db
          .select()
          .from(applicationReviewEvents)
          .where(eq(applicationReviewEvents.applicationId, id));
        expect(events.map((e) => e.action).sort()).toEqual([
          "request_information",
          "start_review",
          "submit",
          "withdraw",
        ]);
      } finally {
        await user.close();
        await staff.close();
        await outside.close();
        await anonymous.close();
      }
    });
    it("records a human approval through the current readiness gate and supports pre-setup withdrawal", async () => {
      const { id } = await fixture();
      const user = await client(),
        staff = await client(ids.officerA);
      const route = `${base(id)}/review`;
      const key = (expectedRevision: number) => ({
        expectedRevision,
        idempotencyKey: randomUUID(),
      });
      try {
        const tasks = createTasksService(database.db);
        const all = await tasks.read({ kind: "user", userId: ids.officerA }, ids.bankA, id);
        for (const task of all.tasks.filter(
          (t) => t.stage !== "closing" && t.required && t.inputKind === "answer",
        ))
          await tasks.waive(
            { kind: "user", userId: ids.officerA },
            ids.bankA,
            id,
            task.id,
            {
              expectedRevision: task.revision,
              reason: "Synthetic approval waiver for transport fixture",
            },
            randomUUID(),
          );
        const entry = tasksViewSchema
          .parse((await user.call(`${base(id)}/tasks`)).body)
          .tasks.find((t) => t.inputKind === "synthetic_business_identifier")!;
        expect(
          (
            await user.call(`${base(id)}/tasks/${entry.id}/identifier`, {
              expectedRevision: entry.revision,
              expectedInputRevision: entry.secureInput!.revision,
              value: "000000001",
            })
          ).status,
        ).toBe(200);
        const check = checksViewSchema
          .parse((await staff.call(`${base(id)}/checks`)).body)
          .checks.find((c) => c.kind === "fraud")!;
        await processCheckRun(
          database.db,
          createIdentifierCipher(encryptionKey),
          check.currentRunId!,
          { delayMs: 0 },
        );
        let v = reviewViewSchema.parse((await user.call(route)).body);
        v = reviewViewSchema.parse((await user.call(`${route}/submit`, key(v.revision))).body);
        expect(v.submissions[0]?.submittedOnBehalf).toBe(false);
        v = reviewViewSchema.parse(
          (await staff.call(`${route}/start-review`, key(v.revision))).body,
        );
        expect(v.readiness.gates.find((g) => g.stage === "approval")?.ready).toBe(true);
        const approval = {
          ...key(v.revision),
          humanDecisionConfirmed: true,
          reasonCode: "demo_criteria_met",
          approvedAmount: "10000.00",
          privateNote: "Internal approval context",
        };
        expect((await user.call(`${route}/approve`, approval)).status).toBe(404);
        expect(
          (
            await staff.call(`${route}/approve`, {
              ...approval,
              reasonCode: "freeform unsafe reason",
            })
          ).status,
        ).toBe(400);
        const approved = await staff.call(`${route}/approve`, approval);
        expect(approved.status, JSON.stringify(approved.body)).toBe(200);
        v = reviewViewSchema.parse(approved.body);
        expect(v.status).toBe("approved");
        expect(v.decisions[0]?.privateNote).toBe("Internal approval context");
        expect((await staff.call(`${route}/approve`, approval)).status).toBe(200);
        const publicView = reviewViewSchema.parse((await user.call(route)).body);
        expect(publicView.decisions[0]).toMatchObject({
          privateNote: null,
          decidedByUserId: null,
          approvedAmount: "10000.00",
          publicReason: "The application meets the simulated review criteria.",
        });
        expect(
          await database.db
            .select()
            .from(applicationDecisions)
            .where(eq(applicationDecisions.applicationId, id)),
        ).toHaveLength(1);
        expect(
          (
            await staff.call(`${route}/decline`, {
              ...key(v.revision),
              humanDecisionConfirmed: true,
              reasonCode: "demo_criteria_not_met",
            })
          ).status,
        ).toBe(409);
        const draft = await fixture();
        await database.db
          .update(applications)
          .set({ status: "draft" })
          .where(eq(applications.id, draft.id));
        await database.db
          .update(applicationSetups)
          .set({ completedAt: null, completedByUserId: null, currentStep: "business_name" })
          .where(eq(applicationSetups.applicationId, draft.id));
        const draftRoute = `${base(draft.id)}/review`;
        const draftView = reviewViewSchema.parse((await user.call(draftRoute)).body);
        expect(draftView.capabilities).toMatchObject({ submit: false, withdraw: true });
        expect((await staff.call(`${draftRoute}/submit`, key(draftView.revision))).status).toBe(
          409,
        );
        const withdrawn = await user.call(`${draftRoute}/withdraw`, {
          ...key(draftView.revision),
          reasonCode: "application_no_longer_needed",
        });
        expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
        expect(reviewViewSchema.parse(withdrawn.body).status).toBe("withdrawn");
      } finally {
        await user.close();
        await staff.close();
      }
    });
  });
