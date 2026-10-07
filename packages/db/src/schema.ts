import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const synthetic = () => boolean("synthetic").notNull().default(false);

export const bankRole = pgEnum("bank_role", ["officer", "admin"]);
export const participantRole = pgEnum("participant_role", ["applicant_admin", "owner", "adviser"]);
export const participantScope = pgEnum("participant_scope", ["full", "assigned"]);
export const applicationStatus = pgEnum("application_status", [
  "draft",
  "collecting_information",
  "submitted",
  "in_review",
  "needs_information",
  "approved",
  "declined",
  "closing",
  "funded",
  "withdrawn",
]);
export const applicationSource = pgEnum("application_source", ["borrower", "staff", "seed"]);
export const actorType = pgEnum("actor_type", ["user", "system"]);

export const banks = pgTable("banks", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  synthetic: synthetic(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "users_email_normalized",
      sql`${t.email} = lower(btrim(${t.email})) AND length(${t.email}) > 3`,
    ),
  ],
);

export const applicantContacts = pgTable(
  "applicant_contacts",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => users.id),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("contacts_bank_id_id").on(t.bankId, t.id),
    unique("contacts_bank_email").on(t.bankId, t.email),
    check(
      "contacts_email_normalized",
      sql`${t.email} = lower(btrim(${t.email})) AND length(${t.email}) > 3`,
    ),
  ],
);

export const bankMemberships = pgTable(
  "bank_memberships",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: bankRole("role").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("memberships_bank_user").on(t.bankId, t.userId)],
);

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    legalName: text("legal_name").notNull(),
    industryCode: text("industry_code"),
    revision: integer("revision").notNull().default(1),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("businesses_bank_id_id").on(t.bankId, t.id),
    check("businesses_revision_positive", sql`${t.revision} > 0`),
  ],
);

export const loanProducts = pgTable(
  "loan_products",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    minimumAmount: numeric("minimum_amount", { precision: 20, scale: 2 }).notNull(),
    maximumAmount: numeric("maximum_amount", { precision: 20, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("products_bank_id_id").on(t.bankId, t.id),
    unique("products_bank_slug_version").on(t.bankId, t.slug, t.version),
    check("products_version_positive", sql`${t.version} > 0`),
    check(
      "products_amount_range",
      sql`${t.minimumAmount} > 0 AND ${t.maximumAmount} >= ${t.minimumAmount} AND ${t.maximumAmount} <> 'NaN'::numeric`,
    ),
    check("products_currency_usd", sql`${t.currency} = 'USD'`),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    businessId: uuid("business_id"),
    businessName: text("business_name"),
    contactId: uuid("contact_id"),
    productId: uuid("product_id"),
    requestedAmount: numeric("requested_amount", { precision: 20, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    purpose: text("purpose"),
    industryCode: text("industry_code"),
    industryTaxonomyVersion: text("industry_taxonomy_version"),
    source: applicationSource("source").notNull(),
    status: applicationStatus("status").notNull().default("draft"),
    assignedStaffId: uuid("assigned_staff_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    revision: integer("revision").notNull().default(1),
    demoCreated: boolean("demo_created").notNull().default(false),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("applications_bank_id_id").on(t.bankId, t.id),
    foreignKey({
      name: "applications_business_bank_fk",
      columns: [t.bankId, t.businessId],
      foreignColumns: [businesses.bankId, businesses.id],
    }),
    foreignKey({
      name: "applications_contact_bank_fk",
      columns: [t.bankId, t.contactId],
      foreignColumns: [applicantContacts.bankId, applicantContacts.id],
    }),
    foreignKey({
      name: "applications_product_bank_fk",
      columns: [t.bankId, t.productId],
      foreignColumns: [loanProducts.bankId, loanProducts.id],
    }),
    foreignKey({
      name: "applications_assignee_bank_fk",
      columns: [t.bankId, t.assignedStaffId],
      foreignColumns: [bankMemberships.bankId, bankMemberships.userId],
    }),
    check(
      "applications_amount_positive",
      sql`${t.requestedAmount} IS NULL OR (${t.requestedAmount} > 0 AND ${t.requestedAmount} <> 'NaN'::numeric)`,
    ),
    check("applications_currency_usd", sql`${t.currency} = 'USD'`),
    check("applications_revision_positive", sql`${t.revision} > 0`),
    index("applications_bank_created_id").on(t.bankId, t.createdAt, t.id),
    index("applications_bank_updated_id").on(t.bankId, t.updatedAt, t.id),
  ],
);

export const applicationSetups = pgTable(
  "application_setups",
  {
    applicationId: uuid("application_id").primaryKey(),
    bankId: uuid("bank_id").notNull(),
    definitionVersion: integer("definition_version").notNull().default(1),
    currentStep: text("current_step").notNull().default("business_name"),
    completedSteps: text("completed_steps").array().notNull().default(sql`ARRAY[]::text[]`),
    skippedSteps: text("skipped_steps").array().notNull().default(sql`ARRAY[]::text[]`),
    revision: integer("revision").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id),
  },
  (t) => [
    foreignKey({
      name: "setups_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check("setups_definition_version_positive", sql`${t.definitionVersion} > 0`),
    check("setups_revision_positive", sql`${t.revision} > 0`),
    check(
      "setups_current_step_valid",
      sql`${t.currentStep} IN ('business_name', 'product', 'amount', 'purpose', 'industry', 'review')`,
    ),
    check(
      "setups_completed_steps_valid",
      sql`${t.completedSteps} <@ ARRAY['business_name', 'product', 'amount', 'purpose', 'industry', 'review']::text[]`,
    ),
    check("setups_skipped_steps_optional", sql`${t.skippedSteps} <@ ARRAY['industry']::text[]`),
    check("setups_steps_disjoint", sql`NOT (${t.completedSteps} && ${t.skippedSteps})`),
  ],
);

export const applicationRequests = pgTable(
  "application_requests",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    applicationId: uuid("application_id").notNull(),
    operation: text("operation").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("application_requests_scope_key").on(t.bankId, t.scope, t.operation, t.keyHash),
    foreignKey({
      name: "requests_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check("application_requests_key_hash_sha256", sql`${t.keyHash} ~ '^[a-f0-9]{64}$'`),
    check("application_requests_payload_hash_sha256", sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const applicationParticipants = pgTable(
  "application_participants",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    applicationId: uuid("application_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: participantRole("role").notNull(),
    scope: participantScope("scope").notNull().default("assigned"),
    taskIds: uuid("task_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    documentIds: uuid("document_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("participants_application_user").on(t.applicationId, t.userId),
    foreignKey({
      name: "participants_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    index("participants_user_bank").on(t.userId, t.bankId),
  ],
);

// A business relationship records a person; it never creates an identity or portal grant.
// applicationId is the disclosure boundary, even when the business has multiple applications.
export const businessRelationships = pgTable(
  "business_relationships",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    businessId: uuid("business_id").notNull(),
    displayName: text("display_name").notNull(),
    kind: text("kind").$type<"owner" | "contact">().notNull(),
    ownershipPercent: numeric("ownership_percent", { precision: 5, scale: 2 }),
    userId: uuid("user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "relationships_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "relationships_business_bank_fk",
      columns: [t.bankId, t.businessId],
      foreignColumns: [businesses.bankId, businesses.id],
    }),
    check("relationships_kind_valid", sql`${t.kind} IN ('owner', 'contact')`),
    check("relationships_name_valid", sql`length(btrim(${t.displayName})) BETWEEN 1 AND 160`),
    check(
      "relationships_percentage_valid",
      sql`${t.ownershipPercent} IS NULL OR (${t.kind} = 'owner' AND ${t.ownershipPercent} >= 0 AND ${t.ownershipPercent} <= 100)`,
    ),
    index("relationships_application").on(t.bankId, t.applicationId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    email: text("email").notNull(),
    role: participantRole("role").notNull(),
    scope: participantScope("scope").notNull().default("assigned"),
    taskIds: uuid("task_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    documentIds: uuid("document_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    inviterUserId: uuid("inviter_user_id")
      .notNull()
      .references(() => users.id),
    inviterKind: text("inviter_kind").$type<"staff" | "participant">().notNull(),
    // A removed/reinstated grant is a new authority generation; it cannot revive old invitations.
    inviterGrantId: uuid("inviter_grant_id").notNull(),
    inviterGrantUpdatedAt: timestamp("inviter_grant_updated_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"pending" | "accepted" | "revoked">().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    synthetic: synthetic(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("invitations_bank_id_id").on(t.bankId, t.id),
    foreignKey({
      name: "invitations_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check(
      "invitations_email_normalized",
      sql`${t.email} = lower(btrim(${t.email})) AND length(${t.email}) > 3`,
    ),
    check("invitations_status_valid", sql`${t.status} IN ('pending', 'accepted', 'revoked')`),
    check("invitations_inviter_kind_valid", sql`${t.inviterKind} IN ('staff', 'participant')`),
    check(
      "invitations_admin_scope_valid",
      sql`${t.role} <> 'applicant_admin' OR ${t.scope} = 'full'`,
    ),
    index("invitations_application").on(t.bankId, t.applicationId),
  ],
);

// Payload/key hashes prevent retries from sending duplicate emails or reinterpreting commands.
export const participantCommands = pgTable(
  "participant_commands",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    operation: text("operation").notNull(),
    keyHash: text("key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultId: uuid("result_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "participant_commands_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    unique("participant_commands_scope_key").on(
      t.bankId,
      t.applicationId,
      t.actorUserId,
      t.operation,
      t.keyHash,
    ),
    check("participant_commands_key_hash_valid", sql`${t.keyHash} ~ '^[a-f0-9]{64}$'`),
    check("participant_commands_payload_hash_valid", sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

// Internal staff content; never joined by borrower read models.
export const staffNotes = pgTable(
  "staff_notes",
  {
    id: id(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    body: text("body").notNull(),
    authorUserId: uuid("author_user_id").notNull(),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "staff_notes_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "staff_notes_author_bank_fk",
      columns: [t.bankId, t.authorUserId],
      foreignColumns: [bankMemberships.bankId, bankMemberships.userId],
    }),
    foreignKey({
      name: "staff_notes_editor_bank_fk",
      columns: [t.bankId, t.updatedByUserId],
      foreignColumns: [bankMemberships.bankId, bankMemberships.userId],
    }),
    check("staff_notes_body_length", sql`length(btrim(${t.body})) BETWEEN 1 AND 5000`),
    index("staff_notes_bank_application_created").on(t.bankId, t.applicationId, t.createdAt, t.id),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    applicationId: uuid("application_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorType: actorType("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    changedFields: text("changed_fields").array().notNull().default(sql`ARRAY[]::text[]`),
    requestId: text("request_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "audit_application_bank_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check(
      "audit_actor_user_required",
      sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL) OR (${t.actorType} = 'system' AND ${t.actorUserId} IS NULL)`,
    ),
    index("audit_bank_application_created").on(t.bankId, t.applicationId, t.createdAt),
  ],
);
