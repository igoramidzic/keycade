import {
  authorizeTaxSchema,
  confirmEnrichmentFactSchema,
  type EnrichmentKind,
  type EnrichmentSubject,
  enrichmentSubjectSchema,
  enrichmentViewSchema,
  requestEnrichmentSchema,
  retryEnrichmentSchema,
  saveIdentifierSchema,
  taxAuthorizationNotice,
  taxAuthorizationNoticeVersion,
} from "@keycade/contracts";
import {
  applicationParticipants,
  applications,
  auditEvents,
  bankMemberships,
  confirmedEnrichmentFacts,
  type Database,
  type DatabaseTransaction,
  enrichmentInputs,
  enrichmentRuns,
  sensitiveIdentifierVersions,
} from "@keycade/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type Actor, requireApplicantPortalAccess } from "./authorization.js";
import { materialInputsEditable, reconcileChecks } from "./checks.js";
import { DomainError, deny } from "./errors.js";
import type { IdentifierCipher } from "./identifier-cipher.js";
import { recordApplicantActivity } from "./notification-intents.js";

type Tx = DatabaseTransaction;
type Input = typeof enrichmentInputs.$inferSelect;
type App = typeof applications.$inferSelect;
type Run = typeof enrichmentRuns.$inferSelect;
const closed = new Set(["funded", "declined", "withdrawn"]);
const unfinished = new Set(["queued", "running", "retry_scheduled", "waiting_for_input"]);
const subjectKey = (subject: EnrichmentSubject) => subject.subjectUserId ?? "business";
function parse<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new DomainError("INVALID_INPUT", 400, "Check the synthetic enrichment input.");
  return parsed.data as T;
}
function conflict(): never {
  throw new DomainError(
    "REVISION_CONFLICT",
    409,
    "Enrichment inputs changed. Reload before saving.",
  );
}
function invalid(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
const scopeWhere = (bankId: string, applicationId: string, key: string) =>
  and(
    eq(enrichmentInputs.bankId, bankId),
    eq(enrichmentInputs.applicationId, applicationId),
    eq(enrichmentInputs.subjectKey, key),
  );

export function enrichmentPrerequisites(
  input: Input,
  app: App,
  kind: EnrichmentKind,
): ("business_name" | "identifier" | "tax_authorization")[] {
  const missing: ("business_name" | "identifier" | "tax_authorization")[] = [];
  if (kind === "business" && !app.businessName) missing.push("business_name");
  if (kind === "tax") {
    if (!input.identifierId) missing.push("identifier");
    if (!input.taxAuthorizedAt || !input.taxAuthorizedByUserId) missing.push("tax_authorization");
  }
  return missing;
}
/** Worker-side authorization is rechecked immediately before a provider effect and its commit. */
export async function enrichmentSubjectActive(
  tx: Tx,
  input: Input,
  kind: EnrichmentKind,
): Promise<boolean> {
  if (input.subjectUserId) {
    const [subject] = await tx
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.bankId, input.bankId),
          eq(applicationParticipants.applicationId, input.applicationId),
          eq(applicationParticipants.userId, input.subjectUserId),
          isNull(applicationParticipants.revokedAt),
        ),
      )
      .for("share");
    if (!subject || !["owner", "applicant_admin"].includes(subject.role)) return false;
  }
  if (kind !== "tax" || !input.taxAuthorizedByUserId) return true;
  const [staff] = await tx
    .select()
    .from(bankMemberships)
    .where(
      and(
        eq(bankMemberships.bankId, input.bankId),
        eq(bankMemberships.userId, input.taxAuthorizedByUserId),
        isNull(bankMemberships.revokedAt),
      ),
    )
    .for("share");
  if (staff) return true;
  const [authorizer] = await tx
    .select()
    .from(applicationParticipants)
    .where(
      and(
        eq(applicationParticipants.bankId, input.bankId),
        eq(applicationParticipants.applicationId, input.applicationId),
        eq(applicationParticipants.userId, input.taxAuthorizedByUserId),
        isNull(applicationParticipants.revokedAt),
      ),
    )
    .for("share");
  return (
    !!authorizer &&
    (input.subjectUserId
      ? authorizer.userId === input.subjectUserId &&
        ["owner", "applicant_admin"].includes(authorizer.role)
      : authorizer.role === "applicant_admin" && authorizer.scope === "full")
  );
}

async function requireScope(tx: Tx, actor: Actor, app: App, subject: EnrichmentSubject) {
  if (actor.kind !== "user") return deny();
  const access = await requireApplicantPortalAccess(tx, actor, app.bankId, app.id);
  if (!app.synthetic) return deny();
  if (subject.subjectUserId) {
    const [target] = await tx
      .select()
      .from(applicationParticipants)
      .where(
        and(
          eq(applicationParticipants.bankId, app.bankId),
          eq(applicationParticipants.applicationId, app.id),
          eq(applicationParticipants.userId, subject.subjectUserId),
          isNull(applicationParticipants.revokedAt),
        ),
      )
      .for("share");
    if (!target || !["owner", "applicant_admin"].includes(target.role)) return deny();
    if (
      access.kind !== "staff" &&
      !(
        access.kind === "participant" &&
        actor.userId === subject.subjectUserId &&
        ["owner", "applicant_admin"].includes(access.role)
      )
    )
      return deny();
  } else if (
    access.kind !== "staff" &&
    !(access.kind === "participant" && access.role === "applicant_admin" && access.scope === "full")
  )
    return deny();
  return { actorUserId: actor.userId, access };
}
async function getApplication(tx: Tx, bankId: string, applicationId: string) {
  const [app] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.bankId, bankId), eq(applications.id, applicationId)))
    .for("update");
  if (!app) return deny();
  return app;
}
async function inputFor(tx: Tx, app: App, subject: EnrichmentSubject, create: boolean) {
  const key = subjectKey(subject);
  let [input] = await tx
    .select()
    .from(enrichmentInputs)
    .where(scopeWhere(app.bankId, app.id, key))
    .for("update");
  if (!input && create)
    [input] = await tx
      .insert(enrichmentInputs)
      .values({
        bankId: app.bankId,
        applicationId: app.id,
        subjectKey: key,
        subjectUserId: subject.subjectUserId ?? null,
      })
      .returning();
  return input;
}
async function audit(
  tx: Tx,
  app: App,
  actorUserId: string,
  action: string,
  targetId: string,
  requestId: string,
  now: Date,
  changedFields: string[] = [],
  reason?: string,
) {
  if (
    [
      "identifier.saved",
      "tax.authorized",
      "tax.authorization_revoked",
      "enrichment.fact_confirmed",
    ].includes(action)
  )
    await recordApplicantActivity(tx, app.bankId, app.id, actorUserId, now);
  await tx.insert(auditEvents).values({
    bankId: app.bankId,
    applicationId: app.id,
    actorType: "user",
    actorUserId,
    action,
    targetType: "enrichment",
    targetId,
    requestId,
    changedFields,
    metadata: { simulated: true, ...(reason ? { reason } : {}) },
    createdAt: now,
  });
}
async function schedule(
  tx: Tx,
  app: App,
  input: Input,
  kind: EnrichmentKind,
  requestId: string,
  now: Date,
) {
  const [existing] = await tx
    .select()
    .from(enrichmentRuns)
    .where(
      and(
        eq(enrichmentRuns.inputId, input.id),
        eq(enrichmentRuns.kind, kind),
        eq(enrichmentRuns.inputRevision, input.revision),
        eq(enrichmentRuns.applicationRevision, app.revision),
      ),
    );
  if (existing) return existing;
  const missing = enrichmentPrerequisites(input, app, kind);
  const [run] = await tx
    .insert(enrichmentRuns)
    .values({
      bankId: app.bankId,
      applicationId: app.id,
      subjectKey: input.subjectKey,
      inputId: input.id,
      kind,
      inputRevision: input.revision,
      applicationRevision: app.revision,
      status: missing.length ? "waiting_for_input" : "queued",
      missingPrerequisites: missing,
      requestId,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!run) throw new Error("Enrichment intent was not stored.");
  return run;
}
async function supersede(tx: Tx, app: App, input: Input, requestId: string, now: Date) {
  const history = await tx
    .select()
    .from(enrichmentRuns)
    .where(eq(enrichmentRuns.inputId, input.id));
  for (const run of history)
    if (!run.stale)
      await tx
        .update(enrichmentRuns)
        .set({
          stale: true,
          status: unfinished.has(run.status) ? "cancelled" : run.status,
          claimToken: null,
          leaseUntil: null,
          errorCode: unfinished.has(run.status) ? "stale_input" : run.errorCode,
          updatedAt: now,
        })
        .where(eq(enrichmentRuns.id, run.id));
  for (const kind of new Set(history.map((run) => run.kind)))
    await schedule(tx, app, input, kind, requestId, now);
}
async function view(tx: Tx, app: App, subject: EnrichmentSubject, input: Input | undefined) {
  const [identifier] = input?.identifierId
    ? await tx
        .select({ maskedValue: sensitiveIdentifierVersions.maskedValue })
        .from(sensitiveIdentifierVersions)
        .where(eq(sensitiveIdentifierVersions.id, input.identifierId))
    : [];
  const runs = input
    ? await tx
        .select()
        .from(enrichmentRuns)
        .where(eq(enrichmentRuns.inputId, input.id))
        .orderBy(desc(enrichmentRuns.createdAt), desc(enrichmentRuns.id))
        .limit(50)
    : [];
  const facts = await tx
    .select({ fact: confirmedEnrichmentFacts, run: enrichmentRuns })
    .from(confirmedEnrichmentFacts)
    .innerJoin(enrichmentRuns, eq(confirmedEnrichmentFacts.runId, enrichmentRuns.id))
    .where(
      and(
        eq(confirmedEnrichmentFacts.bankId, app.bankId),
        eq(confirmedEnrichmentFacts.applicationId, app.id),
        eq(confirmedEnrichmentFacts.subjectKey, subjectKey(subject)),
      ),
    )
    .orderBy(desc(confirmedEnrichmentFacts.confirmedAt));
  const stale = (run: Run) =>
    run.stale || run.inputRevision !== input?.revision || run.applicationRevision !== app.revision;
  return enrichmentViewSchema.parse({
    simulated: true,
    subjectUserId: subject.subjectUserId ?? null,
    revision: input?.revision ?? 0,
    identifier: {
      present: !!input?.identifierId,
      masked: identifier?.maskedValue ?? null,
      revision: input?.identifierRevision ?? 0,
      kind: subject.subjectUserId ? "ssn" : "ein",
    },
    taxAuthorization: {
      authorized: !!input?.taxAuthorizedAt && (await enrichmentSubjectActive(tx, input, "tax")),
      noticeVersion: taxAuthorizationNoticeVersion,
      notice: taxAuthorizationNotice,
    },
    runs: runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      simulated: true,
      inputRevision: run.inputRevision,
      status: run.status,
      stale: stale(run),
      attempts: run.attempts,
      missingPrerequisites: run.missingPrerequisites,
      result: run.result,
      errorCode: run.errorCode,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
    confirmedFacts: facts.map(({ fact, run }) => ({
      key: fact.key,
      value: fact.value,
      runId: fact.runId,
      confirmedAt: fact.confirmedAt.toISOString(),
      stale: stale(run),
    })),
  });
}

export function createEnrichmentService(
  db: Pick<Database, "transaction">,
  options: { cipher: IdentifierCipher; clock?: () => Date },
) {
  const clock = options.clock ?? (() => new Date());
  async function locked(
    tx: Tx,
    actor: Actor,
    bankId: string,
    applicationId: string,
    subject: EnrichmentSubject,
  ) {
    const app = await getApplication(tx, bankId, applicationId);
    const access = await requireScope(tx, actor, app, subject);
    if (closed.has(app.status)) invalid("This application is closed.");
    const input = await inputFor(tx, app, subject, true);
    if (!input) throw new Error("Enrichment inputs were not stored.");
    return { app, input, ...access };
  }
  return {
    async read(actor: Actor, bankId: string, applicationId: string, raw: unknown = {}) {
      const subject = parse(enrichmentSubjectSchema, raw);
      return db.transaction(async (tx) => {
        const app = await getApplication(tx, bankId, applicationId);
        await requireScope(tx, actor, app, subject);
        return view(tx, app, subject, await inputFor(tx, app, subject, false));
      });
    },
    async saveIdentifier(
      actor: Actor,
      bankId: string,
      applicationId: string,
      raw: unknown,
      requestId: string,
    ) {
      const parsed = parse(saveIdentifierSchema, raw);
      return db.transaction(async (tx) => {
        const { app, input, actorUserId } = await locked(tx, actor, bankId, applicationId, parsed);
        if (!materialInputsEditable(app.status))
          invalid("This application is not accepting identifier changes.");
        if (input.revision !== parsed.expectedRevision) return conflict();
        const revision = input.identifierRevision + 1;
        const now = clock();
        const [identifier] = await tx
          .insert(sensitiveIdentifierVersions)
          .values({
            bankId,
            applicationId,
            subjectKey: input.subjectKey,
            revision,
            kind: parsed.subjectUserId ? "ssn" : "ein",
            encryptedValue: options.cipher.encrypt(parsed.value, {
              bankId,
              applicationId,
              subjectKey: input.subjectKey,
              revision,
            }),
            maskedValue: `${parsed.subjectUserId ? "***-**-" : "**-***"}${parsed.value.slice(-4)}`,
            createdByUserId: actorUserId,
            createdAt: now,
          })
          .returning({ id: sensitiveIdentifierVersions.id });
        if (!identifier) throw new Error("Identifier was not stored.");
        const [next] = await tx
          .update(enrichmentInputs)
          .set({
            revision: input.revision + 1,
            identifierId: identifier.id,
            identifierRevision: revision,
            taxAuthorizedAt: null,
            taxAuthorizedByUserId: null,
            taxNoticeVersion: null,
            updatedAt: now,
          })
          .where(eq(enrichmentInputs.id, input.id))
          .returning();
        if (!next) throw new Error("Input revision was not stored.");
        await supersede(tx, app, next, requestId, now);
        await reconcileChecks(tx, bankId, applicationId, requestId, now);
        await audit(tx, app, actorUserId, "identifier.saved", identifier.id, requestId, now, [
          "identifier",
          "taxAuthorization",
        ]);
        return view(tx, app, parsed, next);
      });
    },
    async authorizeTax(
      actor: Actor,
      bankId: string,
      applicationId: string,
      raw: unknown,
      requestId: string,
    ) {
      const parsed = parse(authorizeTaxSchema, raw);
      return db.transaction(async (tx) => {
        const { app, input, actorUserId } = await locked(tx, actor, bankId, applicationId, parsed);
        if (!materialInputsEditable(app.status))
          invalid("This application is not accepting authorization changes.");
        if (input.revision !== parsed.expectedRevision) return conflict();
        if (parsed.authorized && !input.identifierId)
          invalid("Add a synthetic identifier before authorizing sample tax records.");
        const now = clock();
        const [next] = await tx
          .update(enrichmentInputs)
          .set({
            revision: input.revision + 1,
            taxAuthorizedAt: parsed.authorized ? now : null,
            taxAuthorizedByUserId: parsed.authorized ? actorUserId : null,
            taxNoticeVersion: parsed.authorized ? parsed.noticeVersion : null,
            updatedAt: now,
          })
          .where(eq(enrichmentInputs.id, input.id))
          .returning();
        if (!next) throw new Error("Authorization was not stored.");
        await supersede(tx, app, next, requestId, now);
        await reconcileChecks(tx, bankId, applicationId, requestId, now);
        await audit(
          tx,
          app,
          actorUserId,
          parsed.authorized ? "tax.authorized" : "tax.authorization_revoked",
          input.id,
          requestId,
          now,
          ["taxAuthorization"],
        );
        return view(tx, app, parsed, next);
      });
    },
    async requestRun(
      actor: Actor,
      bankId: string,
      applicationId: string,
      raw: unknown,
      requestId: string,
    ) {
      const parsed = parse(requestEnrichmentSchema, raw);
      return db.transaction(async (tx) => {
        const { app, input, actorUserId } = await locked(tx, actor, bankId, applicationId, parsed);
        if (input.revision !== parsed.expectedRevision) return conflict();
        if (parsed.kind === "business" && parsed.subjectUserId)
          invalid("Business enrichment applies to the business only.");
        const run = await schedule(tx, app, input, parsed.kind, requestId, clock());
        await audit(tx, app, actorUserId, "enrichment.requested", run.id, requestId, clock());
        return view(tx, app, parsed, input);
      });
    },
    async retry(
      actor: Actor,
      bankId: string,
      applicationId: string,
      runId: string,
      raw: unknown,
      requestId: string,
    ) {
      const parsed = parse(retryEnrichmentSchema, raw);
      return db.transaction(async (tx) => {
        const app = await getApplication(tx, bankId, applicationId);
        const [run] = await tx
          .select()
          .from(enrichmentRuns)
          .where(
            and(
              eq(enrichmentRuns.id, runId),
              eq(enrichmentRuns.bankId, bankId),
              eq(enrichmentRuns.applicationId, applicationId),
            ),
          );
        if (!run) return deny();
        const subject = run.subjectKey === "business" ? {} : { subjectUserId: run.subjectKey };
        const { actorUserId, access } = await requireScope(tx, actor, app, subject);
        if (access.kind !== "staff") return deny();
        const input = await inputFor(tx, app, subject, false);
        if (
          !input ||
          run.stale ||
          run.inputRevision !== input.revision ||
          run.applicationRevision !== app.revision ||
          !["failed", "timed_out"].includes(run.status) ||
          run.attempts >= 28 ||
          closed.has(app.status)
        )
          invalid("This enrichment request cannot be retried. Request current inputs instead.");
        await tx
          .update(enrichmentRuns)
          .set({
            status: "queued",
            maxAttempts: run.attempts + 3,
            availableAt: clock(),
            claimToken: null,
            leaseUntil: null,
            errorCode: null,
            updatedAt: clock(),
          })
          .where(eq(enrichmentRuns.id, runId));
        await audit(
          tx,
          app,
          actorUserId,
          "enrichment.retried",
          runId,
          requestId,
          clock(),
          [],
          parsed.reason,
        );
        return view(tx, app, subject, input);
      });
    },
    async confirmFact(
      actor: Actor,
      bankId: string,
      applicationId: string,
      raw: unknown,
      requestId: string,
    ) {
      const parsed = parse(confirmEnrichmentFactSchema, raw);
      return db.transaction(async (tx) => {
        const { app, input, actorUserId } = await locked(tx, actor, bankId, applicationId, parsed);
        if (!materialInputsEditable(app.status))
          invalid("This application is not accepting fact changes.");
        if (input.revision !== parsed.expectedRevision) return conflict();
        const [run] = await tx
          .select()
          .from(enrichmentRuns)
          .where(and(eq(enrichmentRuns.id, parsed.runId), eq(enrichmentRuns.inputId, input.id)));
        if (!run) return deny();
        if (
          run.stale ||
          run.inputRevision !== input.revision ||
          run.applicationRevision !== app.revision ||
          run.status !== "succeeded"
        )
          invalid("Only current suggestions can be confirmed.");
        const fact = run.result?.suggestions.find((item) => item.key === parsed.key);
        if (!fact) invalid("This result has no such suggestion.");
        const inserted = await tx
          .insert(confirmedEnrichmentFacts)
          .values({
            bankId,
            applicationId,
            subjectKey: input.subjectKey,
            runId: run.id,
            key: fact.key,
            value: fact.value,
            confirmedByUserId: actorUserId,
            confirmedAt: clock(),
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length)
          await audit(
            tx,
            app,
            actorUserId,
            "enrichment.fact_confirmed",
            run.id,
            requestId,
            clock(),
            [fact.key],
          );
        return view(tx, app, parsed, input);
      });
    },
  };
}
