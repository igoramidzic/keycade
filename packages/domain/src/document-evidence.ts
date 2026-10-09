import {
  documentCategoryOverrides,
  documentMetadataRevisions,
  documentProcessingRuns,
  documents,
  documentVersions,
} from "@keycade/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { QueryDatabase } from "./authorization.js";

export type DocumentEvidence = {
  documents: (typeof documents.$inferSelect)[];
  versions: (typeof documentVersions.$inferSelect)[];
  runs: (typeof documentProcessingRuns.$inferSelect)[];
  overrides: (typeof documentCategoryOverrides.$inferSelect)[];
  metadata: (typeof documentMetadataRevisions.$inferSelect)[];
};

/** Caller holds the application lock and current access. Never reuse across requests. */
export async function readDocumentEvidence(
  db: QueryDatabase,
  bankId: string,
  applicationId: string,
  options: {
    visible?: (document: typeof documents.$inferSelect) => boolean;
    includeMetadata?: boolean;
  } = {},
): Promise<DocumentEvidence> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.bankId, bankId), eq(documents.applicationId, applicationId)))
    .orderBy(desc(documents.createdAt));
  const visible = options.visible ? rows.filter(options.visible) : rows;
  const evidence: DocumentEvidence = {
    documents: visible,
    versions: [],
    runs: [],
    overrides: [],
    metadata: [],
  };
  if (!visible.length) return evidence;
  evidence.versions = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.bankId, bankId),
        eq(documentVersions.applicationId, applicationId),
        inArray(
          documentVersions.documentId,
          visible.map((document) => document.id),
        ),
      ),
    )
    .orderBy(desc(documentVersions.version));
  const versionIds = evidence.versions.map((version) => version.id);
  if (!versionIds.length) return evidence;
  // One transaction uses one pg connection; batching rows removes round trips, not Promise.all.
  evidence.runs = await db
    .select()
    .from(documentProcessingRuns)
    .where(
      and(
        eq(documentProcessingRuns.bankId, bankId),
        eq(documentProcessingRuns.applicationId, applicationId),
        inArray(documentProcessingRuns.versionId, versionIds),
      ),
    )
    .orderBy(desc(documentProcessingRuns.generation));
  evidence.overrides = await db
    .select()
    .from(documentCategoryOverrides)
    .where(
      and(
        eq(documentCategoryOverrides.bankId, bankId),
        eq(documentCategoryOverrides.applicationId, applicationId),
        inArray(documentCategoryOverrides.versionId, versionIds),
      ),
    )
    .orderBy(desc(documentCategoryOverrides.revision));
  if (options.includeMetadata !== false)
    evidence.metadata = await db
      .select()
      .from(documentMetadataRevisions)
      .where(
        and(
          eq(documentMetadataRevisions.bankId, bankId),
          eq(documentMetadataRevisions.applicationId, applicationId),
          inArray(documentMetadataRevisions.versionId, versionIds),
        ),
      )
      .orderBy(desc(documentMetadataRevisions.revision));
  return evidence;
}

/** Retains the database's revision/generation ordering inside each group. */
export function groupEvidence<T>(rows: readonly T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}
