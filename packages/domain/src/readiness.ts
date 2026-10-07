import { type ReadinessBlocker, readinessViewSchema, type TaskStage } from "@keycade/contracts";
import {
  applicationChecks,
  applicationParticipants,
  applicationSetups,
  applications,
  applicationTasks,
  businessRelationships,
  checkResolutions,
  checkRuns,
  type Database,
  type DatabaseTransaction,
  documents,
  documentVersions,
  loanProducts,
  taskReviews,
  users,
} from "@keycade/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  type Actor,
  type ApplicationAccess,
  requireApplicantPortalAccess,
} from "./authorization.js";
import { checkIsVisible, checkPasses, currentCheckInputs, lockCheckApplication } from "./checks.js";
import { deny } from "./errors.js";
import { signatureTaskEvidenceCurrent } from "./signatures.js";
import { taskPasses, taskStages } from "./task-rules.js";
import { reconcileTasks, taskIsVisible } from "./tasks.js";

type Tx = DatabaseTransaction;
type App = typeof applications.$inferSelect;
/** Authoritative requirement gates, intended for a caller holding the application lock.
 * T19/T20 additionally enforce the command actor, immutable decisions/terms and funding transition. */
export async function evaluateReadiness(
  tx: Tx,
  app: App,
  visibility?: { actor: Actor; access: ApplicationAccess },
) {
  const blockers: ReadinessBlocker[] = [];
  const add = (
    kind: ReadinessBlocker["kind"],
    id: string | null,
    stage: TaskStage,
    title: string,
    reason: string,
  ) => blockers.push({ kind, id, stage, title, reason });
  const [setup] = await tx
    .select()
    .from(applicationSetups)
    .where(
      and(eq(applicationSetups.bankId, app.bankId), eq(applicationSetups.applicationId, app.id)),
    );
  const [product] = app.productId
    ? await tx
        .select()
        .from(loanProducts)
        .where(and(eq(loanProducts.bankId, app.bankId), eq(loanProducts.id, app.productId)))
    : [];
  if (!setup?.completedAt)
    add("setup", null, "submission", "Complete initial setup", "initial_setup_incomplete");
  const amount = app.requestedAmount ? BigInt(app.requestedAmount.replace(".", "")) : 0n;
  if (
    !app.businessId ||
    !app.businessName?.trim() ||
    !product ||
    amount < BigInt(product.minimumAmount.replace(".", "")) ||
    amount > BigInt(product.maximumAmount.replace(".", ""))
  )
    add(
      "application",
      null,
      "submission",
      "Complete business and loan details",
      "initial_fields_invalid",
    );
  const verified = await tx
    .select({ id: applicationParticipants.id, verified: users.emailVerifiedAt })
    .from(applicationParticipants)
    .innerJoin(users, eq(users.id, applicationParticipants.userId))
    .where(
      and(
        eq(applicationParticipants.bankId, app.bankId),
        eq(applicationParticipants.applicationId, app.id),
        eq(applicationParticipants.role, "applicant_admin"),
        eq(applicationParticipants.scope, "full"),
        isNull(applicationParticipants.revokedAt),
      ),
    );
  if (!verified.some((p) => !!p.verified))
    add(
      "application",
      null,
      "submission",
      "Confirm applicant authority",
      "verified_applicant_authority_required",
    );
  const tasks = await tx
    .select()
    .from(applicationTasks)
    .where(
      and(eq(applicationTasks.bankId, app.bankId), eq(applicationTasks.applicationId, app.id)),
    );
  const evidence = await tx
    .select({
      taskId: documents.taskId,
      uploadState: documentVersions.uploadState,
      scanState: documentVersions.scanState,
    })
    .from(documents)
    .leftJoin(
      documentVersions,
      and(
        eq(documentVersions.documentId, documents.id),
        eq(documentVersions.version, documents.currentVersion),
      ),
    )
    .where(and(eq(documents.bankId, app.bankId), eq(documents.applicationId, app.id)));
  const waivers = await tx
    .select()
    .from(taskReviews)
    .where(
      and(
        eq(taskReviews.bankId, app.bankId),
        eq(taskReviews.applicationId, app.id),
        eq(taskReviews.decision, "waived"),
      ),
    );
  for (const task of tasks) {
    if (
      task.state === "cancelled" ||
      !task.required ||
      (visibility && !taskIsVisible(visibility.actor, visibility.access, task))
    )
      continue;
    const clean = evidence
      .filter((e) => e.taskId === task.id)
      .every((e) => e.uploadState === "uploaded" && e.scanState === "clean");
    const signatureCurrent = taskPasses(task) && (await signatureTaskEvidenceCurrent(tx, task.id));
    const waiverCurrent =
      task.state !== "waived" ||
      waivers.some(
        (review) =>
          review.taskId === task.id &&
          review.taskRevision === task.revision &&
          review.reason.trim().length > 0,
      );
    if (
      !taskPasses(task) ||
      !waiverCurrent ||
      !signatureCurrent ||
      (task.state !== "waived" && !clean)
    )
      add(
        "task",
        task.id,
        task.stage,
        task.title,
        !waiverCurrent
          ? "waiver_not_current"
          : !signatureCurrent && taskPasses(task)
            ? "signature_evidence_not_current"
            : !clean
              ? "current_document_not_ready"
              : task.state === "completed"
                ? "current_evidence_not_reviewed"
                : "requirement_unfinished",
      );
  }
  const checks = await tx
    .select()
    .from(applicationChecks)
    .where(
      and(
        eq(applicationChecks.bankId, app.bankId),
        eq(applicationChecks.applicationId, app.id),
        eq(applicationChecks.active, true),
      ),
    );
  if (!checks.some((check) => check.kind === "fraud"))
    add("check", null, "approval", "Initialize required checks", "required_check_missing");
  const owners = await tx
    .select()
    .from(businessRelationships)
    .where(
      and(
        eq(businessRelationships.bankId, app.bankId),
        eq(businessRelationships.applicationId, app.id),
        eq(businessRelationships.kind, "owner"),
        isNull(businessRelationships.removedAt),
      ),
    );
  for (const owner of owners)
    if (
      (!visibility ||
        (visibility.actor.kind === "user" && visibility.actor.userId === owner.userId)) &&
      !checks.some(
        (check) =>
          check.kind === "identity" &&
          check.subjectRelationshipId === owner.id &&
          check.subjectUserId === owner.userId,
      )
    )
      add(
        "check",
        null,
        "approval",
        "Initialize required owner identity check",
        "required_check_missing",
      );
  for (const check of checks) {
    if (
      !check.required ||
      (visibility && !checkIsVisible(visibility.actor, visibility.access, check))
    )
      continue;
    const inputs = await currentCheckInputs(tx, app, check);
    const [current] = await tx
      .select({ run: checkRuns, resolution: checkResolutions })
      .from(checkRuns)
      .leftJoin(checkResolutions, eq(checkResolutions.runId, checkRuns.id))
      .where(
        and(
          eq(checkRuns.checkId, check.id),
          eq(checkRuns.fingerprint, inputs.fingerprint),
          eq(checkRuns.stale, false),
        ),
      );
    if (!checkPasses(check, current?.run, !!current?.resolution))
      add(
        "check",
        check.id,
        check.stage,
        check.kind === "fraud"
          ? "Simulated business fraud check"
          : `Simulated owner identity check — ${inputs.subjectDisplayName ?? "owner"}`,
        current?.run.status === "succeeded"
          ? `check_${current.run.result?.outcome ?? "unknown"}`
          : current
            ? `check_${current.run.status}`
            : "check_stale_or_missing",
      );
  }
  const gates = taskStages.map((stage) => ({
    stage,
    ready: false,
    blockers: blockers.filter(
      (blocker) => taskStages.indexOf(blocker.stage) <= taskStages.indexOf(stage),
    ),
  }));
  for (const gate of gates) {
    const eligible =
      gate.stage === "submission"
        ? ["collecting_information", "needs_information"].includes(app.status)
        : gate.stage === "approval"
          ? app.status === "in_review"
          : app.status === "closing";
    if (!eligible)
      gate.blockers.push({
        kind: "lifecycle",
        id: null,
        stage: gate.stage,
        title:
          gate.stage === "approval"
            ? "Staff review required"
            : gate.stage === "closing"
              ? "Approved closing required"
              : "Application must be collecting information",
        reason: "lifecycle_not_ready",
      });
    gate.ready = !gate.blockers.length;
  }
  return readinessViewSchema.parse({
    applicationId: app.id,
    simulated: true,
    scope: visibility ? "assigned" : "application",
    gates,
  });
}
export function createReadinessService(
  db: Pick<Database, "transaction">,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  return {
    async read(actor: Actor, bankId: string, applicationId: string) {
      return db.transaction(async (tx) => {
        const app = await lockCheckApplication(tx, bankId, applicationId);
        const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
        if (actor.kind !== "user" || !app.synthetic) return deny();
        await reconcileTasks(tx, bankId, applicationId, "readiness-read", clock());
        return evaluateReadiness(tx, app, access.kind === "staff" ? undefined : { actor, access });
      });
    },
  };
}
export type ReadinessService = ReturnType<typeof createReadinessService>;
