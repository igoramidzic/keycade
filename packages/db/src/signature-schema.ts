import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./document-schema.js";
import { applicationParticipants, applications, users } from "./schema.js";
import { applicationTasks } from "./task-schema.js";

const id = () => uuid("id").primaryKey().defaultRandom();
const date = (name: string) => timestamp(name, { withTimezone: true });
export const signatureEnvelopes = pgTable(
  "signature_envelopes",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    taskId: uuid("task_id").notNull(),
    sourceVersionId: uuid("source_version_id").notNull(),
    taskEvidenceRevision: integer("task_evidence_revision").notNull(),
    completedEvidenceRevision: integer("completed_evidence_revision"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    state: text("state")
      .$type<
        "draft" | "sent" | "partially_signed" | "completed" | "declined" | "expired" | "voided"
      >()
      .notNull()
      .default("draft"),
    deliveryStatus: text("delivery_status")
      .$type<"not_sent" | "pending" | "running" | "sent" | "failed">()
      .notNull()
      .default("not_sent"),
    scenario: text("scenario").$type<"success" | "transient_error" | "terminal_error">().notNull(),
    sendError: text("send_error"),
    sendAttempts: integer("send_attempts").notNull().default(0),
    sendGeneration: integer("send_generation").notNull().default(0),
    sendAvailableAt: date("send_available_at").notNull().defaultNow(),
    sendClaimToken: uuid("send_claim_token"),
    sendLeaseUntil: date("send_lease_until"),
    providerEnvelopeId: text("provider_envelope_id"),
    stale: boolean("stale").notNull().default(false),
    expiresAt: date("expires_at").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
    updatedAt: date("updated_at").notNull().defaultNow(),
    completedAt: date("completed_at"),
  },
  (t) => [
    unique("signature_envelopes_bank_app_id").on(t.bankId, t.applicationId, t.id),
    unique("signature_envelopes_idempotency").on(t.bankId, t.applicationId, t.idempotencyKey),
    foreignKey({
      name: "signature_envelope_app_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "signature_envelope_task_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    foreignKey({
      name: "signature_envelope_version_fk",
      columns: [t.bankId, t.applicationId, t.sourceVersionId],
      foreignColumns: [
        documentVersions.bankId,
        documentVersions.applicationId,
        documentVersions.id,
      ],
    }),
    check(
      "signature_envelope_state",
      sql`${t.state} IN ('draft','sent','partially_signed','completed','declined','expired','voided')`,
    ),
    check(
      "signature_envelope_delivery",
      sql`${t.deliveryStatus} IN ('not_sent','pending','running','sent','failed')`,
    ),
    check(
      "signature_envelope_scenario",
      sql`${t.scenario} IN ('success','transient_error','terminal_error')`,
    ),
    check(
      "signature_envelope_revisions",
      sql`${t.taskEvidenceRevision}>=0 AND ${t.sendAttempts}>=0 AND ${t.sendGeneration}>=0`,
    ),
    check(
      "signature_envelope_completion",
      sql`${t.state}<>'completed' OR (${t.completedAt} IS NOT NULL AND ${t.completedEvidenceRevision} IS NOT NULL)`,
    ),
    index("signature_envelope_dispatch").on(t.deliveryStatus, t.sendAvailableAt),
  ],
);
export const signatureSigners = pgTable(
  "signature_signers",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    participantId: uuid("participant_id").notNull(),
    participantGenerationAt: date("participant_generation_at"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    state: text("state").$type<"pending" | "signed" | "declined">().notNull().default("pending"),
    actedAt: date("acted_at"),
  },
  (t) => [
    unique("signature_signer_envelope_user").on(t.envelopeId, t.userId),
    unique("signature_signer_envelope_id").on(t.envelopeId, t.id),
    foreignKey({
      name: "signature_signer_envelope_fk",
      columns: [t.bankId, t.applicationId, t.envelopeId],
      foreignColumns: [
        signatureEnvelopes.bankId,
        signatureEnvelopes.applicationId,
        signatureEnvelopes.id,
      ],
    }),
    foreignKey({
      name: "signature_signer_participant_fk",
      columns: [t.bankId, t.applicationId, t.participantId],
      foreignColumns: [
        applicationParticipants.bankId,
        applicationParticipants.applicationId,
        applicationParticipants.id,
      ],
    }),
    check("signature_signer_state", sql`${t.state} IN ('pending','signed','declined')`),
  ],
);
export const taskSignaturePolicies = pgTable(
  "task_signature_policies",
  {
    taskId: uuid("task_id").primaryKey(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    updatedAt: date("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "task_signature_policy_task_fk",
      columns: [t.bankId, t.applicationId, t.taskId],
      foreignColumns: [
        applicationTasks.bankId,
        applicationTasks.applicationId,
        applicationTasks.id,
      ],
    }),
    foreignKey({
      name: "task_signature_policy_envelope_fk",
      columns: [t.bankId, t.applicationId, t.envelopeId],
      foreignColumns: [
        signatureEnvelopes.bankId,
        signatureEnvelopes.applicationId,
        signatureEnvelopes.id,
      ],
    }),
  ],
);
export const signatureSendOutbox = pgTable(
  "signature_send_outbox",
  {
    id: id(),
    envelopeId: uuid("envelope_id")
      .notNull()
      .references(() => signatureEnvelopes.id),
    generation: integer("generation").notNull(),
    requestId: uuid("request_id").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
    dispatchedAt: date("dispatched_at"),
  },
  (t) => [unique("signature_send_intent").on(t.envelopeId, t.generation)],
);
export const signatureProviderEvents = pgTable("signature_provider_events", {
  eventId: uuid("event_id").primaryKey(),
  envelopeId: uuid("envelope_id")
    .notNull()
    .references(() => signatureEnvelopes.id),
  payloadHash: text("payload_hash").notNull(),
  type: text("type").notNull(),
  signerId: uuid("signer_id"),
  outcome: text("outcome").$type<"applied" | "ignored">().notNull(),
  occurredAt: date("occurred_at").notNull(),
  receivedAt: date("received_at").notNull(),
});
export const signatureArtifacts = pgTable(
  "signature_artifacts",
  {
    id: id(),
    envelopeId: uuid("envelope_id")
      .notNull()
      .unique()
      .references(() => signatureEnvelopes.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => applicationTasks.id),
    evidenceRevision: integer("evidence_revision").notNull(),
    body: text("body").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  (t) => [unique("signature_artifact_task_revision").on(t.taskId, t.evidenceRevision)],
);
export const signatureNotificationOutbox = pgTable(
  "signature_notification_outbox",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    signerId: uuid("signer_id").notNull(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").$type<"signature_requested">().notNull().default("signature_requested"),
    createdAt: date("created_at").notNull().defaultNow(),
    dispatchedAt: date("dispatched_at"),
  },
  (t) => [
    unique("signature_notification_signer").on(t.signerId, t.kind),
    foreignKey({
      name: "signature_notification_envelope_fk",
      columns: [t.bankId, t.applicationId, t.envelopeId],
      foreignColumns: [
        signatureEnvelopes.bankId,
        signatureEnvelopes.applicationId,
        signatureEnvelopes.id,
      ],
    }),
    foreignKey({
      name: "signature_notification_signer_fk",
      columns: [t.envelopeId, t.signerId],
      foreignColumns: [signatureSigners.envelopeId, signatureSigners.id],
    }),
  ],
);
