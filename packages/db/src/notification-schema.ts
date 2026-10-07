import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accessDeliveryRequests } from "./auth-schema.js";
import { applicantContacts, applications, banks, users } from "./schema.js";

const date = (name: string) => timestamp(name, { withTimezone: true });
export const applicantActivity = pgTable(
  "applicant_activity",
  {
    applicationId: uuid("application_id").primaryKey(),
    bankId: uuid("bank_id").notNull(),
    episodeId: uuid("episode_id").notNull().defaultRandom(),
    lastMeaningfulAt: date("last_meaningful_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "applicant_activity_app_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    updatedAt: date("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bankId, t.userId] })],
);

export type NotificationKind =
  | "access_requested"
  | "application_started"
  | "application_resume"
  | "invitation"
  | "task_assigned"
  | "task_returned"
  | "status_changed"
  | "reminder"
  | "signature_requested";
// Intent and SMTP delivery are separate: the latter keeps shared-use credentials and lease recovery.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    applicationId: uuid("application_id"),
    recipientUserId: uuid("recipient_user_id").references(() => users.id),
    contactId: uuid("contact_id"),
    kind: text("kind").$type<NotificationKind>().notNull(),
    deduplicationKey: text("deduplication_key").notNull().unique(),
    resourceId: uuid("resource_id"),
    resourceRevision: integer("resource_revision"),
    episodeId: uuid("episode_id"),
    reminderOrdinal: integer("reminder_ordinal"),
    state: text("state").$type<"pending" | "queued" | "suppressed">().notNull().default("pending"),
    deliveryRequestId: uuid("delivery_request_id")
      .unique()
      .references(() => accessDeliveryRequests.id),
    availableAt: date("available_at").notNull().defaultNow(),
    suppressedAt: date("suppressed_at"),
    suppressionReason: text("suppression_reason"),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "notification_app_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "notification_contact_fk",
      columns: [t.bankId, t.contactId],
      foreignColumns: [applicantContacts.bankId, applicantContacts.id],
    }),
    check(
      "notification_kind_valid",
      sql`${t.kind} IN ('access_requested','application_started','application_resume','invitation','task_assigned','task_returned','status_changed','reminder','signature_requested')`,
    ),
    check("notification_state_valid", sql`${t.state} IN ('pending','queued','suppressed')`),
    check(
      "notification_recipient_required",
      sql`${t.recipientUserId} IS NOT NULL OR ${t.contactId} IS NOT NULL`,
    ),
    check(
      "notification_reminder_episode",
      sql`${t.kind} <> 'reminder' OR (${t.episodeId} IS NOT NULL AND ${t.reminderOrdinal} IN (1,2))`,
    ),
    index("notification_pending").on(t.state, t.availableAt),
    index("notification_application").on(t.bankId, t.applicationId, t.createdAt),
  ],
);
