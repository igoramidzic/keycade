import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { applications, users } from "./schema.js";

/** Immutable copies and opaque, application-scoped evidence references; never plaintext identifiers or task answers. */
export type SubmissionSnapshot = {
  facts: {
    businessName: string;
    productName: string;
    requestedAmount: string;
    currency: "USD";
    purpose: string | null;
    // Optional only for reading immutable submissions captured before v2 intake.
    businessAddress?: (typeof applications.$inferSelect)["businessAddress"];
    businessAddressRevision?: number;
    website?: string | null;
    fundingPurposes?: string[];
    purposeCatalogVersion?: string | null;
    otherPurposeDetail?: string | null;
    industryCode: string | null;
    industryTaxonomyVersion: string | null;
  };
  businessProfile: { id: string; legalName: string; industryCode: string | null; revision: number };
  materialFingerprint: string;
  references: Record<string, unknown>;
};
const date = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const applicationSubmissions = pgTable(
  "application_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    sequence: integer("sequence").notNull(),
    applicationRevision: integer("application_revision").notNull(),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id),
    snapshot: jsonb("snapshot").$type<SubmissionSnapshot>().notNull(),
    createdAt: date(),
  },
  (t) => [
    unique("submissions_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("submissions_sequence").on(t.applicationId, t.sequence),
    foreignKey({
      name: "submissions_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check("submissions_revision_valid", sql`${t.sequence}>0 AND ${t.applicationRevision}>0`),
  ],
);
export const applicationDecisions = pgTable(
  "application_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    submissionId: uuid("submission_id").notNull(),
    applicationRevision: integer("application_revision").notNull(),
    outcome: text("outcome").$type<"approved" | "declined">().notNull(),
    reasonCode: text("reason_code").notNull(),
    privateNote: text("private_note"),
    approvedAmount: numeric("approved_amount", { precision: 20, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    decidedByUserId: uuid("decided_by_user_id")
      .notNull()
      .references(() => users.id),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    createdAt: date(),
  },
  (t) => [
    unique("decisions_submission").on(t.submissionId),
    unique("decisions_scope_id").on(t.bankId, t.applicationId, t.id),
    foreignKey({
      name: "decisions_submission_fk",
      columns: [t.bankId, t.applicationId, t.submissionId],
      foreignColumns: [
        applicationSubmissions.bankId,
        applicationSubmissions.applicationId,
        applicationSubmissions.id,
      ],
    }),
    check(
      "decisions_terms_valid",
      sql`${t.applicationRevision}>0 AND ${t.currency}='USD' AND ((${t.outcome}='approved' AND ${t.approvedAmount} IS NOT NULL AND ${t.approvedAmount}>0 AND ${t.reasonCode}='demo_criteria_met') OR (${t.outcome}='declined' AND ${t.approvedAmount} IS NULL AND ${t.reasonCode} IN ('demo_criteria_not_met','unable_to_verify_information')))`,
    ),
  ],
);
export const applicationReviewEvents = pgTable(
  "application_review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    submissionId: uuid("submission_id"),
    action: text("action")
      .$type<
        "submit" | "start_review" | "request_information" | "approve" | "decline" | "withdraw"
      >()
      .notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    applicationRevision: integer("application_revision").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    reasonCode: text("reason_code"),
    privateNote: text("private_note"),
    taskIds: jsonb("task_ids").$type<string[]>().notNull().default([]),
    createdAt: date(),
  },
  (t) => [
    unique("review_events_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("review_events_revision").on(t.applicationId, t.applicationRevision),
    foreignKey({
      name: "review_events_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "review_events_submission_fk",
      columns: [t.bankId, t.applicationId, t.submissionId],
      foreignColumns: [
        applicationSubmissions.bankId,
        applicationSubmissions.applicationId,
        applicationSubmissions.id,
      ],
    }),
    check(
      "review_events_action_valid",
      sql`${t.applicationRevision}>0 AND ${t.action} IN ('submit','start_review','request_information','approve','decline','withdraw')`,
    ),
  ],
);
export const applicationReviewCommands = pgTable(
  "application_review_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    payloadHash: text("payload_hash").notNull(),
    eventId: uuid("event_id").notNull(),
    createdAt: date(),
  },
  (t) => [
    unique("review_commands_key").on(t.bankId, t.applicationId, t.idempotencyKey),
    foreignKey({
      name: "review_commands_event_fk",
      columns: [t.bankId, t.applicationId, t.eventId],
      foreignColumns: [
        applicationReviewEvents.bankId,
        applicationReviewEvents.applicationId,
        applicationReviewEvents.id,
      ],
    }),
    check("review_commands_hash", sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
