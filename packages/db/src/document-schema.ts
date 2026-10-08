import { sql } from "drizzle-orm";
import {
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
import { applications, users } from "./schema.js";
import { applicationTasks } from "./task-schema.js";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    taskId: uuid("task_id"),
    visibility: text("visibility").$type<"shared" | "assigned" | "private">().notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    currentVersion: integer("current_version").notNull().default(0),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("documents_bank_app_id").on(t.bankId, t.applicationId, t.id),
    foreignKey({
      name: "documents_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "documents_task_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    check("documents_visibility_valid", sql`${t.visibility} IN ('shared','assigned','private')`),
    check(
      "documents_private_subject",
      sql`${t.visibility} <> 'private' OR ${t.subjectUserId} IS NOT NULL`,
    ),
    check("documents_version_valid", sql`${t.currentVersion} >= 0`),
  ],
);

/** A staged version is also its durable upload reservation. Its UUID is the upload ID. */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    documentId: uuid("document_id").notNull(),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").$type<"application/pdf" | "image/jpeg" | "image/png">().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    // Recipe and application snapshot validated against the exact generated PDF bytes.
    demoImportFixture: jsonb("demo_import_fixture").$type<{
      recipeId: string;
      recipeVersion: 1;
      businessName: string;
      applicationRevision: number;
    }>(),
    storageKey: text("storage_key").notNull().unique(),
    uploadState: text("upload_state")
      .$type<"staged" | "uploaded" | "abandoned" | "missing">()
      .notNull()
      .default("staged"),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    keyHash: text("key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    scanState: text("scan_state")
      .$type<"pending" | "clean" | "blocked" | "error">()
      .notNull()
      .default("pending"),
    scanErrorCode: text("scan_error_code"),
    scanAvailableAt: timestamp("scan_available_at", { withTimezone: true }),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    scanGeneration: integer("scan_generation").notNull().default(1),
    scanClaimToken: uuid("scan_claim_token"),
    scanLeaseUntil: timestamp("scan_lease_until", { withTimezone: true }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_versions_bank_app_id").on(t.bankId, t.applicationId, t.id),
    unique("document_versions_document_id").on(t.bankId, t.applicationId, t.documentId, t.id),
    unique("document_versions_number").on(t.documentId, t.version),
    unique("document_versions_idempotency").on(
      t.bankId,
      t.applicationId,
      t.uploadedByUserId,
      t.keyHash,
    ),
    foreignKey({
      name: "document_versions_document_fk",
      columns: [t.bankId, t.applicationId, t.documentId],
      foreignColumns: [documents.bankId, documents.applicationId, documents.id],
    }),
    check("document_versions_size", sql`${t.sizeBytes} > 0 AND ${t.version} > 0`),
    check(
      "document_versions_mime",
      sql`${t.mimeType} IN ('application/pdf','image/jpeg','image/png')`,
    ),
    check(
      "document_versions_upload_state",
      sql`${t.uploadState} IN ('staged','uploaded','abandoned','missing')`,
    ),
    check(
      "document_versions_scan_state",
      sql`${t.scanState} IN ('pending','clean','blocked','error')`,
    ),
    check(
      "document_versions_uploaded_metadata",
      sql`${t.uploadState} <> 'uploaded' OR (${t.sha256} IS NOT NULL AND ${t.sha256} ~ '^[a-f0-9]{64}$' AND ${t.uploadedAt} IS NOT NULL)`,
    ),
    check(
      "document_versions_scan_metadata",
      sql`${t.scanAttempts} >= 0 AND ${t.scanGeneration} > 0 AND (${t.scanState} <> 'clean' OR ${t.uploadState} = 'uploaded')`,
    ),
    index("document_versions_scan_pending").on(t.uploadState, t.scanState, t.scanAvailableAt),
    index("document_versions_cleanup").on(t.uploadState, t.expiresAt),
  ],
);

export const taskDocumentEvidence = pgTable(
  "task_document_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    taskId: uuid("task_id").notNull(),
    documentId: uuid("document_id").notNull(),
    versionId: uuid("version_id").notNull(),
    evidenceRevision: integer("evidence_revision").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "task_document_evidence_task_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    foreignKey({
      name: "task_document_evidence_version_fk",
      columns: [t.bankId, t.applicationId, t.documentId, t.versionId],
      foreignColumns: [
        documentVersions.bankId,
        documentVersions.applicationId,
        documentVersions.documentId,
        documentVersions.id,
      ],
    }),
    unique("task_document_evidence_version").on(t.taskId, t.versionId),
    check("task_document_evidence_revision", sql`${t.evidenceRevision} > 0`),
  ],
);
