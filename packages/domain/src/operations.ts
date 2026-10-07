import {
  type OperationsView,
  operationCommandSchema,
  operationsViewSchema,
} from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicationChecks,
  type Database,
  documentVersions,
  notifications as notificationRows,
  outboxEvents,
  workerHeartbeats,
} from "@keycade/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type Actor, requireApplicationAccess, requireBankStaff } from "./authorization.js";
import { createChecksService } from "./checks.js";
import { createDocumentsService } from "./documents.js";
import { DomainError } from "./errors.js";
import type { IdentifierCipher } from "./identifier-cipher.js";
import { createNotificationsService } from "./notifications.js";
import { createSignaturesService } from "./signatures.js";

export function createOperationsService(
  db: Database,
  options: { cipher: IdentifierCipher; clock?: () => Date },
) {
  const clock = options.clock ?? (() => new Date());
  const documents = createDocumentsService(db, { clock });
  const checks = createChecksService(db, { cipher: options.cipher, clock });
  const signatures = createSignaturesService(db, { clock });
  const notifications = createNotificationsService(db, { clock });
  async function guard(actor: Actor, bankId: string, applicationId: string) {
    await requireBankStaff(db, actor, bankId);
    await requireApplicationAccess(db, actor, bankId, applicationId);
  }
  async function read(actor: Actor, bankId: string, applicationId: string) {
    await guard(actor, bankId, applicationId);
    // Existing views own current-state policy; operator controls never infer eligibility from labels.
    const [files, checkView, signing, delivery] = await Promise.all([
      documents.list(actor, bankId, applicationId),
      checks.read(actor, bankId, applicationId),
      signatures.list(actor, bankId, applicationId),
      notifications.list(actor, bankId, applicationId),
    ]);
    const items: OperationsView["items"] = [];
    const scanRows = await db
      .select({ id: documentVersions.id, attempts: documentVersions.scanAttempts })
      .from(documentVersions)
      .where(
        and(eq(documentVersions.bankId, bankId), eq(documentVersions.applicationId, applicationId)),
      );
    const attempts = new Map(scanRows.map((row) => [row.id, row.attempts]));
    const checkRows = await db
      .select({ id: applicationChecks.id, createdAt: applicationChecks.createdAt })
      .from(applicationChecks)
      .where(
        and(
          eq(applicationChecks.bankId, bankId),
          eq(applicationChecks.applicationId, applicationId),
        ),
      );
    const checkDates = new Map(checkRows.map((row) => [row.id, row.createdAt.toISOString()]));
    for (const check of checkView.checks.filter((check) => !check.runs.length)) {
      const createdAt = checkDates.get(check.id);
      if (createdAt)
        items.push({
          id: `check:${check.id}`,
          resourceId: check.id,
          runId: null,
          kind: "check",
          title: check.title,
          status: "waiting_for_input",
          stale: false,
          attempts: 0,
          errorCode: null,
          createdAt,
          actions: [],
        });
    }
    for (const file of files.documents)
      for (const version of file.versions) {
        const stale = file.currentVersionId !== version.id;
        items.push({
          id: `scan:${version.id}`,
          resourceId: version.id,
          runId: null,
          kind: "document_scan",
          title: `Document scan · ${version.fileName}`,
          status: version.uploadState !== "uploaded" ? version.uploadState : version.scanState,
          stale,
          attempts: attempts.get(version.id) ?? 0,
          errorCode: version.scanErrorCode,
          createdAt: version.createdAt,
          actions: version.canRetryScan ? ["retry_scan"] : [],
        });
        for (const run of version.processing?.history ?? [])
          items.push({
            id: `processing:${run.id}`,
            resourceId: version.id,
            runId: run.id,
            kind: "document_processing",
            title: `Document interpretation · ${version.fileName}`,
            status: run.state,
            stale: stale || run.stale,
            attempts: run.attempts,
            errorCode: run.errorCode,
            createdAt: run.createdAt,
            actions:
              !stale &&
              run.id === version.processing?.runId &&
              run.state === "failed" &&
              version.processing.canRetry
                ? ["retry_processing"]
                : [],
          });
      }
    for (const check of checkView.checks)
      for (const run of check.runs)
        items.push({
          id: `check:${run.id}`,
          resourceId: check.id,
          runId: run.id,
          kind: "check",
          title: check.title,
          status:
            run.status === "succeeded" && run.outcome === "needs_review" && !run.resolved
              ? "needs_review"
              : run.status,
          stale: run.stale,
          attempts: run.attempts,
          errorCode: run.errorCode,
          createdAt: run.createdAt,
          actions: check.canRetry && run.id === check.currentRunId ? ["retry_check"] : [],
        });
    for (const envelope of signing.envelopes)
      items.push({
        id: `signature:${envelope.id}`,
        resourceId: envelope.id,
        runId: null,
        kind: "signature",
        title: `Signing · ${envelope.taskTitle}`,
        status:
          envelope.deliveryStatus === "failed"
            ? "delivery_failed"
            : envelope.state === "draft"
              ? envelope.deliveryStatus
              : envelope.state,
        stale: envelope.stale,
        attempts: envelope.sendAttempts,
        errorCode: envelope.sendError,
        createdAt: envelope.createdAt,
        actions: [
          ...(envelope.canSend && envelope.deliveryStatus === "failed"
            ? ["retry_signature" as const]
            : []),
          ...(envelope.canVoid ? ["void_signature" as const] : []),
        ],
      });
    for (const message of delivery.notifications)
      items.push({
        id: `notification:${message.id}`,
        resourceId: message.id,
        runId: null,
        kind: "notification",
        title: `Simulated message · ${message.kind.replaceAll("_", " ")}`,
        status: message.status,
        stale: false,
        attempts: message.attempts,
        errorCode: message.lastErrorCode ?? message.suppressionReason,
        createdAt: message.createdAt,
        actions: message.canRetry ? ["retry_notification"] : [],
      });
    const [heartbeat] = await db
      .select({ seenAt: workerHeartbeats.seenAt })
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.seenAt))
      .limit(1);
    const [outbox] = await db
      .select({
        count: sql<number>`count(*)::integer`,
        oldest: sql<Date | string | null>`min(${outboxEvents.createdAt})`,
        overdue: sql<number>`count(*) filter (where ${outboxEvents.createdAt} < ${new Date(clock().getTime() - 5 * 60000)})::integer`,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.bankId, bankId),
          eq(outboxEvents.applicationId, applicationId),
          isNull(outboxEvents.dispatchedAt),
        ),
      );
    const [access] = await db
      .select({
        count: sql<number>`count(*)::integer`,
        oldest: sql<Date | string | null>`min(${notificationRows.createdAt})`,
        overdue: sql<number>`count(*) filter (where ${notificationRows.createdAt} < ${new Date(clock().getTime() - 5 * 60000)})::integer`,
      })
      .from(notificationRows)
      .leftJoin(
        accessDeliveryRequests,
        eq(accessDeliveryRequests.id, notificationRows.deliveryRequestId),
      )
      .where(
        and(
          eq(notificationRows.bankId, bankId),
          eq(notificationRows.applicationId, applicationId),
          or(
            eq(notificationRows.state, "pending"),
            and(
              eq(notificationRows.state, "queued"),
              inArray(accessDeliveryRequests.status, ["queued", "sending"]),
              isNull(accessDeliveryRequests.revokedAt),
              isNull(accessDeliveryRequests.consumedAt),
            ),
          ),
        ),
      );
    const pending = items.filter(
      (item) =>
        !item.stale &&
        item.kind !== "notification" &&
        ["pending", "queued", "processing", "running", "retry_scheduled"].includes(item.status),
    );
    const now = clock().getTime();
    const dates = [
      ...pending.map((item) => item.createdAt),
      ...[outbox?.oldest, access?.oldest].flatMap((date) =>
        date ? [new Date(date).toISOString()] : [],
      ),
    ].sort();
    // Recheck membership after collecting component views; revocation must not return cached diagnostics.
    await guard(actor, bankId, applicationId);
    return operationsViewSchema.parse({
      applicationId,
      simulated: true,
      worker: {
        state: !heartbeat
          ? "unknown"
          : now - heartbeat.seenAt.getTime() <= 180000
            ? "healthy"
            : "offline",
        lastSeenAt: heartbeat?.seenAt.toISOString() ?? null,
        staleAfterSeconds: 180,
      },
      backlog: {
        pending: pending.length + (outbox?.count ?? 0) + (access?.count ?? 0),
        oldestAt: dates[0] ?? null,
        overdue:
          pending.filter((item) => now - new Date(item.createdAt).getTime() > 5 * 60000).length +
          (access?.overdue ?? 0) +
          (outbox?.overdue ?? 0),
      },
      items: items.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      ),
    });
  }
  async function act(
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    await guard(actor, bankId, applicationId);
    const parsed = operationCommandSchema.safeParse(raw);
    if (!parsed.success)
      throw new DomainError("INVALID_INPUT", 400, "Choose an available operation action.");
    const command = parsed.data;
    const view = await read(actor, bankId, applicationId);
    const item = view.items.find(
      (item) =>
        item.resourceId === command.resourceId &&
        (item.runId ?? undefined) === command.runId &&
        item.actions.includes(command.action),
    );
    if (!item)
      throw new DomainError(
        "INVALID_STATE",
        409,
        "This operation changed. Refresh and choose a current action.",
      );
    const args = [actor, bankId, applicationId, command.resourceId] as const;
    switch (command.action) {
      case "retry_scan":
        await documents.retryScan(...args, requestId);
        break;
      case "retry_processing":
        await documents.retryProcessing(...args, requestId);
        break;
      case "retry_check":
        await checks.retry(...args, { runId: command.runId, reason: "operator_review" }, requestId);
        break;
      case "retry_signature":
        await signatures.retrySend(...args, requestId);
        break;
      case "void_signature":
        await signatures.void(...args, requestId);
        break;
      case "retry_notification":
        await notifications.retry(...args, requestId);
        break;
    }
    return read(actor, bankId, applicationId);
  }
  return { read, act };
}
