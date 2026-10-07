import {
  applicationClosingPackages,
  applicationTasks,
  closingConditions,
  signatureArtifacts,
  signatureEnvelopes,
  taskReviews,
  taskSignaturePolicies,
} from "@keycade/db";
import { and, asc, eq } from "drizzle-orm";
import type { QueryDatabase } from "./authorization.js";
import { DomainError } from "./errors.js";
import { type SignatureEvidenceReader, signatureTaskEvidenceCurrent } from "./signatures.js";
import { taskPasses } from "./task-rules.js";

/** Mandatory signing requirements exist before an envelope is prepared. */
export async function requireNonClosingSignatureTask(db: QueryDatabase, taskId: string) {
  const [condition] = await db
    .select({ kind: closingConditions.kind })
    .from(closingConditions)
    .where(eq(closingConditions.taskId, taskId));
  if (condition?.kind === "signature")
    throw new DomainError(
      "INVALID_STATE",
      409,
      "This closing condition requires its current simulated signature artifact.",
    );
}
export async function readClosingConditions(
  db: QueryDatabase,
  bankId: string,
  applicationId: string,
  signatureEvidenceCurrent: SignatureEvidenceReader = (taskId) =>
    signatureTaskEvidenceCurrent(db, taskId),
) {
  const rows = await db
    .select({
      condition: closingConditions,
      task: applicationTasks,
      policy: taskSignaturePolicies,
      envelope: signatureEnvelopes,
      artifact: signatureArtifacts,
    })
    .from(closingConditions)
    .innerJoin(applicationTasks, eq(applicationTasks.id, closingConditions.taskId))
    .leftJoin(taskSignaturePolicies, eq(taskSignaturePolicies.taskId, closingConditions.taskId))
    .leftJoin(signatureEnvelopes, eq(signatureEnvelopes.id, taskSignaturePolicies.envelopeId))
    .leftJoin(signatureArtifacts, eq(signatureArtifacts.envelopeId, signatureEnvelopes.id))
    .where(
      and(eq(closingConditions.bankId, bankId), eq(closingConditions.applicationId, applicationId)),
    )
    .orderBy(asc(closingConditions.key));
  const conditions = [];
  for (const { condition, task, policy, envelope, artifact } of rows) {
    let passes = taskPasses(task);
    if (condition.kind === "signature")
      passes = !!(
        task.state === "completed" &&
        policy &&
        envelope?.state === "completed" &&
        artifact &&
        artifact.taskId === task.id &&
        artifact.evidenceRevision === task.evidenceRevision &&
        (await signatureEvidenceCurrent(task.id))
      );
    else if (task.state === "waived") {
      const [waiver] = await db
        .select({ id: taskReviews.id })
        .from(taskReviews)
        .where(
          and(
            eq(taskReviews.taskId, task.id),
            eq(taskReviews.taskRevision, task.revision),
            eq(taskReviews.decision, "waived"),
          ),
        );
      passes = !!waiver;
    }
    conditions.push({
      id: condition.id,
      key: condition.key,
      title: condition.title,
      kind: condition.kind,
      required: condition.required,
      taskId: task.id,
      passes,
      signatureEnvelopeId: envelope?.id ?? null,
      signatureState: envelope?.state ?? null,
      artifactId: artifact?.envelopeId ?? null,
      artifactSha256: artifact?.sha256 ?? null,
      evidenceRevision: task.evidenceRevision,
    });
  }
  return conditions;
}
/** Values from the same locked read evaluation, never a previous request or before a write. */
export type ClosingReadContext = {
  signatureEvidenceCurrent?: SignatureEvidenceReader;
  packageExists?: boolean;
  conditions?: Awaited<ReturnType<typeof readClosingConditions>>;
};
export async function closingRequirementBlockers(
  db: QueryDatabase,
  bankId: string,
  applicationId: string,
  context: ClosingReadContext = {},
) {
  let packageExists = context.packageExists;
  if (packageExists === undefined) {
    const [pkg] = await db
      .select({ id: applicationClosingPackages.id })
      .from(applicationClosingPackages)
      .where(
        and(
          eq(applicationClosingPackages.bankId, bankId),
          eq(applicationClosingPackages.applicationId, applicationId),
        ),
      );
    packageExists = !!pkg;
  }
  if (!packageExists)
    return [
      {
        kind: "application" as const,
        id: null,
        stage: "closing" as const,
        title: "Prepare approved closing package",
        reason: "closing_package_missing",
      },
    ];
  const conditions =
    context.conditions ??
    (await readClosingConditions(db, bankId, applicationId, context.signatureEvidenceCurrent));
  return conditions
    .filter((c) => c.required && !c.passes)
    .map((c) => ({
      kind: "task" as const,
      id: c.taskId,
      stage: "closing" as const,
      title: c.title,
      reason:
        c.kind === "signature" ? "closing_signature_not_current" : "closing_condition_unfinished",
    }));
}
