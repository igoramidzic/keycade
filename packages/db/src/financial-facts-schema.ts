import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type DocumentInterpretationResult,
  documentProcessingRuns,
} from "./document-processing-schema.js";
import { documentVersions } from "./document-schema.js";
import { applications, users } from "./schema.js";

/** Append-only ledger; the highest non-null revision is the current fact for its semantic key. */
export const financialFactReviews = pgTable(
  "financial_fact_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    documentId: uuid("document_id").notNull(),
    versionId: uuid("version_id").notNull(),
    runId: uuid("run_id").notNull(),
    runGeneration: integer("run_generation").notNull(),
    categoryRevision: integer("category_revision").notNull(),
    analysisRevision: integer("analysis_revision").notNull(),
    metric: text("metric").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    basis: text("basis").$type<"fiscal_year" | "statement">().notNull(),
    currency: text("currency").notNull().default("USD"),
    unit: text("unit").notNull().default("money"),
    value: numeric("value", { precision: 20, scale: 2 }).notNull(),
    disposition: text("disposition").$type<"accept" | "correct" | "reject">().notNull(),
    factRevision: integer("fact_revision"),
    originalCandidate: jsonb("original_candidate")
      .$type<DocumentInterpretationResult["extractedFields"][number]>()
      .notNull(),
    adjustments: jsonb("adjustments")
      .$type<DocumentInterpretationResult["extractedFields"]>()
      .notNull()
      .default([]),
    businessSnapshot: jsonb("business_snapshot")
      .$type<{ businessId: string | null; businessName: string; applicationRevision: number }>()
      .notNull(),
    sha256: text("sha256").notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    simulated: boolean("simulated").notNull().default(true),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("financial_fact_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("financial_fact_revision").on(
      t.bankId,
      t.applicationId,
      t.metric,
      t.periodStart,
      t.periodEnd,
      t.basis,
      t.currency,
      t.unit,
      t.factRevision,
    ),
    foreignKey({
      name: "financial_fact_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "financial_fact_document_fk",
      columns: [t.bankId, t.applicationId, t.documentId, t.versionId],
      foreignColumns: [
        documentVersions.bankId,
        documentVersions.applicationId,
        documentVersions.documentId,
        documentVersions.id,
      ],
    }),
    foreignKey({
      name: "financial_fact_run_fk",
      columns: [t.bankId, t.applicationId, t.runId],
      foreignColumns: [
        documentProcessingRuns.bankId,
        documentProcessingRuns.applicationId,
        documentProcessingRuns.id,
      ],
    }),
    check(
      "financial_fact_metric",
      sql`${t.metric} IN ('gross_sales','returns_allowances','revenue','ordinary_income','net_income','depreciation_adjustment','one_time_adjustment','adjusted_net_income','opening_balance','closing_balance','deposits','withdrawals')`,
    ),
    check(
      "financial_fact_values",
      sql`${t.currency}='USD' AND ${t.unit}='money' AND ${t.periodStart}<=${t.periodEnd} AND ${t.basis} IN ('fiscal_year','statement') AND ${t.value}::text NOT IN ('NaN','Infinity','-Infinity')`,
    ),
    check(
      "financial_fact_review",
      sql`((${t.disposition} IN ('accept','correct') AND ${t.factRevision} IS NOT NULL AND ${t.factRevision}>0) OR (${t.disposition}='reject' AND ${t.factRevision} IS NULL)) AND length(btrim(${t.reason})) BETWEEN 1 AND 1000 AND ${t.runGeneration}>0 AND ${t.categoryRevision}>=0 AND ${t.analysisRevision}>=0 AND ${t.simulated}=true AND ${t.sha256} ~ '^[a-f0-9]{64}$'`,
    ),
    index("financial_fact_history").on(t.bankId, t.applicationId, t.reviewedAt),
  ],
);

export const financialFactCommands = pgTable(
  "financial_fact_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    payloadHash: text("payload_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("financial_fact_command_key").on(t.bankId, t.applicationId, t.idempotencyKey),
    foreignKey({
      name: "financial_fact_command_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check("financial_fact_command_hash", sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
