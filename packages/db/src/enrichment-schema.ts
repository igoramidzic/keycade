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
import { integrationStatus } from "./job-schema.js";
import { applications, users } from "./schema.js";

type SafeEnrichmentResult = {
  provider: "keycade-enrichment-v1";
  simulated: true;
  kind: "business" | "tax";
  operationId: string;
  inputRevision: number;
  completedAt: string;
  outcome: "complete" | "not_found" | "needs_review" | "waiting_for_input";
  suggestions: { key: "entity_type" | "registration_state"; value: string }[];
  taxRecords: { year: number; availability: "sample_available" }[];
};
const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const sensitiveIdentifierVersions = pgTable(
  "sensitive_identifier_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    subjectKey: text("subject_key").notNull(),
    revision: integer("revision").notNull(),
    kind: text("kind").$type<"ein" | "ssn">().notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    maskedValue: text("masked_value").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: now(),
  },
  (t) => [
    unique("identifier_versions_scope_id").on(t.bankId, t.applicationId, t.subjectKey, t.id),
    unique("identifier_versions_scope_revision").on(
      t.bankId,
      t.applicationId,
      t.subjectKey,
      t.revision,
    ),
    foreignKey({
      name: "identifier_versions_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check(
      "identifier_versions_revision_kind",
      sql`${t.revision} > 0 AND ((${t.kind} = 'ein' AND ${t.subjectKey} = 'business') OR (${t.kind} = 'ssn' AND ${t.subjectKey} ~ '^[a-f0-9-]{36}$'))`,
    ),
    check(
      "identifier_versions_encrypted_format",
      sql`${t.encryptedValue} ~ '^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`,
    ),
  ],
);
export const enrichmentInputs = pgTable(
  "enrichment_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    subjectKey: text("subject_key").notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    revision: integer("revision").notNull().default(0),
    identifierId: uuid("identifier_id"),
    identifierRevision: integer("identifier_revision").notNull().default(0),
    taxAuthorizedAt: timestamp("tax_authorized_at", { withTimezone: true }),
    taxAuthorizedByUserId: uuid("tax_authorized_by_user_id").references(() => users.id),
    taxNoticeVersion: text("tax_notice_version"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("enrichment_inputs_scope").on(t.bankId, t.applicationId, t.subjectKey),
    unique("enrichment_inputs_scope_id").on(t.bankId, t.applicationId, t.subjectKey, t.id),
    foreignKey({
      name: "enrichment_inputs_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "enrichment_inputs_identifier_scope_fk",
      columns: [t.bankId, t.applicationId, t.subjectKey, t.identifierId],
      foreignColumns: [
        sensitiveIdentifierVersions.bankId,
        sensitiveIdentifierVersions.applicationId,
        sensitiveIdentifierVersions.subjectKey,
        sensitiveIdentifierVersions.id,
      ],
    }),
    check(
      "enrichment_inputs_subject_valid",
      sql`${t.subjectKey} = coalesce(${t.subjectUserId}::text, 'business')`,
    ),
    check(
      "enrichment_inputs_revision_valid",
      sql`${t.revision} >= 0 AND ${t.identifierRevision} >= 0 AND ((${t.identifierId} IS NULL AND ${t.identifierRevision}=0) OR (${t.identifierId} IS NOT NULL AND ${t.identifierRevision}>0))`,
    ),
    check(
      "enrichment_inputs_authorization_valid",
      sql`(${t.taxAuthorizedAt} IS NULL AND ${t.taxAuthorizedByUserId} IS NULL AND ${t.taxNoticeVersion} IS NULL) OR (${t.taxAuthorizedAt} IS NOT NULL AND ${t.taxAuthorizedByUserId} IS NOT NULL AND ${t.taxNoticeVersion} IS NOT NULL AND ${t.taxNoticeVersion}='demo-tax-v1')`,
    ),
  ],
);
export const enrichmentRuns = pgTable(
  "enrichment_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    subjectKey: text("subject_key").notNull(),
    inputId: uuid("input_id").notNull(),
    kind: text("kind").$type<"business" | "tax">().notNull(),
    inputRevision: integer("input_revision").notNull(),
    applicationRevision: integer("application_revision").notNull(),
    status: integrationStatus("status").notNull(),
    stale: boolean("stale").notNull().default(false),
    missingPrerequisites: jsonb("missing_prerequisites")
      .$type<("business_name" | "identifier" | "tax_authorization")[]>()
      .notNull()
      .default([]),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    result: jsonb("result").$type<SafeEnrichmentResult>(),
    errorCode: text("error_code"),
    requestId: text("request_id").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("enrichment_runs_scope_id").on(t.bankId, t.applicationId, t.subjectKey, t.id),
    unique("enrichment_runs_current_input").on(
      t.inputId,
      t.kind,
      t.inputRevision,
      t.applicationRevision,
    ),
    foreignKey({
      name: "enrichment_runs_input_scope_fk",
      columns: [t.bankId, t.applicationId, t.subjectKey, t.inputId],
      foreignColumns: [
        enrichmentInputs.bankId,
        enrichmentInputs.applicationId,
        enrichmentInputs.subjectKey,
        enrichmentInputs.id,
      ],
    }),
    check(
      "enrichment_runs_kind_subject",
      sql`${t.kind} IN ('business','tax') AND (${t.kind} <> 'business' OR ${t.subjectKey}='business')`,
    ),
    check(
      "enrichment_runs_attempts_valid",
      sql`${t.inputRevision}>=0 AND ${t.applicationRevision}>0 AND ${t.attempts}>=0 AND ${t.maxAttempts} BETWEEN 1 AND 30 AND ${t.attempts}<=${t.maxAttempts}`,
    ),
    index("enrichment_runs_pending").on(t.status, t.availableAt, t.leaseUntil),
  ],
);
export const confirmedEnrichmentFacts = pgTable(
  "confirmed_enrichment_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    subjectKey: text("subject_key").notNull(),
    runId: uuid("run_id").notNull(),
    key: text("key").$type<"entity_type" | "registration_state">().notNull(),
    value: text("value").notNull(),
    confirmedByUserId: uuid("confirmed_by_user_id")
      .notNull()
      .references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "confirmed_facts_run_scope_fk",
      columns: [t.bankId, t.applicationId, t.subjectKey, t.runId],
      foreignColumns: [
        enrichmentRuns.bankId,
        enrichmentRuns.applicationId,
        enrichmentRuns.subjectKey,
        enrichmentRuns.id,
      ],
    }),
    unique("confirmed_facts_run_key").on(t.runId, t.key),
    check("confirmed_facts_allowed_keys", sql`${t.key} IN ('entity_type','registration_state')`),
  ],
);
