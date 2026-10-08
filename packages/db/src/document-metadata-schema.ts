import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./document-schema.js";
import { users } from "./schema.js";

/** Append-only reviewer metadata; uploaded bytes and original filenames never change. */
export const documentMetadataRevisions = pgTable(
  "document_metadata_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    documentId: uuid("document_id").notNull(),
    versionId: uuid("version_id").notNull(),
    revision: integer("revision").notNull(),
    analysisRevision: integer("analysis_revision").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    expectedPeriod: jsonb("expected_period").$type<{
      start: string;
      end: string;
      basis: "fiscal_year" | "statement";
    }>(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("document_metadata_version_revision").on(t.versionId, t.revision),
    foreignKey({
      name: "document_metadata_source_fk",
      columns: [t.bankId, t.applicationId, t.documentId, t.versionId],
      foreignColumns: [
        documentVersions.bankId,
        documentVersions.applicationId,
        documentVersions.documentId,
        documentVersions.id,
      ],
    }),
    check(
      "document_metadata_revision_valid",
      sql`${t.revision} > 0 AND ${t.analysisRevision} >= 0 AND ${t.analysisRevision} <= ${t.revision}`,
    ),
    check(
      "document_metadata_text_valid",
      sql`length(btrim(${t.reason})) BETWEEN 1 AND 1000 AND (${t.displayName} IS NULL OR length(btrim(${t.displayName})) BETWEEN 1 AND 180) AND (${t.description} IS NULL OR length(${t.description}) <= 2000)`,
    ),
  ],
);
