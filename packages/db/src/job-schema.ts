import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { applications, banks } from "./schema.js";

export const simulationScenario = pgEnum("simulation_scenario", [
  "success",
  "missing_input",
  "transient_error",
  "timeout",
  "terminal_error",
]);
export const integrationStatus = pgEnum("integration_status", [
  "waiting_for_input",
  "queued",
  "running",
  "succeeded",
  "retry_scheduled",
  "failed",
  "timed_out",
  "cancelled",
]);
export type DemoResult = {
  provider: "keycade-demo-v1";
  simulated: true;
  outcome: "complete" | "waiting_for_input";
  operationId: string;
  inputRevision: number;
  completedAt: string;
};
export const integrationRuns = pgTable(
  "integration_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    applicationId: uuid("application_id").notNull(),
    inputRevision: integer("input_revision").notNull(),
    scenario: simulationScenario("scenario").notNull(),
    status: integrationStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    stale: boolean("stale").notNull().default(false),
    result: jsonb("result").$type<DemoResult>(),
    lastErrorCode: text("last_error_code"),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("runs_bank_application_id").on(t.bankId, t.applicationId, t.id),
    foreignKey({
      name: "runs_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check(
      "runs_revisions_attempts_valid",
      sql`${t.inputRevision} > 0 AND ${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 10 AND ${t.attempts} <= ${t.maxAttempts}`,
    ),
    index("runs_recovery").on(t.status, t.leaseUntil),
  ],
);
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().unique(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "outbox_run_scope_fk",
      columns: [t.bankId, t.applicationId, t.runId],
      foreignColumns: [integrationRuns.bankId, integrationRuns.applicationId, integrationRuns.id],
    }),
    index("outbox_pending").on(t.dispatchedAt),
  ],
);
export const effectDeduplications = pgTable(
  "effect_deduplications",
  {
    operationId: uuid("operation_id").primaryKey(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "effects_run_scope_fk",
      columns: [t.bankId, t.applicationId, t.operationId],
      foreignColumns: [integrationRuns.bankId, integrationRuns.applicationId, integrationRuns.id],
    }),
  ],
);
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
});
