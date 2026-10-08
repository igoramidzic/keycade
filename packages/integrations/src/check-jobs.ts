import { randomUUID } from "node:crypto";
import { type CheckResult, checkResultSchema } from "@keycade/contracts";
import {
  applicationChecks,
  applications,
  auditEvents,
  checkRuns,
  type Database,
  sensitiveIdentifierVersions,
} from "@keycade/db";
import {
  checksMayExecute,
  currentCheckInputs,
  type IdentifierCipher,
  reconcileChecks,
} from "@keycade/domain";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import {
  type CheckProviderRequest,
  evaluateFootprint,
  invokeCheckProvider,
} from "./check-provider.js";
import { identifierScenario } from "./enrichment-provider.js";
import { type Clock, ProviderError, systemClock } from "./provider.js";

export type CheckJobOptions = {
  clock?: Clock;
  delayMs?: number;
  deadlineMs?: number;
  retryBaseMs?: number;
  signal?: AbortSignal;
  provider?: (
    request: CheckProviderRequest,
    options: { clock: Clock; delayMs: number; deadlineMs: number; signal?: AbortSignal },
  ) => Promise<CheckResult>;
};
export async function processCheckRun(
  db: Database,
  cipher: IdentifierCipher,
  operationId: string,
  options: CheckJobOptions = {},
) {
  const clock = options.clock ?? systemClock;
  const deadlineMs = options.deadlineMs ?? 60_000;
  const claimToken = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [hint] = await tx.select().from(checkRuns).where(eq(checkRuns.id, operationId));
    if (!hint) return null;
    const [app] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.bankId, hint.bankId), eq(applications.id, hint.applicationId)))
      .for("update");
    const [check] = await tx
      .select()
      .from(applicationChecks)
      .where(eq(applicationChecks.id, hint.checkId))
      .for("update");
    const [run] = await tx
      .select()
      .from(checkRuns)
      .where(eq(checkRuns.id, operationId))
      .for("update");
    if (
      !app ||
      !check ||
      !run ||
      run.availableAt > clock.now() ||
      !(
        run.status === "queued" ||
        run.status === "retry_scheduled" ||
        (run.status === "running" && run.leaseUntil && run.leaseUntil <= clock.now())
      )
    )
      return null;
    const inputs = await currentCheckInputs(tx, app, check);
    const stale = run.stale || run.fingerprint !== inputs.fingerprint;
    if (
      stale ||
      !check.active ||
      !app.synthetic ||
      (check.kind !== "loan_footprint" && !checksMayExecute(app.status)) ||
      !inputs.subjectActive
    ) {
      await tx
        .update(checkRuns)
        .set({
          status: "cancelled",
          stale,
          claimToken: null,
          leaseUntil: null,
          errorCode: stale ? "stale_input" : "no_longer_authorized",
          updatedAt: clock.now(),
        })
        .where(eq(checkRuns.id, operationId));
      return null;
    }
    if (inputs.missing.length) {
      await tx
        .update(checkRuns)
        .set({
          status: "waiting_for_input",
          missingPrerequisites: inputs.missing,
          claimToken: null,
          leaseUntil: null,
          updatedAt: clock.now(),
        })
        .where(eq(checkRuns.id, operationId));
      return null;
    }
    if (run.attempts >= run.maxAttempts) {
      await tx
        .update(checkRuns)
        .set({
          status: "failed",
          claimToken: null,
          leaseUntil: null,
          errorCode: "attempts_exhausted_after_restart",
          updatedAt: clock.now(),
        })
        .where(eq(checkRuns.id, operationId));
      return null;
    }
    const [identifier] = inputs.identifierId
      ? await tx
          .select()
          .from(sensitiveIdentifierVersions)
          .where(
            and(
              eq(sensitiveIdentifierVersions.id, inputs.identifierId),
              eq(sensitiveIdentifierVersions.bankId, app.bankId),
              eq(sensitiveIdentifierVersions.applicationId, app.id),
              eq(sensitiveIdentifierVersions.subjectKey, inputs.subjectKey),
            ),
          )
      : [];
    if (!identifier && check.kind !== "loan_footprint") return null;
    await tx
      .update(checkRuns)
      .set({
        status: "running",
        attempts: run.attempts + 1,
        claimToken,
        leaseUntil: new Date(clock.now().getTime() + deadlineMs + 30_000),
        updatedAt: clock.now(),
      })
      .where(eq(checkRuns.id, operationId));
    return {
      app,
      check,
      run,
      identifier,
      footprintInput: inputs.footprintInput,
      attempt: run.attempts + 1,
    };
  });
  if (!claim) return false;
  let result: CheckResult | undefined;
  let failure: ProviderError | undefined;
  try {
    const identifier = claim.identifier
      ? cipher.decrypt(claim.identifier.encryptedValue, {
          bankId: claim.run.bankId,
          applicationId: claim.run.applicationId,
          subjectKey: claim.run.subjectKey,
          revision: claim.identifier.revision,
        })
      : null;
    result = checkResultSchema.parse(
      await (options.provider ?? invokeCheckProvider)(
        {
          operationId,
          bankId: claim.run.bankId,
          applicationId: claim.run.applicationId,
          fingerprint: claim.run.fingerprint,
          idempotencyKey: operationId,
          kind: claim.check.kind,
          scenario: identifier ? identifierScenario(identifier) : "success",
          footprintInput: claim.footprintInput,
          attempt: claim.attempt,
        },
        { clock, delayMs: options.delayMs ?? 5_000, deadlineMs, signal: options.signal },
      ),
    );
    if (
      result.operationId !== operationId ||
      result.fingerprint !== claim.run.fingerprint ||
      result.kind !== claim.check.kind ||
      (claim.check.kind === "loan_footprint" &&
        (!claim.footprintInput ||
          JSON.stringify(result.footprint) !==
            JSON.stringify(evaluateFootprint(claim.footprintInput))))
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
          eq(applications.bankId, claim.run.bankId),
          eq(applications.id, claim.run.applicationId),
        ),
      )
      .for("update");
    const [check] = await tx
      .select()
      .from(applicationChecks)
      .where(eq(applicationChecks.id, claim.run.checkId))
      .for("update");
    const [run] = await tx
      .select()
      .from(checkRuns)
      .where(eq(checkRuns.id, operationId))
      .for("update");
    if (
      !app ||
      !check ||
      !run ||
      run.claimToken !== claimToken ||
      run.status !== "running" ||
      !run.leaseUntil ||
      run.leaseUntil <= clock.now()
    )
      return;
    const inputs = await currentCheckInputs(tx, app, check);
    const stale = run.stale || run.fingerprint !== inputs.fingerprint;
    if (
      stale ||
      !check.active ||
      (check.kind !== "loan_footprint" && !checksMayExecute(app.status)) ||
      !inputs.subjectActive ||
      inputs.missing.length
    ) {
      await tx
        .update(checkRuns)
        .set({
          status: "cancelled",
          stale,
          claimToken: null,
          leaseUntil: null,
          errorCode: stale ? "stale_input" : "no_longer_authorized",
          updatedAt: clock.now(),
        })
        .where(eq(checkRuns.id, operationId));
      return;
    }
    if (failure) {
      if (failure.code === "aborted") {
        await tx
          .update(checkRuns)
          .set({ leaseUntil: clock.now(), updatedAt: clock.now() })
          .where(eq(checkRuns.id, operationId));
        return;
      }
      const retry = failure.retryable && run.attempts < run.maxAttempts;
      await tx
        .update(checkRuns)
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
        .where(eq(checkRuns.id, operationId));
      return;
    }
    if (!result) throw new Error("No safe check result was produced.");
    await tx
      .update(checkRuns)
      .set({
        status: "succeeded",
        result,
        claimToken: null,
        leaseUntil: null,
        errorCode: null,
        updatedAt: clock.now(),
      })
      .where(eq(checkRuns.id, operationId));
    await tx.insert(auditEvents).values({
      bankId: run.bankId,
      applicationId: run.applicationId,
      actorType: "system",
      action: "check.completed",
      targetType: "check_run",
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
/** Reconcile persisted subjects after document/owner changes, including across worker restarts. */
export async function processCheckJobs(
  db: Database,
  cipher: IdentifierCipher,
  options: CheckJobOptions = {},
) {
  const clock = options.clock ?? systemClock;
  const scopes = await db
    .selectDistinct({
      bankId: applicationChecks.bankId,
      applicationId: applicationChecks.applicationId,
    })
    .from(applicationChecks)
    .innerJoin(applications, eq(applications.id, applicationChecks.applicationId))
    .where(
      or(
        eq(applicationChecks.kind, "loan_footprint"),
        inArray(applications.status, [
          "draft",
          "collecting_information",
          "needs_information",
          "submitted",
          "in_review",
        ]),
      ),
    );
  for (const scope of scopes) {
    if (options.signal?.aborted) break;
    await db.transaction((tx) =>
      reconcileChecks(tx, scope.bankId, scope.applicationId, "checks-reconcile", clock.now()),
    );
  }
  const runs = await db
    .select({ id: checkRuns.id })
    .from(checkRuns)
    .where(
      and(
        lte(checkRuns.availableAt, clock.now()),
        or(
          inArray(checkRuns.status, ["queued", "retry_scheduled"]),
          and(eq(checkRuns.status, "running"), lte(checkRuns.leaseUntil, clock.now())),
        ),
      ),
    )
    .orderBy(checkRuns.availableAt, checkRuns.id)
    .limit(5);
  for (const run of runs) {
    if (options.signal?.aborted) break;
    await processCheckRun(db, cipher, run.id, options);
  }
  return runs.length;
}
