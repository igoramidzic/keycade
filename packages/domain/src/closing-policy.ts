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
import { signatureTaskEvidenceCurrent } from "./signatures.js";
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
        (await signatureTaskEvidenceCurrent(db, task.id))
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
export async function closingRequirementBlockers(
  db: QueryDatabase,
  bankId: string,
  applicationId: string,
) {
  const [pkg] = await db
    .select({ id: applicationClosingPackages.id })
    .from(applicationClosingPackages)
    .where(
      and(
        eq(applicationClosingPackages.bankId, bankId),
        eq(applicationClosingPackages.applicationId, applicationId),
      ),
    );
  if (!pkg)
    return [
      {
        kind: "application" as const,
        id: null,
        stage: "closing" as const,
        title: "Prepare approved closing package",
        reason: "closing_package_missing",
      },
    ];
  return (await readClosingConditions(db, bankId, applicationId))
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
