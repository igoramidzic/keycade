import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accessDeliveryRequests, loginTokens } from "./auth-schema.js";

// Synthetic mailbox only. Bearer links are encrypted and never included in searchable text.
export const demoInboxMessages = pgTable(
  "demo_inbox_messages",
  {
    deliveryRequestId: uuid("delivery_request_id")
      .primaryKey()
      .references(() => accessDeliveryRequests.id),
    loginTokenId: uuid("login_token_id")
      .notNull()
      .references(() => loginTokens.id),
    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    encryptedConfirmUrl: text("encrypted_confirm_url").notNull(),
    attempt: integer("attempt").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("demo_inbox_attempt_valid", sql`${t.attempt} BETWEEN 1 AND 3`),
    check("demo_inbox_subject_bounded", sql`length(${t.subject}) BETWEEN 1 AND 240`),
    check("demo_inbox_text_bounded", sql`length(${t.text}) BETWEEN 1 AND 4000`),
    check("demo_inbox_link_bounded", sql`length(${t.encryptedConfirmUrl}) BETWEEN 1 AND 4096`),
    check(
      "demo_inbox_recipient_normalized",
      sql`${t.recipientEmail} = lower(btrim(${t.recipientEmail})) AND length(${t.recipientEmail}) BETWEEN 4 AND 254`,
    ),
  ],
);
