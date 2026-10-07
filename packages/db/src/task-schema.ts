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
import {
  applicationParticipants,
  applications,
  banks,
  businessRelationships,
  loanProducts,
  users,
} from "./schema.js";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export type RequirementRule = {
  key: string;
  title: string;
  description: string;
  reason: string;
  stage: "submission" | "approval" | "closing";
  required: boolean;
  visibility: "shared" | "assigned" | "private";
  subject: "application" | "owner";
  condition:
    | "always"
    | "amount_at_least"
    | "industry_unknown"
    | "identifier_unknown"
    | "entity_unknown"
    | "business_known";
  amount?: string;
};
export const productRequirementRules = pgTable(
  "product_requirement_rules",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    productId: uuid("product_id").notNull(),
    version: integer("version").notNull(),
    rules: jsonb("rules").$type<RequirementRule[]>().notNull(),
    evidenceReusePolicy: text("evidence_reuse_policy").$type<"never">().notNull().default("never"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("requirement_rules_bank_id").on(t.bankId, t.id),
    unique("requirement_rules_product_version").on(t.bankId, t.productId, t.version),
    foreignKey({
      name: "requirement_rules_product_bank_fk",
      columns: [t.bankId, t.productId],
      foreignColumns: [loanProducts.bankId, loanProducts.id],
    }),
    check("requirement_rules_version_positive", sql`${t.version} > 0`),
    check("requirement_rules_reuse_never", sql`${t.evidenceReusePolicy} = 'never'`),
  ],
);
export const applicationRequirementPolicies = pgTable(
  "application_requirement_policies",
  {
    applicationId: uuid("application_id").primaryKey(),
    bankId: uuid("bank_id").notNull(),
    ruleSetId: uuid("rule_set_id").notNull(),
    productId: uuid("product_id").notNull(),
    version: integer("version").notNull(),
    rules: jsonb("rules").$type<RequirementRule[]>().notNull(),
    evidenceReusePolicy: text("evidence_reuse_policy").$type<"never">().notNull().default("never"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "requirement_policy_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "requirement_policy_rule_bank_fk",
      columns: [t.bankId, t.ruleSetId],
      foreignColumns: [productRequirementRules.bankId, productRequirementRules.id],
    }),
    foreignKey({
      name: "requirement_policy_product_bank_fk",
      columns: [t.bankId, t.productId],
      foreignColumns: [loanProducts.bankId, loanProducts.id],
    }),
    check("requirement_policy_version_positive", sql`${t.version} > 0`),
    check("requirement_policy_reuse_never", sql`${t.evidenceReusePolicy} = 'never'`),
  ],
);
export const applicationTasks = pgTable(
  "application_tasks",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    stableKey: text("stable_key").notNull(),
    occurrence: integer("occurrence").notNull().default(1),
    source: text("source").$type<"rule" | "manual">().notNull(),
    ruleSetId: uuid("rule_set_id"),
    ruleVersion: integer("rule_version"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    reason: text("reason").notNull(),
    stage: text("stage").$type<"submission" | "approval" | "closing">().notNull(),
    required: boolean("required").notNull(),
    state: text("state")
      .$type<"open" | "submitted" | "needs_changes" | "completed" | "waived" | "cancelled">()
      .notNull()
      .default("open"),
    visibility: text("visibility").$type<"shared" | "assigned" | "private">().notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    subjectRelationshipId: uuid("subject_relationship_id"),
    assigneeParticipantId: uuid("assignee_participant_id"),
    assigneeGenerationAt: timestamp("assignee_generation_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    inputRevision: integer("input_revision").notNull(),
    inputFingerprint: text("input_fingerprint").notNull().default("manual"),
    evidenceRevision: integer("evidence_revision").notNull().default(0),
    reviewedEvidenceRevision: integer("reviewed_evidence_revision"),
    manualPayloadHash: text("manual_payload_hash"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("tasks_bank_app_id").on(t.bankId, t.applicationId, t.id),
    unique("tasks_stable_occurrence").on(t.bankId, t.applicationId, t.stableKey, t.occurrence),
    foreignKey({
      name: "tasks_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "tasks_subject_relationship_fk",
      columns: [t.bankId, t.applicationId, t.subjectRelationshipId],
      foreignColumns: [
        businessRelationships.bankId,
        businessRelationships.applicationId,
        businessRelationships.id,
      ],
    }),
    foreignKey({
      name: "tasks_rule_bank_fk",
      columns: [t.bankId, t.ruleSetId],
      foreignColumns: [productRequirementRules.bankId, productRequirementRules.id],
    }),
    foreignKey({
      name: "tasks_assignee_application_fk",
      columns: [t.bankId, t.applicationId, t.assigneeParticipantId],
      foreignColumns: [
        applicationParticipants.bankId,
        applicationParticipants.applicationId,
        applicationParticipants.id,
      ],
    }),
    check(
      "tasks_states_valid",
      sql`${t.state} IN ('open','submitted','needs_changes','completed','waived','cancelled')`,
    ),
    check("tasks_stage_valid", sql`${t.stage} IN ('submission','approval','closing')`),
    check("tasks_visibility_valid", sql`${t.visibility} IN ('shared','assigned','private')`),
    check("tasks_source_valid", sql`${t.source} IN ('rule','manual')`),
    check(
      "tasks_revisions_valid",
      sql`${t.revision}>0 AND ${t.occurrence}>0 AND ${t.inputRevision}>0 AND ${t.evidenceRevision}>=0`,
    ),
    check("tasks_title_valid", sql`length(btrim(${t.title})) BETWEEN 1 AND 160`),
    check(
      "tasks_review_current",
      sql`${t.state} <> 'completed' OR (${t.evidenceRevision}>0 AND ${t.reviewedEvidenceRevision} = ${t.evidenceRevision})`,
    ),
    index("tasks_application").on(t.bankId, t.applicationId, t.state),
  ],
);
export const taskAnswers = pgTable(
  "task_answers",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    taskId: uuid("task_id").notNull(),
    evidenceRevision: integer("evidence_revision").notNull(),
    answer: text("answer").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "task_answers_task_bank_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    unique("task_answers_revision").on(t.taskId, t.evidenceRevision),
    check("task_answers_revision_positive", sql`${t.evidenceRevision}>0`),
    check("task_answers_length", sql`length(btrim(${t.answer})) BETWEEN 1 AND 4000`),
  ],
);
export const taskReviews = pgTable(
  "task_reviews",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    taskId: uuid("task_id").notNull(),
    evidenceRevision: integer("evidence_revision").notNull(),
    taskRevision: integer("task_revision").notNull(),
    decision: text("decision").$type<"completed" | "needs_changes" | "waived">().notNull(),
    reason: text("reason").notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "task_reviews_task_bank_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    check(
      "task_reviews_decision_valid",
      sql`${t.decision} IN ('completed','needs_changes','waived')`,
    ),
    check("task_reviews_reason_required", sql`length(btrim(${t.reason})) BETWEEN 1 AND 2000`),
  ],
);
export const taskAssignments = pgTable(
  "task_assignments",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    taskId: uuid("task_id").notNull(),
    participantId: uuid("participant_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "task_assignments_task_bank_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    foreignKey({
      name: "task_assignments_participant_bank_fk",
      columns: [t.bankId, t.applicationId, t.participantId],
      foreignColumns: [
        applicationParticipants.bankId,
        applicationParticipants.applicationId,
        applicationParticipants.id,
      ],
    }),
  ],
);
