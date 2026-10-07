import { randomUUID } from "node:crypto";
import {
  closingViewSchema,
  fundedAccountsViewSchema,
  signaturesViewSchema,
  tasksViewSchema,
} from "@keycade/contracts";
import {
  applicationParticipants,
  applicationSetups,
  applications,
  documentVersions,
  fundingRecords,
  loanAccounts,
  signatureArtifacts,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import {
  type Actor,
  createChecksService,
  createDocumentsService,
  createIdentifierCipher,
  createReviewService,
  createTasksService,
} from "@keycade/domain";
import { processCheckRun } from "@keycade/integrations/check-jobs";
import { processSignatureJobs } from "@keycade/integrations/signatures-jobs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { handleWorkerRequest } from "../src/worker-handler.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const encryptionKey = "19".repeat(32),
  origin = "http://localhost:3001",
  csrf = "synthetic-closing-csrf-0123456789012345";
const borrower: Actor = { kind: "user", userId: ids.borrower },
  officer: Actor = { kind: "user", userId: ids.officerA };
const base = (id: string) => `/api/v1/banks/${ids.bankA}/applications/${id}`;
const command = (expectedRevision: number) => ({ expectedRevision, idempotencyKey: randomUUID() });
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30000);
afterAll(async () => database?.cleanup());
async function approvedFixture() {
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
  const tasks = createTasksService(database.db),
    checks = createChecksService(database.db, { cipher: createIdentifierCipher(encryptionKey) }),
    review = createReviewService(database.db);
  for (const t of (await tasks.read(officer, ids.bankA, id)).tasks.filter(
    (t) => t.required && t.stage !== "closing" && t.inputKind === "answer",
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
    await processCheckRun(database.db, createIdentifierCipher(encryptionKey), c.currentRunId!, {
      delayMs: 0,
      deadlineMs: 1000,
    });
  let v = await review.read(officer, ids.bankA, id);
  v = await review.submit(borrower, ids.bankA, id, command(v.revision), randomUUID());
  v = await review.startReview(officer, ids.bankA, id, command(v.revision), randomUUID());
  v = await review.approve(
    officer,
    ids.bankA,
    id,
    {
      ...command(v.revision),
      humanDecisionConfirmed: true,
      reasonCode: "demo_criteria_met",
      approvedAmount: "10000.00",
    },
    randomUUID(),
  );
  return { id, revision: v.revision, participant: participant! };
}
for (const transport of ["fastify", "worker"] as const)
  describe(`${transport} closing and funded accounts`, () => {
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
    it("records one current signed simulated funding via guarded routes and returns the scoped account", async () => {
      const f = await approvedFixture(),
        staff = await client(ids.officerA),
        user = await client(),
        outside = await client(ids.officerB),
        anonymous = await client(null);
      const route = `${base(f.id)}/closing`,
        accounts = `/api/v1/banks/${ids.bankA}/accounts`;
      try {
        let view = closingViewSchema.parse((await staff.call(route)).body);
        expect(view).toMatchObject({
          status: "approved",
          account: null,
          capabilities: { startClosing: true, recordFunding: false },
        });
        expect((await outside.call(route)).status).toBe(404);
        expect((await anonymous.call(route)).status).toBe(404);
        expect((await staff.call(route.replace(ids.bankA, ids.bankB))).status).toBe(404);
        expect((await user.call(`${route}/start`, command(view.revision))).status).toBe(404);
        expect((await staff.call(`${route}/start`, '{"broken":')).status).toBe(400);
        const start = command(view.revision);
        expect((await staff.call(`${route}/start`, start, { origin: null })).status).toBe(403);
        expect(
          (await staff.call(`${route}/start`, start, { "x-csrf-token": "wrong" })).status,
        ).toBe(403);
        const started = await staff.call(`${route}/start`, start);
        expect(started.status, JSON.stringify(started.body)).toBe(200);
        view = closingViewSchema.parse(started.body);
        expect(view.status).toBe("closing");
        expect((await staff.call(`${route}/start`, start)).status).toBe(200);
        expect((await staff.call(`${route}/start`, command(f.revision))).status).toBe(409);
        const signature = view.conditions.find((c) => c.kind === "signature")!;
        let tasks = tasksViewSchema.parse((await staff.call(`${base(f.id)}/tasks`)).body);
        const signatureTask = tasks.tasks.find((t) => t.id === signature.taskId)!;
        expect(signatureTask).toMatchObject({
          inputKind: "signature",
          signatureEnvelopeId: null,
          canEdit: false,
          canSubmit: false,
          canReview: false,
        });
        expect(
          (
            await staff.call(`${base(f.id)}/tasks/${signatureTask.id}/waive`, {
              expectedRevision: signatureTask.revision,
              reason: "Cannot bypass mandatory closing signature",
            })
          ).status,
        ).toBe(409);
        const fund = {
          ...command(view.revision),
          humanFundingConfirmed: true,
          fundedAmount: "10000.00",
          fundedOn: new Date().toISOString().slice(0, 10),
          reference: "DEMO-HTTP-FUNDING",
        };
        expect((await staff.call(`${route}/fund`, fund)).status).toBe(409);
        const acknowledgement = tasks.tasks.find(
          (t) => t.id === view.conditions.find((c) => c.kind === "task")?.taskId,
        )!;
        expect(
          (
            await staff.call(`${base(f.id)}/tasks/${acknowledgement.id}/waive`, {
              expectedRevision: acknowledgement.revision,
              reason: "Staff confirmed simulated funding notice",
            })
          ).status,
        ).toBe(200);
        const docs = createDocumentsService(database.db),
          source = await docs.beginUpload(
            officer,
            ids.bankA,
            f.id,
            {
              taskId: signature.taskId,
              fileName: "Synthetic HTTP closing.pdf",
              mimeType: "application/pdf",
              expectedSize: 100,
              idempotencyKey: randomUUID(),
            },
            randomUUID(),
          );
        await docs.finalizeUpload(
          officer,
          ids.bankA,
          f.id,
          source.uploadId,
          { size: 100, sha256: "a".repeat(64) },
          randomUUID(),
        );
        await database.db
          .update(documentVersions)
          .set({ scanState: "clean", scannedAt: new Date() })
          .where(eq(documentVersions.id, source.versionId));
        const created = await staff.call(`${base(f.id)}/signatures`, {
          taskId: signature.taskId,
          sourceVersionId: source.versionId,
          signerParticipantIds: [f.participant.id],
          idempotencyKey: randomUUID(),
        });
        expect(created.status, JSON.stringify(created.body)).toBe(200);
        const envelope = signaturesViewSchema
          .parse(created.body)
          .envelopes.find((e) => e.taskId === signature.taskId)!;
        expect((await staff.call(`${base(f.id)}/signatures/${envelope.id}/send`, {})).status).toBe(
          200,
        );
        await processSignatureJobs(database.db, { delayMs: 0 });
        const signed = await user.call(`${base(f.id)}/signatures/${envelope.id}/act`, {
          action: "sign",
        });
        expect(signed.status, JSON.stringify(signed.body)).toBe(200);
        expect(
          await database.db
            .select()
            .from(signatureArtifacts)
            .where(eq(signatureArtifacts.envelopeId, envelope.id)),
        ).toHaveLength(1);
        view = closingViewSchema.parse((await staff.call(route)).body);
        expect(view.capabilities.recordFunding).toBe(true);
        expect((await user.call(`${route}/fund`, fund)).status).toBe(404);
        expect((await outside.call(`${route}/fund`, fund)).status).toBe(404);
        expect(
          (await staff.call(`${route}/fund`, { ...fund, humanFundingConfirmed: false })).status,
        ).toBe(400);
        expect(
          (await staff.call(`${route}/fund`, { ...fund, fundedAmount: "9999.99" })).status,
        ).toBe(409);
        expect((await staff.call(`${route}/fund`, fund, { "x-csrf-token": null })).status).toBe(
          403,
        );
        const funded = await staff.call(`${route}/fund`, fund);
        expect(funded.status, JSON.stringify(funded.body)).toBe(200);
        view = closingViewSchema.parse(funded.body);
        expect(view).toMatchObject({
          status: "funded",
          account: {
            simulated: true,
            approvedAmount: "10000.00",
            fundedAmount: "10000.00",
            reference: "DEMO-HTTP-FUNDING",
          },
        });
        expect(
          closingViewSchema.parse((await staff.call(`${route}/fund`, fund)).body).account?.id,
        ).toBe(view.account?.id);
        expect((await staff.call(`${route}/fund`, { ...fund, reference: "changed" })).status).toBe(
          409,
        );
        expect(
          await database.db
            .select()
            .from(fundingRecords)
            .where(eq(fundingRecords.applicationId, f.id)),
        ).toHaveLength(1);
        expect(
          await database.db.select().from(loanAccounts).where(eq(loanAccounts.applicationId, f.id)),
        ).toHaveLength(1);
        expect(
          fundedAccountsViewSchema
            .parse((await user.call(accounts)).body)
            .accounts.find((a) => a.applicationId === f.id),
        ).toEqual(view.account);
        expect(
          fundedAccountsViewSchema.parse((await outside.call(accounts)).body).accounts,
        ).toEqual([]);
        expect((await anonymous.call(accounts)).status).toBe(404);
        await database.db
          .update(applicationParticipants)
          .set({ scope: "assigned", role: "adviser", taskIds: [signature.taskId] })
          .where(eq(applicationParticipants.id, f.participant.id));
        expect((await user.call(route)).status).toBe(404);
        expect(
          fundedAccountsViewSchema
            .parse((await user.call(accounts)).body)
            .accounts.some((a) => a.applicationId === f.id),
        ).toBe(false);
        tasks = tasksViewSchema.parse((await staff.call(`${base(f.id)}/tasks`)).body);
        expect(tasks.tasks.find((t) => t.id === signature.taskId)?.state).toBe("completed");
      } finally {
        await user.close();
        await staff.close();
        await outside.close();
        await anonymous.close();
      }
    });
  });
