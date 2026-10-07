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
import { sensitiveIdentifierVersions } from "./enrichment-schema.js";
import { integrationStatus } from "./job-schema.js";
import { applications, businessRelationships, users } from "./schema.js";
import { applicationTasks } from "./task-schema.js";

export type SafeCheckResult = {
  provider: "keycade-checks-v1";
  simulated: true;
  kind: "identity" | "fraud";
  operationId: string;
  fingerprint: string;
  completedAt: string;
  outcome: "clear" | "needs_review" | "unable_to_verify";
  findings: ("synthetic_match" | "synthetic_review_flag" | "synthetic_no_match")[];
};
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const applicationChecks = pgTable(
  "application_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    stableKey: text("stable_key").notNull(),
    kind: text("kind").$type<"identity" | "fraud">().notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    subjectRelationshipId: uuid("subject_relationship_id"),
    stage: text("stage")
      .$type<"submission" | "approval" | "closing">()
      .notNull()
      .default("approval"),
    required: boolean("required").notNull().default(true),
    policyVersion: text("policy_version").notNull().default("demo-checks-v1"),
    allowReviewResolution: boolean("allow_review_resolution").notNull().default(true),
    active: boolean("active").notNull().default(true),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("checks_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("checks_stable_key").on(t.bankId, t.applicationId, t.stableKey),
    foreignKey({
      name: "checks_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "checks_relationship_fk",
      columns: [t.bankId, t.applicationId, t.subjectRelationshipId],
      foreignColumns: [
        businessRelationships.bankId,
        businessRelationships.applicationId,
        businessRelationships.id,
      ],
    }),
    check(
      "checks_kind_subject",
      sql`(${t.kind}='fraud' AND ${t.subjectRelationshipId} IS NULL AND ${t.subjectUserId} IS NULL) OR (${t.kind}='identity' AND ${t.subjectRelationshipId} IS NOT NULL)`,
    ),
    check(
      "checks_policy_valid",
      sql`${t.stage} IN ('submission','approval','closing') AND ${t.policyVersion}='demo-checks-v1' AND ${t.revision}>0`,
    ),
  ],
);
export const checkRuns = pgTable(
  "check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    checkId: uuid("check_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    identifierId: uuid("identifier_id"),
    subjectKey: text("subject_key").notNull(),
    status: integrationStatus("status").notNull(),
    stale: boolean("stale").notNull().default(false),
    missingPrerequisites: jsonb("missing_prerequisites").$type<string[]>().notNull().default([]),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    result: jsonb("result").$type<SafeCheckResult>(),
    errorCode: text("error_code"),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("check_runs_scope_id").on(t.bankId, t.applicationId, t.checkId, t.id),
    unique("check_runs_current_input").on(t.checkId, t.fingerprint),
    foreignKey({
      name: "check_runs_check_fk",
      columns: [t.bankId, t.applicationId, t.checkId],
      foreignColumns: [
        applicationChecks.bankId,
        applicationChecks.applicationId,
        applicationChecks.id,
      ],
    }),
    foreignKey({
      name: "check_runs_identifier_fk",
      columns: [t.bankId, t.applicationId, t.subjectKey, t.identifierId],
      foreignColumns: [
        sensitiveIdentifierVersions.bankId,
        sensitiveIdentifierVersions.applicationId,
        sensitiveIdentifierVersions.subjectKey,
        sensitiveIdentifierVersions.id,
      ],
    }),
    check(
      "check_runs_attempts_valid",
      sql`${t.attempts}>=0 AND ${t.maxAttempts} BETWEEN 1 AND 30 AND ${t.attempts}<=${t.maxAttempts}`,
    ),
    check("check_runs_fingerprint_valid", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
    index("check_runs_pending").on(t.status, t.availableAt, t.leaseUntil),
  ],
);
export const checkResolutions = pgTable(
  "check_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    checkId: uuid("check_id").notNull(),
    runId: uuid("run_id").notNull(),
    reason: text("reason").$type<"reviewed_synthetic_evidence">().notNull(),
    resolvedByUserId: uuid("resolved_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("check_resolutions_run").on(t.runId),
    foreignKey({
      name: "check_resolutions_run_fk",
      columns: [t.bankId, t.applicationId, t.checkId, t.runId],
      foreignColumns: [checkRuns.bankId, checkRuns.applicationId, checkRuns.checkId, checkRuns.id],
    }),
    check("check_resolution_reason_valid", sql`${t.reason}='reviewed_synthetic_evidence'`),
  ],
);
/** Connects private entry tasks to encrypted input scope, never to plaintext task answers. */
export const checkInputTasks = pgTable(
  "check_input_tasks",
  {
    taskId: uuid("task_id").primaryKey(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    subjectKey: text("subject_key").notNull(),
    kind: text("kind").$type<"identifier" | "tax_authorization">().notNull(),
    capturedInputRevision: integer("captured_input_revision"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "check_input_task_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    check(
      "check_input_task_kind",
      sql`${t.kind} IN ('identifier','tax_authorization') AND (${t.subjectKey}='business' OR ${t.subjectKey} ~ '^[a-f0-9-]{36}$') AND (${t.capturedInputRevision} IS NULL OR ${t.capturedInputRevision}>=0)`,
    ),
    index("check_input_task_subject").on(t.bankId, t.applicationId, t.subjectKey),
  ],
);
