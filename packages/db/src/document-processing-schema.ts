import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
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

export type DocumentCategory =
  | "tax"
  | "bank_statement"
  | "financial_statement"
  | "business_legal"
  | "identification"
  | "signed"
  | "other";
export type DocumentInterpretationResult = {
  provider: "keycade-document-interpretation-v1";
  simulated: true;
  versionId: string;
  runId: string;
  category: DocumentCategory;
  confidence: number;
  needsReview: boolean;
  extractedFields: { key: string; label: string; value: string; kind: "text" | "money" | "year" }[];
  completedAt: string;
};
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const documentProcessingRuns = pgTable(
  "document_processing_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    versionId: uuid("version_id").notNull(),
    generation: integer("generation").notNull(),
    state: text("state")
      .$type<"queued" | "processing" | "classified" | "needs_review" | "failed">()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    stale: boolean("stale").notNull().default(false),
    result: jsonb("result").$type<DocumentInterpretationResult>(),
    lastErrorCode: text("last_error_code"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("document_processing_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("document_processing_generation").on(t.versionId, t.generation),
    foreignKey({
      name: "document_processing_version_fk",
      columns: [t.bankId, t.applicationId, t.versionId],
      foreignColumns: [
        documentVersions.bankId,
        documentVersions.applicationId,
        documentVersions.id,
      ],
    }),
    check(
      "document_processing_state",
      sql`${t.state} IN ('queued','processing','classified','needs_review','failed')`,
    ),
    check(
      "document_processing_attempts",
      sql`${t.generation} > 0 AND ${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 10 AND ${t.attempts} <= ${t.maxAttempts}`,
    ),
    check(
      "document_processing_result_required",
      sql`${t.state} NOT IN ('classified','needs_review') OR ${t.result} IS NOT NULL`,
    ),
    index("document_processing_pending").on(t.state, t.availableAt, t.leaseUntil),
  ],
);

/** Clean-scan completion and explicit reprocessing each insert one durable, deduplicated intent. */
export const documentProcessingOutbox = pgTable(
  "document_processing_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().unique(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "document_processing_outbox_run_fk",
      columns: [t.bankId, t.applicationId, t.runId],
      foreignColumns: [
        documentProcessingRuns.bankId,
        documentProcessingRuns.applicationId,
        documentProcessingRuns.id,
      ],
    }),
    index("document_processing_outbox_pending").on(t.dispatchedAt),
  ],
);

export const documentCategoryOverrides = pgTable(
  "document_category_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    versionId: uuid("version_id").notNull(),
    revision: integer("revision").notNull(),
    category: text("category").$type<DocumentCategory>().notNull(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "document_category_override_version_fk",
      columns: [t.bankId, t.applicationId, t.versionId],
      foreignColumns: [
        documentVersions.bankId,
        documentVersions.applicationId,
        documentVersions.id,
      ],
    }),
    unique("document_category_override_revision").on(t.versionId, t.revision),
    check(
      "document_category_override_category",
      sql`${t.category} IN ('tax','bank_statement','financial_statement','business_legal','identification','signed','other')`,
    ),
    check(
      "document_category_override_reason",
      sql`length(btrim(${t.reason})) BETWEEN 1 AND 1000 AND ${t.revision} > 0`,
    ),
  ],
);
