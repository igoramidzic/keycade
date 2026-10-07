import { randomUUID } from "node:crypto";
import { type EnrichmentResult, enrichmentResultSchema } from "@keycade/contracts";
import {
  applications,
  auditEvents,
  type Database,
  enrichmentInputs,
  enrichmentRuns,
  sensitiveIdentifierVersions,
} from "@keycade/db";
import {
  enrichmentPrerequisites,
  enrichmentSubjectActive,
  type IdentifierCipher,
} from "@keycade/domain";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import {
  type EnrichmentProviderRequest,
  identifierScenario,
  invokeEnrichmentProvider,
} from "./enrichment-provider.js";
import { type Clock, ProviderError, systemClock } from "./provider.js";

type Provider = (
  request: EnrichmentProviderRequest,
  options: { clock: Clock; delayMs: number; deadlineMs: number; signal?: AbortSignal },
) => Promise<EnrichmentResult>;
export type EnrichmentJobOptions = {
  clock?: Clock;
  delayMs?: number;
  deadlineMs?: number;
  retryBaseMs?: number;
  signal?: AbortSignal;
  provider?: Provider;
};
const closed = new Set(["withdrawn", "declined", "funded"]);

/** Transactional run rows are durable intent. Claims expire, retries retain history,
 * and current input/authorization is fenced before both invocation and application. */
export async function processEnrichmentRun(
  db: Database,
  cipher: IdentifierCipher,
  operationId: string,
  options: EnrichmentJobOptions = {},
) {
  const clock = options.clock ?? systemClock;
  const deadlineMs = options.deadlineMs ?? 60_000;
  const claimToken = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [hint] = await tx.select().from(enrichmentRuns).where(eq(enrichmentRuns.id, operationId));
    if (!hint) return null;
    // Match command lock order: application -> input -> run -> current grants.
    const [app] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.id, hint.applicationId), eq(applications.bankId, hint.bankId)))
      .for("update");
    const [input] = await tx
      .select()
      .from(enrichmentInputs)
      .where(eq(enrichmentInputs.id, hint.inputId))
      .for("update");
    const [run] = await tx
      .select()
      .from(enrichmentRuns)
      .where(eq(enrichmentRuns.id, operationId))
      .for("update");
    if (!run || !input || !app || run.availableAt > clock.now()) return null;
    if (
      !(
        run.status === "queued" ||
        run.status === "retry_scheduled" ||
        (run.status === "running" && run.leaseUntil && run.leaseUntil <= clock.now())
      )
    )
      return null;
    const stale =
      run.stale || run.inputRevision !== input.revision || run.applicationRevision !== app.revision;
    const active = await enrichmentSubjectActive(tx, input, run.kind);
    if (stale || !app.synthetic || closed.has(app.status) || !active) {
      await tx
        .update(enrichmentRuns)
        .set({
          status: "cancelled",
          stale,
          claimToken: null,
          leaseUntil: null,
          errorCode: stale ? "stale_input" : "no_longer_authorized",
          updatedAt: clock.now(),
        })
        .where(eq(enrichmentRuns.id, operationId));
      return null;
    }
    if (run.attempts >= run.maxAttempts) {
      await tx
        .update(enrichmentRuns)
        .set({
          status: "failed",
          claimToken: null,
          leaseUntil: null,
          errorCode: "attempts_exhausted_after_restart",
          updatedAt: clock.now(),
        })
        .where(eq(enrichmentRuns.id, operationId));
      return null;
    }
    const missing = enrichmentPrerequisites(input, app, run.kind);
    if (missing.length) {
      await tx
        .update(enrichmentRuns)
        .set({
          status: "waiting_for_input",
          missingPrerequisites: missing,
          claimToken: null,
          leaseUntil: null,
          updatedAt: clock.now(),
        })
        .where(eq(enrichmentRuns.id, operationId));
      return null;
    }
    const [identifier] = input.identifierId
      ? await tx
          .select()
          .from(sensitiveIdentifierVersions)
          .where(eq(sensitiveIdentifierVersions.id, input.identifierId))
      : [];
    await tx
      .update(enrichmentRuns)
      .set({
        status: "running",
        attempts: run.attempts + 1,
        claimToken,
        leaseUntil: new Date(clock.now().getTime() + deadlineMs + 30_000),
        updatedAt: clock.now(),
      })
      .where(eq(enrichmentRuns.id, operationId));
    return { run, input, identifier, attempt: run.attempts + 1 };
  });
  if (!claim) return false;
  let result: EnrichmentResult | undefined;
  let failure: ProviderError | undefined;
  try {
    const value = claim.identifier
      ? cipher.decrypt(claim.identifier.encryptedValue, {
          bankId: claim.run.bankId,
          applicationId: claim.run.applicationId,
          subjectKey: claim.input.subjectKey,
          revision: claim.identifier.revision,
        })
      : null;
    const scenario = identifierScenario(value);
    result = enrichmentResultSchema.parse(
      await (options.provider ?? invokeEnrichmentProvider)(
        {
          operationId,
          bankId: claim.run.bankId,
          applicationId: claim.run.applicationId,
          inputRevision: claim.run.inputRevision,
          idempotencyKey: operationId,
          kind: claim.run.kind,
          scenario,
          attempt: claim.attempt,
        },
        {
          clock,
          delayMs: options.delayMs ?? (claim.run.kind === "tax" ? 10_000 : 2500),
          deadlineMs,
          signal: options.signal,
        },
      ),
    );
    if (
      result.operationId !== operationId ||
      result.inputRevision !== claim.run.inputRevision ||
      result.kind !== claim.run.kind
    )
      throw new ProviderError("terminal_error", false);
  } catch (error) {
    failure = options.signal?.aborted
      ? new ProviderError("aborted", true)
      : error instanceof ProviderError
        ? error
        : new ProviderError("terminal_error", false);
  }
  await db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, claim.run.applicationId),
          eq(applications.bankId, claim.run.bankId),
        ),
      )
      .for("update");
    const [input] = await tx
      .select()
      .from(enrichmentInputs)
      .where(eq(enrichmentInputs.id, claim.run.inputId))
      .for("update");
    const [run] = await tx
      .select()
      .from(enrichmentRuns)
      .where(eq(enrichmentRuns.id, operationId))
      .for("update");
    if (
      !app ||
      !input ||
      !run ||
      run.claimToken !== claimToken ||
      run.status !== "running" ||
      !run.leaseUntil ||
      run.leaseUntil <= clock.now()
    )
      return;
    const stale =
      run.stale || run.inputRevision !== input.revision || run.applicationRevision !== app.revision;
    if (
      stale ||
      !app.synthetic ||
      closed.has(app.status) ||
      !(await enrichmentSubjectActive(tx, input, run.kind))
    ) {
      await tx
        .update(enrichmentRuns)
        .set({
          status: "cancelled",
          stale,
          claimToken: null,
          leaseUntil: null,
          errorCode: stale ? "stale_input" : "no_longer_authorized",
          updatedAt: clock.now(),
        })
        .where(eq(enrichmentRuns.id, operationId));
      return;
    }
    if (failure) {
      if (failure.code === "aborted") {
        await tx
          .update(enrichmentRuns)
          .set({ leaseUntil: clock.now(), updatedAt: clock.now() })
          .where(eq(enrichmentRuns.id, operationId));
        return;
      }
      const retry = failure.retryable && run.attempts < run.maxAttempts;
      await tx
        .update(enrichmentRuns)
        .set({
          status: retry
            ? "retry_scheduled"
            : failure.code === "deadline_exceeded"
              ? "timed_out"
              : "failed",
          claimToken: null,
          leaseUntil: null,
          errorCode: failure.code,
          availableAt: new Date(
            clock.now().getTime() + (options.retryBaseMs ?? 1000) * 2 ** (run.attempts - 1),
          ),
          updatedAt: clock.now(),
        })
        .where(eq(enrichmentRuns.id, operationId));
      return;
    }
    if (!result) throw new Error("No safe enrichment result was produced.");
    await tx
      .update(enrichmentRuns)
      .set({
        status: result.outcome === "waiting_for_input" ? "waiting_for_input" : "succeeded",
        result,
        claimToken: null,
        leaseUntil: null,
        errorCode: null,
        updatedAt: clock.now(),
      })
      .where(eq(enrichmentRuns.id, operationId));
    await tx.insert(auditEvents).values({
      bankId: run.bankId,
      applicationId: run.applicationId,
      actorType: "system",
      action: "enrichment.completed",
      targetType: "enrichment_run",
      targetId: run.id,
      requestId: run.requestId,
      metadata: {
        simulated: true,
        provider: result.provider,
        kind: result.kind,
        outcome: result.outcome,
      },
      createdAt: clock.now(),
    });
  });
  return true;
}

export async function processEnrichmentJobs(
  db: Database,
  cipher: IdentifierCipher,
  options: EnrichmentJobOptions = {},
) {
  const clock = options.clock ?? systemClock;
  const pending = await db
    .select({ id: enrichmentRuns.id })
    .from(enrichmentRuns)
    .where(
      and(
        lte(enrichmentRuns.availableAt, clock.now()),
        or(
          inArray(enrichmentRuns.status, ["queued", "retry_scheduled"]),
          and(eq(enrichmentRuns.status, "running"), lte(enrichmentRuns.leaseUntil, clock.now())),
        ),
      ),
    )
    .orderBy(enrichmentRuns.availableAt)
    .limit(5);
  for (const run of pending) {
    if (options.signal?.aborted) break;
    await processEnrichmentRun(db, cipher, run.id, options);
  }
  return pending.length;
}
