import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { applicationDecisions, applicationSubmissions } from "./review-schema.js";
import { applications, businesses, loanProducts, users } from "./schema.js";
import { applicationTasks } from "./task-schema.js";
export type ClosingConditionTemplate = {
  key: string;
  title: string;
  description: string;
  kind: "task" | "signature";
  required: boolean;
};
export type ApprovedClosingTerms = {
  decisionId: string;
  submissionId: string;
  businessId: string;
  businessName: string;
  productName: string;
  requestedAmount: string;
  approvedAmount: string;
  currency: "USD";
  approvedAt: string;
};
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const productClosingPolicies = pgTable(
  "product_closing_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    productId: uuid("product_id").notNull(),
    version: integer("version").notNull(),
    amountPolicy: text("amount_policy").$type<"exact_approved_amount">().notNull(),
    conditions: jsonb("conditions").$type<ClosingConditionTemplate[]>().notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("closing_policies_scope_id").on(t.bankId, t.id),
    unique("closing_policies_version").on(t.productId, t.version),
    foreignKey({
      name: "closing_policy_product_fk",
      columns: [t.bankId, t.productId],
      foreignColumns: [loanProducts.bankId, loanProducts.id],
    }),
    check(
      "closing_policy_valid",
      sql`${t.version}>0 AND ${t.amountPolicy}='exact_approved_amount'`,
    ),
  ],
);
export const applicationClosingPackages = pgTable(
  "application_closing_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    submissionId: uuid("submission_id").notNull(),
    policyId: uuid("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    revision: integer("revision").notNull().default(1),
    amountPolicy: text("amount_policy").$type<"exact_approved_amount">().notNull(),
    terms: jsonb("terms").$type<ApprovedClosingTerms>().notNull(),
    conditionTemplates: jsonb("condition_templates").$type<ClosingConditionTemplate[]>().notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
  },
  (t) => [
    unique("closing_packages_application").on(t.applicationId),
    unique("closing_packages_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("closing_packages_decision_id").on(t.bankId, t.applicationId, t.id, t.decisionId),
    foreignKey({
      name: "closing_package_decision_fk",
      columns: [t.bankId, t.applicationId, t.decisionId],
      foreignColumns: [
        applicationDecisions.bankId,
        applicationDecisions.applicationId,
        applicationDecisions.id,
      ],
    }),
    foreignKey({
      name: "closing_package_submission_fk",
      columns: [t.bankId, t.applicationId, t.submissionId],
      foreignColumns: [
        applicationSubmissions.bankId,
        applicationSubmissions.applicationId,
        applicationSubmissions.id,
      ],
    }),
    foreignKey({
      name: "closing_package_policy_fk",
      columns: [t.bankId, t.policyId],
      foreignColumns: [productClosingPolicies.bankId, productClosingPolicies.id],
    }),
    check(
      "closing_package_valid",
      sql`${t.revision}>0 AND ${t.policyVersion}>0 AND ${t.amountPolicy}='exact_approved_amount'`,
    ),
  ],
);
export const closingConditions = pgTable(
  "closing_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    packageId: uuid("package_id").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    kind: text("kind").$type<"task" | "signature">().notNull(),
    required: boolean("required").notNull(),
    taskId: uuid("task_id").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("closing_condition_key").on(t.packageId, t.key),
    unique("closing_condition_task").on(t.taskId),
    foreignKey({
      name: "closing_condition_package_fk",
      columns: [t.bankId, t.applicationId, t.packageId],
      foreignColumns: [
        applicationClosingPackages.bankId,
        applicationClosingPackages.applicationId,
        applicationClosingPackages.id,
      ],
    }),
    foreignKey({
      name: "closing_condition_task_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    check("closing_condition_kind", sql`${t.kind} IN ('task','signature')`),
  ],
);
export const fundingRecords = pgTable(
  "funding_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    packageId: uuid("package_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    approvedAmount: numeric("approved_amount", { precision: 20, scale: 2 }).notNull(),
    fundedAmount: numeric("funded_amount", { precision: 20, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    fundedOn: date("funded_on", { mode: "string" }).notNull(),
    reference: text("reference").notNull(),
    simulated: boolean("simulated").notNull().default(true),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
  },
  (t) => [
    unique("funding_records_application").on(t.applicationId),
    unique("funding_records_scope_id").on(t.bankId, t.applicationId, t.id),
    foreignKey({
      name: "funding_package_decision_fk",
      columns: [t.bankId, t.applicationId, t.packageId, t.decisionId],
      foreignColumns: [
        applicationClosingPackages.bankId,
        applicationClosingPackages.applicationId,
        applicationClosingPackages.id,
        applicationClosingPackages.decisionId,
      ],
    }),
    check(
      "funding_amounts_simulated",
      sql`${t.simulated}=true AND ${t.currency}='USD' AND ${t.approvedAmount}>0 AND ${t.fundedAmount}=${t.approvedAmount}`,
    ),
    check("funding_reference_valid", sql`length(btrim(${t.reference})) BETWEEN 1 AND 100`),
  ],
);
export const loanAccounts = pgTable(
  "loan_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    businessId: uuid("business_id").notNull(),
    fundingRecordId: uuid("funding_record_id").notNull(),
    terms: jsonb("terms").$type<ApprovedClosingTerms>().notNull(),
    simulated: boolean("simulated").notNull().default(true),
    createdAt: created(),
  },
  (t) => [
    unique("loan_accounts_application").on(t.applicationId),
    unique("loan_accounts_funding").on(t.fundingRecordId),
    unique("loan_accounts_scope_id").on(t.bankId, t.applicationId, t.id),
    foreignKey({
      name: "account_funding_fk",
      columns: [t.bankId, t.applicationId, t.fundingRecordId],
      foreignColumns: [fundingRecords.bankId, fundingRecords.applicationId, fundingRecords.id],
    }),
    foreignKey({
      name: "account_business_fk",
      columns: [t.bankId, t.businessId],
      foreignColumns: [businesses.bankId, businesses.id],
    }),
    check("account_simulated", sql`${t.simulated}=true`),
  ],
);
export const closingCommands = pgTable(
  "closing_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    packageId: uuid("package_id").notNull(),
    accountId: uuid("account_id"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").$type<"start" | "fund">().notNull(),
    payloadHash: text("payload_hash").notNull(),
    applicationRevision: integer("application_revision").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("closing_commands_key").on(t.bankId, t.applicationId, t.idempotencyKey),
    foreignKey({
      name: "closing_command_package_fk",
      columns: [t.bankId, t.applicationId, t.packageId],
      foreignColumns: [
        applicationClosingPackages.bankId,
        applicationClosingPackages.applicationId,
        applicationClosingPackages.id,
      ],
    }),
    foreignKey({
      name: "closing_command_account_fk",
      columns: [t.bankId, t.applicationId, t.accountId],
      foreignColumns: [loanAccounts.bankId, loanAccounts.applicationId, loanAccounts.id],
    }),
    check(
      "closing_command_valid",
      sql`${t.applicationRevision}>0 AND ${t.payloadHash} ~ '^[a-f0-9]{64}$' AND ((${t.action}='start' AND ${t.accountId} IS NULL) OR (${t.action}='fund' AND ${t.accountId} IS NOT NULL))`,
    ),
  ],
);
