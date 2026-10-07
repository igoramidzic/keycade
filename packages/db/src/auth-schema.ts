import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { applicantContacts, applications, banks, invitations, users } from "./schema.js";

export const identityPortal = pgEnum("identity_portal", ["borrower", "staff"]);
export const sessionAuthenticationMethod = pgEnum("session_authentication_method", [
  "email_link",
  "demo",
]);
export const accessDeliveryStatus = pgEnum("access_delivery_status", [
  "queued",
  "sending",
  "delivered",
  "failed",
]);

// This application-owned outbox contains delivery intent, never a bearer credential.
// Retry-created login tokens all share consumedAt/revokedAt on this record.
export const accessDeliveryRequests = pgTable(
  "access_delivery_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    contactId: uuid("contact_id").notNull(),
    applicationId: uuid("application_id"),
    invitationId: uuid("invitation_id"),
    portal: identityPortal("portal").notNull(),
    origin: text("origin").notNull(),
    returnPath: text("return_path").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: accessDeliveryStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "access_delivery_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "access_delivery_invitation_bank_fk",
      columns: [t.bankId, t.invitationId],
      foreignColumns: [invitations.bankId, invitations.id],
    }),
    foreignKey({
      name: "access_delivery_contact_bank_fk",
      columns: [t.bankId, t.contactId],
      foreignColumns: [applicantContacts.bankId, applicantContacts.id],
    }),
    check("access_delivery_attempts_valid", sql`${t.attempts} BETWEEN 0 AND 3`),
    index("access_delivery_pending").on(t.status, t.availableAt, t.leaseUntil),
  ],
);

export const loginTokens = pgTable(
  "login_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryRequestId: uuid("delivery_request_id")
      .notNull()
      .references(() => accessDeliveryRequests.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("login_token_hash_sha256", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    index("login_tokens_delivery").on(t.deliveryRequestId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    portal: identityPortal("portal").notNull(),
    authenticationMethod: sessionAuthenticationMethod("authentication_method")
      .notNull()
      .default("email_link"),
    origin: text("origin").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("session_token_hash_sha256", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    index("sessions_user").on(t.userId),
  ],
);

// Fixed windows survive API process restarts and are shared by both HTTP transports.
export const identityRateLimits = pgTable(
  "identity_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [check("identity_rate_count_positive", sql`${t.count} > 0`)],
);
