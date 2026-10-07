import { createHash, randomUUID } from "node:crypto";
import { applications, auditEvents, type Database, documentVersions } from "@keycade/db";
import { createDocumentsService, enqueueDocumentProcessing } from "@keycade/domain";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { type PrivateDocumentStorage, webByteSource } from "./document-content.js";
import { demoDocumentFixture, documentFixtureScenario } from "./document-fixtures.js";
import { type Clock, systemClock } from "./provider.js";

export async function simulateDocumentScan(
  sha256: string,
  attempt: number,
  options: { clock: Clock; delayMs: number; signal?: AbortSignal; businessName?: string | null },
) {
  await options.clock.sleep(options.delayMs, options.signal);
  const scenario = documentFixtureScenario(sha256);
  const demo = demoDocumentFixture(sha256, options.businessName);
  return {
    simulated: true as const,
    provider: "keycade-file-scan-v1" as const,
    state:
      scenario === "blocked" || demo?.document.outcome === "scan_blocked"
        ? ("blocked" as const)
        : scenario === "scan-error" || (scenario === "scan-transient" && attempt === 1)
          ? ("error" as const)
          : ("clean" as const),
  };
}

/** The uploaded version row is transactional scan intent. Claims are leased and duplicate-safe. */
export async function processDocumentScans(
  db: Database,
  storage: PrivateDocumentStorage,
  options: { clock?: Clock; delayMs?: number; signal?: AbortSignal } = {},
) {
  const clock = options.clock ?? systemClock;
  const delayMs = options.delayMs ?? 2000;
  const now = clock.now();
  const claim = await db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.uploadState, "uploaded"),
          eq(documentVersions.scanState, "pending"),
          lte(documentVersions.scanAvailableAt, now),
          or(isNull(documentVersions.scanLeaseUntil), lte(documentVersions.scanLeaseUntil, now)),
        ),
      )
      .orderBy(documentVersions.scanAvailableAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!version) return null;
    const token = randomUUID();
    await tx
      .update(documentVersions)
      .set({
        scanClaimToken: token,
        scanLeaseUntil: new Date(now.getTime() + Math.max(delayMs + 30_000, 60_000)),
        scanAttempts: sql`${documentVersions.scanAttempts} + 1`,
      })
      .where(eq(documentVersions.id, version.id));
    return { ...version, token, attempt: version.scanAttempts + 1 };
  });
  if (!claim) return false;
  try {
    const bytes = await storage.open(claim.storageKey);
    if (!bytes || bytes.size !== claim.sizeBytes) {
      await bytes?.body.cancel();
      await createDocumentsService(db).markMissing(claim.id);
      return true;
    }
    const hash = createHash("sha256");
    for await (const chunk of webByteSource(bytes.body)) hash.update(chunk);
    if (hash.digest("hex") !== claim.sha256) {
      await createDocumentsService(db).markMissing(claim.id);
      return true;
    }
    const [application] = await db
      .select({ businessName: applications.businessName })
      .from(applications)
      .where(eq(applications.id, claim.applicationId));
    const result = await simulateDocumentScan(claim.sha256 ?? "", claim.attempt, {
      clock,
      delayMs,
      signal: options.signal,
      businessName: application?.businessName,
    });
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, claim.applicationId))
        .for("update");
      const changed = await tx
        .update(documentVersions)
        .set({
          scanState: result.state,
          scanErrorCode: result.state === "error" ? "simulated_scan_failure" : null,
          scannedAt: clock.now(),
          scanClaimToken: null,
          scanLeaseUntil: null,
        })
        .where(
          and(
            eq(documentVersions.id, claim.id),
            eq(documentVersions.scanClaimToken, claim.token),
            eq(documentVersions.scanGeneration, claim.scanGeneration),
            eq(documentVersions.uploadState, "uploaded"),
          ),
        )
        .returning({ id: documentVersions.id });
      if (!changed.length) return;
      if (result.state === "clean")
        await enqueueDocumentProcessing(tx, claim.id, {
          now: clock.now(),
          requestId: randomUUID(),
        });
      await tx.insert(auditEvents).values({
        bankId: claim.bankId,
        applicationId: claim.applicationId,
        actorType: "system",
        action: "document.scanned",
        targetType: "document_version",
        targetId: claim.id,
        requestId: randomUUID(),
        metadata: { simulated: true, state: result.state, provider: result.provider },
      });
    });
    return true;
  } catch (error) {
    if (!options.signal?.aborted) {
      await db
        .update(documentVersions)
        .set({
          scanState: "error",
          scanErrorCode: "scan_unavailable",
          scanLeaseUntil: null,
          scanClaimToken: null,
        })
        .where(
          and(eq(documentVersions.id, claim.id), eq(documentVersions.scanClaimToken, claim.token)),
        );
    }
    throw error;
  }
}
