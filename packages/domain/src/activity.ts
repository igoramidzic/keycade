import {
  activityCursorSchema,
  activityQuerySchema,
  activityReferenceSchema,
  activityViewSchema,
} from "@keycade/contracts";
import {
  applicationChecks,
  applicationTasks,
  auditEvents,
  bankMemberships,
  checkRuns,
  type Database,
  documents,
  documentVersions,
  signatureEnvelopes,
  signatureSigners,
} from "@keycade/db";
import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { type Actor, requireApplicantPortalAccess } from "./authorization.js";
import { checkIsVisible } from "./checks.js";
import { documentIsVisible } from "./documents.js";
import { DomainError, deny } from "./errors.js";
import { signatureSignerEligible } from "./signatures.js";
import { taskIsVisible } from "./tasks.js";

// Only these authored descriptions enter the projection. Audit metadata, notes,
// addresses, provider findings and document contents never become display text.
const labels: Record<string, string> = {
  "application.created": "Application created",
  "application.claimed": "Application claimed",
  "application.setup_saved": "Application setup saved",
  "application.setup_completed": "Initial setup completed",
  "application.purpose_updated": "Application purpose updated",
  "application.submit": "Application submitted",
  "application.start_review": "Bank review started",
  "application.request_information": "Additional information requested",
  "application.approve": "Simulated approval recorded",
  "application.decline": "Application declined",
  "application.withdraw": "Application withdrawn",
  "application.closing_started": "Closing started",
  "application.funding_recorded": "Simulated funding recorded",
  "application.staff_assigned": "Staff assignment updated",
  "invitation.created": "Participant invited",
  "invitation.resent": "Participant invitation resent",
  "invitation.revoked": "Participant invitation revoked",
  "invitation.accepted": "Participant invitation accepted",
  "participant.removed": "Participant access removed",
  "business_relationship.created": "Business relationship added",
  "business_relationship.linked": "Business relationship linked",
  "business_relationship.removed": "Business relationship removed",
  "business_relationship.restored": "Business relationship restored",
  "task.created": "Requirement created",
  "task.answer": "Requirement answer saved",
  "task.submit": "Requirement submitted",
  "task.review": "Requirement reviewed",
  "task.waive": "Requirement waived",
  "task.cancelled": "Requirement cancelled",
  "task.unassigned": "Requirement assignment removed",
  "task.returned_for_information": "Requirement returned for information",
  "task.document_evidence_changed": "Requirement document evidence updated",
  "task.identifier_saved": "Synthetic identifier saved",
  "task.tax_authorization_saved": "Synthetic tax authorization updated",
  "task.private_input_superseded": "Private requirement evidence replaced",
  "document.upload_started": "Document upload started",
  "document.upload_finished": "Document upload finished",
  "document.upload_abandoned": "Document upload cancelled",
  "document.bytes_missing": "Document file unavailable",
  "document.scanned": "Simulated document scan completed",
  "document.scan_retried": "Document scan retried",
  "document.processing_queued": "Document interpretation queued",
  "document.processing_retried": "Document interpretation retried",
  "document.processing_stale": "Document interpretation superseded",
  "document.processed": "Simulated document interpretation completed",
  "document.processing_retry_scheduled": "Document interpretation retry scheduled",
  "document.processing_failed": "Document interpretation failed",
  "document.category_corrected": "Document category reviewed",
  "check.completed": "Simulated check completed",
  "check.retried": "Simulated check retried",
  "check.resolved": "Simulated check reviewed by staff",
  "enrichment.completed": "Simulated enrichment completed",
  "enrichment.requested": "Simulated enrichment requested",
  "enrichment.retried": "Simulated enrichment retried",
  "signature.created": "Signature request created",
  "signature.send_requested": "Signature delivery requested",
  "signature.sent": "Simulated signature request sent",
  "signature.signer_signed": "Simulated signature recorded",
  "signature.signer_declined": "Signature request declined",
  "signature.system_completed": "All simulated signatures completed",
  "signature.completed": "Simulated signing completed",
  "signature.expired": "Signature request expired",
  "signature.voided": "Signature request voided",
  "notification.retry": "Simulated notification retried",
  "staff_note.created": "Internal note added",
  "staff_note.updated": "Internal note updated",
  "simulation.completed": "Background simulation completed",
};
const scope = (type: string, ids: string[]): SQL =>
  ids.length
    ? and(eq(auditEvents.targetType, type), inArray(auditEvents.targetId, ids))!
    : sql`false`;

export function createActivityService(db: Database) {
  async function list(actor: Actor, bankId: string, applicationId: string, raw: unknown = {}) {
    const parsed = activityQuerySchema.safeParse(raw);
    if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Invalid activity page.");
    const { limit, cursor } = parsed.data;
    const boundary = cursor ? cursor.split("~") : null;
    if (boundary && !activityCursorSchema.safeParse(boundary).success)
      throw new DomainError("INVALID_INPUT", 400, "Invalid activity cursor.");
    return db.transaction(
      async (tx) => {
        const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
        if (actor.kind !== "user" || access.kind === "system") return deny();
        let visible: SQL = sql`true`;
        if (access.kind !== "staff") {
          const fullAdmin = access.role === "applicant_admin" && access.scope === "full";
          const tasks = (
            await tx
              .select()
              .from(applicationTasks)
              .where(
                and(
                  eq(applicationTasks.bankId, bankId),
                  eq(applicationTasks.applicationId, applicationId),
                ),
              )
          ).filter((task) => taskIsVisible(actor, access, task));
          const files = await tx
            .select()
            .from(documents)
            .where(and(eq(documents.bankId, bankId), eq(documents.applicationId, applicationId)));
          const fileIds: string[] = [];
          for (const file of files)
            if (await documentIsVisible(tx, actor, access, file)) fileIds.push(file.id);
          const versions = fileIds.length
            ? await tx
                .select({ id: documentVersions.id })
                .from(documentVersions)
                .where(inArray(documentVersions.documentId, fileIds))
            : [];
          const checkIds = await tx
            .select({ id: checkRuns.id, check: applicationChecks })
            .from(checkRuns)
            .innerJoin(applicationChecks, eq(applicationChecks.id, checkRuns.checkId))
            .where(and(eq(checkRuns.bankId, bankId), eq(checkRuns.applicationId, applicationId)));
          const signing = await tx
            .select({ envelope: signatureEnvelopes, signer: signatureSigners })
            .from(signatureSigners)
            .innerJoin(signatureEnvelopes, eq(signatureEnvelopes.id, signatureSigners.envelopeId))
            .where(
              and(
                eq(signatureEnvelopes.bankId, bankId),
                eq(signatureEnvelopes.applicationId, applicationId),
                eq(signatureSigners.userId, actor.userId),
              ),
            );
          const envelopeIds: string[] = [];
          for (const row of signing)
            if (await signatureSignerEligible(tx, row.envelope, row.signer))
              envelopeIds.push(row.envelope.id);
          visible = or(
            scope(
              "task",
              tasks.map((task) => task.id),
            ),
            scope("document", fileIds),
            scope(
              "document_version",
              versions.map((version) => version.id),
            ),
            scope(
              "check_run",
              checkIds
                .filter((row) => checkIsVisible(actor, access, row.check))
                .map((row) => row.id),
            ),
            scope("signature_envelope", envelopeIds),
            ...(fullAdmin
              ? [
                  and(
                    inArray(auditEvents.targetType, [
                      "application",
                      "invitation",
                      "participant",
                      "business_relationship",
                    ]),
                    sql`${auditEvents.action} <> 'application.staff_assigned'`,
                  )!,
                ]
              : []),
          )!;
        }
        const rows = await tx
          .select({
            row: auditEvents,
            timestamp: sql<string>`to_char(${auditEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.bankId, bankId),
              eq(auditEvents.applicationId, applicationId),
              inArray(auditEvents.action, Object.keys(labels)),
              visible,
              ...(boundary
                ? [
                    or(
                      sql`${auditEvents.createdAt} < ${boundary[0]}::timestamptz`,
                      and(
                        sql`${auditEvents.createdAt} = ${boundary[0]}::timestamptz`,
                        lt(auditEvents.id, boundary[1]!),
                      ),
                    ),
                  ]
                : []),
            ),
          )
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const staff = new Set(
          (
            await tx
              .select({ id: bankMemberships.userId })
              .from(bankMemberships)
              .where(eq(bankMemberships.bankId, bankId))
          ).map((row) => row.id),
        );
        const last = page.at(-1);
        return activityViewSchema.parse({
          applicationId,
          simulated: true,
          entries: page.map(({ row, timestamp }) => ({
            id: row.id,
            createdAt: timestamp,
            description: labels[row.action]!,
            actor:
              row.actorUserId === actor.userId
                ? "You"
                : row.actorType === "system"
                  ? "System"
                  : row.actorUserId && staff.has(row.actorUserId)
                    ? "Bank staff"
                    : "Participant",
            reference:
              access.kind === "staff" && activityReferenceSchema.safeParse(row.requestId).success
                ? row.requestId
                : null,
          })),
          nextCursor: rows.length > limit && last ? `${last.timestamp}~${last.row.id}` : null,
        });
      },
      { isolationLevel: "repeatable read" },
    );
  }
  return { list };
}
