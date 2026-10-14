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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { applicationClosingPackages, fundingRecords, loanAccounts } from "./closing-schema.js";
import { applicationDecisions } from "./review-schema.js";
import { applications, banks, loanProducts, users } from "./schema.js";

export type FinancingFamily = "sba_7a" | "conventional_term" | "equipment_term";
export type FinancingVariant =
  | "sba_7a_standard"
  | "sba_7a_small"
  | "conventional_term_unsecured"
  | "conventional_term_secured"
  | "equipment_term";
export type FinancingLimitBasis = "program_restriction" | "bank_policy" | "fixture_assumption";
export type FinancingPolicySource = {
  sourceId: string;
  section: string;
  publishedOn: string | null;
  effectiveOn: string | null;
  reviewedOn: string;
};

const money = (name: string) => numeric(name, { precision: 20, scale: 2 });
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const families = sql.raw("('sba_7a','conventional_term','equipment_term')");
const bases = sql.raw("('program_restriction','bank_policy','fixture_assumption')");
const positive = (column: unknown) =>
  sql`(${column} > 0 AND ${column} <> 'NaN'::numeric AND ${column} <> 'Infinity'::numeric)`;

/** Immutable, bank-configured product policy versions; facilities pin the exact version used. */
export const financingProductPolicies = pgTable(
  "financing_product_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => banks.id),
    family: text("family").$type<FinancingFamily>().notNull(),
    variant: text("variant").$type<FinancingVariant>().notNull(),
    version: integer("version").notNull(),
    security: text("security").$type<"secured" | "unsecured">(),
    minimumPrincipal: money("minimum_principal").notNull(),
    maximumPrincipal: money("maximum_principal").notNull(),
    minimumBasis: text("minimum_basis").$type<FinancingLimitBasis>().notNull(),
    maximumBasis: text("maximum_basis").$type<FinancingLimitBasis>().notNull(),
    aggregateMaximum: money("aggregate_maximum"),
    aggregateBasis: text("aggregate_basis").$type<FinancingLimitBasis>(),
    catalogVersion: text("catalog_version").notNull(),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    expiresOn: date("expires_on", { mode: "string" }),
    reviewDueOn: date("review_due_on", { mode: "string" }).notNull(),
    sources: jsonb("sources").$type<FinancingPolicySource[]>().notNull(),
    configurationNote: text("configuration_note").notNull(),
    active: boolean("active").notNull().default(true),
    synthetic: boolean("synthetic").notNull().default(false),
    createdAt: created(),
  },
  (t) => [
    unique("financing_policies_bank_id").on(t.bankId, t.id),
    unique("financing_policies_bank_id_family").on(t.bankId, t.id, t.family),
    unique("financing_policies_variant_version").on(t.bankId, t.variant, t.version),
    check(
      "financing_policies_variant_family",
      sql`(${t.family} = 'sba_7a' AND ${t.variant} IN ('sba_7a_standard','sba_7a_small') AND ${t.security} IS NULL)
        OR (${t.family} = 'conventional_term' AND ((${t.variant} = 'conventional_term_secured' AND ${t.security} = 'secured') OR (${t.variant} = 'conventional_term_unsecured' AND ${t.security} = 'unsecured')))
        OR (${t.family} = 'equipment_term' AND ${t.variant} = 'equipment_term' AND ${t.security} IS NULL)`,
    ),
    check(
      "financing_policies_limits",
      sql`${t.version} > 0 AND ${positive(t.minimumPrincipal)} AND ${positive(t.maximumPrincipal)}
        AND ${t.maximumPrincipal} >= ${t.minimumPrincipal}
        AND ${t.minimumBasis} IN ${bases} AND ${t.maximumBasis} IN ${bases}
        AND ((${t.aggregateMaximum} IS NULL AND ${t.aggregateBasis} IS NULL)
          OR (${positive(t.aggregateMaximum)} AND ${t.aggregateBasis} IN ${bases}))`,
    ),
    check(
      "financing_policies_dates",
      sql`${t.reviewDueOn} >= ${t.effectiveOn} AND (${t.expiresOn} IS NULL OR ${t.expiresOn} > ${t.effectiveOn})
        AND jsonb_typeof(${t.sources}) = 'array' AND length(btrim(${t.configurationNote})) BETWEEN 1 AND 1000`,
    ),
  ],
);

/** Append-only history of the borrower's overall need and product preference. */
export const financingRequestRevisions = pgTable(
  "financing_request_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    revision: integer("revision").notNull(),
    requestedAmount: money("requested_amount"),
    currency: text("currency").notNull().default("USD"),
    productPreference: text("product_preference").$type<FinancingFamily | "help_me_choose">(),
    catalogVersion: text("catalog_version").notNull(),
    reason: text("reason"),
    authorKind: text("author_kind").$type<"applicant" | "staff">().notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
  },
  (t) => [
    unique("financing_requests_revision").on(t.applicationId, t.revision),
    unique("financing_requests_scope_id").on(t.bankId, t.applicationId, t.id),
    foreignKey({
      name: "financing_requests_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check(
      "financing_requests_valid",
      sql`${t.revision} > 0 AND ${t.currency} = 'USD'
        AND (${t.requestedAmount} IS NULL OR ${positive(t.requestedAmount)})
        AND (${t.productPreference} IS NULL OR ${t.productPreference} IN ('sba_7a','conventional_term','equipment_term','help_me_choose'))
        AND (${t.requestedAmount} IS NOT NULL OR ${t.productPreference} IS NOT NULL)
        AND ${t.authorKind} IN ('applicant','staff')
        AND (${t.reason} IS NULL OR length(btrim(${t.reason})) BETWEEN 1 AND 500)
        AND (${t.revision} = 1 OR ${t.reason} IS NOT NULL)`,
    ),
  ],
);

/** One mutable draft per application; publication freezes the revision and its children. */
export const financingStructureRevisions = pgTable(
  "financing_structure_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    state: text("state").$type<"draft" | "published">().notNull(),
    sequence: integer("sequence"),
    draftRevision: integer("draft_revision").notNull().default(1),
    requestRevisionId: uuid("request_revision_id").notNull(),
    basedOnId: uuid("based_on_id"),
    reason: text("reason"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    unique("financing_structures_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("financing_structures_sequence").on(t.applicationId, t.sequence),
    uniqueIndex("financing_structures_one_draft")
      .on(t.applicationId)
      .where(sql`${t.state} = 'draft'`),
    foreignKey({
      name: "financing_structures_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "financing_structures_request_fk",
      columns: [t.bankId, t.applicationId, t.requestRevisionId],
      foreignColumns: [
        financingRequestRevisions.bankId,
        financingRequestRevisions.applicationId,
        financingRequestRevisions.id,
      ],
    }),
    foreignKey({
      name: "financing_structures_based_on_fk",
      columns: [t.bankId, t.applicationId, t.basedOnId],
      foreignColumns: [t.bankId, t.applicationId, t.id],
    }),
    check(
      "financing_structures_state",
      sql`${t.draftRevision} > 0 AND (${t.reason} IS NULL OR length(btrim(${t.reason})) BETWEEN 1 AND 500) AND (
        (${t.state} = 'draft' AND ${t.sequence} IS NULL AND ${t.publishedAt} IS NULL AND ${t.publishedByUserId} IS NULL)
        OR (${t.state} = 'published' AND ${t.sequence} > 0 AND ${t.reason} IS NOT NULL AND ${t.publishedAt} IS NOT NULL AND ${t.publishedByUserId} IS NOT NULL))`,
    ),
    index("financing_structures_application").on(t.bankId, t.applicationId, t.sequence),
  ],
);

/**
 * Stable facility identity. A legacy single-product application maps to one legacy facility that
 * retains its actual product version; structured facilities are introduced by a structure revision.
 */
export const financingFacilities = pgTable(
  "financing_facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    origin: text("origin").$type<"legacy" | "structured">().notNull(),
    ordinal: integer("ordinal").notNull(),
    legacyProductId: uuid("legacy_product_id"),
    introducedInStructureId: uuid("introduced_in_structure_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: created(),
  },
  (t) => [
    unique("financing_facilities_ordinal").on(t.applicationId, t.ordinal),
    unique("financing_facilities_scope_id").on(t.bankId, t.applicationId, t.id),
    unique("financing_facilities_scope_origin").on(t.bankId, t.applicationId, t.id, t.origin),
    uniqueIndex("financing_facilities_one_legacy")
      .on(t.applicationId)
      .where(sql`${t.origin} = 'legacy'`),
    foreignKey({
      name: "financing_facilities_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    foreignKey({
      name: "financing_facilities_legacy_product_fk",
      columns: [t.bankId, t.legacyProductId],
      foreignColumns: [loanProducts.bankId, loanProducts.id],
    }),
    foreignKey({
      name: "financing_facilities_introduced_fk",
      columns: [t.bankId, t.applicationId, t.introducedInStructureId],
      foreignColumns: [
        financingStructureRevisions.bankId,
        financingStructureRevisions.applicationId,
        financingStructureRevisions.id,
      ],
    }),
    check(
      "financing_facilities_origin",
      sql`${t.ordinal} > 0 AND ((${t.origin} = 'legacy' AND ${t.introducedInStructureId} IS NULL)
        OR (${t.origin} = 'structured' AND ${t.legacyProductId} IS NULL AND ${t.introducedInStructureId} IS NOT NULL))`,
    ),
  ],
);

/** A facility's proposed product and exact principal within one structure revision. */
export const financingFacilityVersions = pgTable(
  "financing_facility_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    structureRevisionId: uuid("structure_revision_id").notNull(),
    facilityId: uuid("facility_id").notNull(),
    facilityOrigin: text("facility_origin").$type<"structured">().notNull().default("structured"),
    position: integer("position").notNull(),
    draftKey: text("draft_key").notNull(),
    family: text("family").$type<FinancingFamily>().notNull(),
    security: text("security").$type<"secured" | "unsecured">(),
    productPolicyId: uuid("product_policy_id"),
    principal: money("principal"),
    currency: text("currency").notNull().default("USD"),
    createdAt: created(),
  },
  (t) => [
    unique("financing_versions_facility").on(t.structureRevisionId, t.facilityId),
    unique("financing_versions_key").on(t.structureRevisionId, t.draftKey),
    unique("financing_versions_scope_id").on(
      t.bankId,
      t.applicationId,
      t.structureRevisionId,
      t.id,
    ),
    foreignKey({
      name: "financing_versions_structure_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId],
      foreignColumns: [
        financingStructureRevisions.bankId,
        financingStructureRevisions.applicationId,
        financingStructureRevisions.id,
      ],
    }),
    foreignKey({
      name: "financing_versions_facility_fk",
      columns: [t.bankId, t.applicationId, t.facilityId, t.facilityOrigin],
      foreignColumns: [
        financingFacilities.bankId,
        financingFacilities.applicationId,
        financingFacilities.id,
        financingFacilities.origin,
      ],
    }),
    foreignKey({
      name: "financing_versions_policy_fk",
      columns: [t.bankId, t.productPolicyId, t.family],
      foreignColumns: [
        financingProductPolicies.bankId,
        financingProductPolicies.id,
        financingProductPolicies.family,
      ],
    }),
    check(
      "financing_versions_valid",
      sql`${t.facilityOrigin} = 'structured' AND ${t.position} >= 0 AND ${t.currency} = 'USD'
        AND ${t.draftKey} ~ '^[a-z0-9][a-z0-9_-]{0,39}$' AND ${t.family} IN ${families}
        AND (${t.security} IS NULL OR (${t.family} = 'conventional_term' AND ${t.security} IN ('secured','unsecured')))
        AND (${t.principal} IS NULL OR ${positive(t.principal)})`,
    ),
  ],
);

/** Project costs within a structure revision. */
export const financingUses = pgTable(
  "financing_uses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    structureRevisionId: uuid("structure_revision_id").notNull(),
    position: integer("position").notNull(),
    draftKey: text("draft_key").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
  },
  (t) => [
    unique("financing_uses_key").on(t.structureRevisionId, t.draftKey),
    unique("financing_uses_scope_id").on(t.bankId, t.applicationId, t.structureRevisionId, t.id),
    foreignKey({
      name: "financing_uses_structure_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId],
      foreignColumns: [
        financingStructureRevisions.bankId,
        financingStructureRevisions.applicationId,
        financingStructureRevisions.id,
      ],
    }),
    check(
      "financing_uses_valid",
      sql`${t.position} >= 0 AND ${t.currency} = 'USD' AND ${positive(t.amount)}
        AND ${t.draftKey} ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
        AND ${t.category} IN ('working_capital','equipment_purchase','real_estate_purchase','business_acquisition','property_improvements','construction','refinance_debt','refinance_real_estate','renewable_energy','fees_and_closing_costs','other')
        AND length(btrim(${t.description})) BETWEEN 1 AND 200`,
    ),
  ],
);

/** Explicitly identified borrower or third-party contributions; never inferred to fill a gap. */
export const financingSources = pgTable(
  "financing_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    structureRevisionId: uuid("structure_revision_id").notNull(),
    position: integer("position").notNull(),
    draftKey: text("draft_key").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
  },
  (t) => [
    unique("financing_sources_key").on(t.structureRevisionId, t.draftKey),
    unique("financing_sources_scope_id").on(t.bankId, t.applicationId, t.structureRevisionId, t.id),
    foreignKey({
      name: "financing_sources_structure_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId],
      foreignColumns: [
        financingStructureRevisions.bankId,
        financingStructureRevisions.applicationId,
        financingStructureRevisions.id,
      ],
    }),
    check(
      "financing_sources_valid",
      sql`${t.position} >= 0 AND ${t.currency} = 'USD' AND ${positive(t.amount)}
        AND ${t.draftKey} ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
        AND ${t.kind} IN ('borrower_contribution','seller_financing','other_lender','grant_or_subsidy','other')
        AND length(btrim(${t.description})) BETWEEN 1 AND 200`,
    ),
  ],
);

/** Which facility or source pays which cost. Composite keys keep every link inside one revision. */
export const financingAllocations = pgTable(
  "financing_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    structureRevisionId: uuid("structure_revision_id").notNull(),
    useId: uuid("use_id").notNull(),
    facilityVersionId: uuid("facility_version_id"),
    sourceId: uuid("source_id"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
  },
  (t) => [
    unique("financing_allocations_use_facility").on(t.useId, t.facilityVersionId),
    unique("financing_allocations_use_source").on(t.useId, t.sourceId),
    foreignKey({
      name: "financing_allocations_structure_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId],
      foreignColumns: [
        financingStructureRevisions.bankId,
        financingStructureRevisions.applicationId,
        financingStructureRevisions.id,
      ],
    }),
    foreignKey({
      name: "financing_allocations_use_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId, t.useId],
      foreignColumns: [
        financingUses.bankId,
        financingUses.applicationId,
        financingUses.structureRevisionId,
        financingUses.id,
      ],
    }),
    foreignKey({
      name: "financing_allocations_facility_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId, t.facilityVersionId],
      foreignColumns: [
        financingFacilityVersions.bankId,
        financingFacilityVersions.applicationId,
        financingFacilityVersions.structureRevisionId,
        financingFacilityVersions.id,
      ],
    }),
    foreignKey({
      name: "financing_allocations_source_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId, t.sourceId],
      foreignColumns: [
        financingSources.bankId,
        financingSources.applicationId,
        financingSources.structureRevisionId,
        financingSources.id,
      ],
    }),
    index("financing_allocations_structure").on(t.bankId, t.applicationId, t.structureRevisionId),
    check(
      "financing_allocations_valid",
      sql`num_nonnulls(${t.facilityVersionId}, ${t.sourceId}) = 1 AND ${t.currency} = 'USD' AND ${positive(t.amount)}`,
    ),
  ],
);

/** Split, combination and duplicate history between stable facility identities. */
export const financingFacilityLineage = pgTable(
  "financing_facility_lineage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    structureRevisionId: uuid("structure_revision_id").notNull(),
    kind: text("kind").$type<"split" | "combine" | "duplicate">().notNull(),
    predecessorFacilityId: uuid("predecessor_facility_id").notNull(),
    successorFacilityId: uuid("successor_facility_id").notNull(),
    facilityOrigin: text("facility_origin").$type<"structured">().notNull().default("structured"),
  },
  (t) => [
    unique("financing_lineage_edge").on(
      t.structureRevisionId,
      t.predecessorFacilityId,
      t.successorFacilityId,
    ),
    foreignKey({
      name: "financing_lineage_structure_fk",
      columns: [t.bankId, t.applicationId, t.structureRevisionId],
      foreignColumns: [
        financingStructureRevisions.bankId,
        financingStructureRevisions.applicationId,
        financingStructureRevisions.id,
      ],
    }),
    foreignKey({
      name: "financing_lineage_predecessor_fk",
      columns: [t.bankId, t.applicationId, t.predecessorFacilityId, t.facilityOrigin],
      foreignColumns: [
        financingFacilities.bankId,
        financingFacilities.applicationId,
        financingFacilities.id,
        financingFacilities.origin,
      ],
    }),
    foreignKey({
      name: "financing_lineage_successor_fk",
      columns: [t.bankId, t.applicationId, t.successorFacilityId, t.facilityOrigin],
      foreignColumns: [
        financingFacilities.bankId,
        financingFacilities.applicationId,
        financingFacilities.id,
        financingFacilities.origin,
      ],
    }),
    check(
      "financing_lineage_valid",
      sql`${t.facilityOrigin} = 'structured' AND ${t.kind} IN ('split','combine','duplicate') AND ${t.predecessorFacilityId} <> ${t.successorFacilityId}`,
    ),
  ],
);

/** Actor-bound command receipts; replays with the same payload return the current view. */
export const financingCommands = pgTable(
  "financing_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    operation: text("operation").$type<"save_request" | "save_draft" | "publish">().notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultId: uuid("result_id").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("financing_commands_key").on(t.bankId, t.applicationId, t.idempotencyKey),
    foreignKey({
      name: "financing_commands_application_fk",
      columns: [t.bankId, t.applicationId],
      foreignColumns: [applications.bankId, applications.id],
    }),
    check(
      "financing_commands_valid",
      sql`${t.operation} IN ('save_request','save_draft','publish') AND ${t.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/** Additive mapping from immutable legacy records to the legacy facility; originals stay untouched. */
export const legacyFacilityLinks = pgTable(
  "legacy_facility_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankId: uuid("bank_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    facilityId: uuid("facility_id").notNull(),
    facilityOrigin: text("facility_origin").$type<"legacy">().notNull().default("legacy"),
    decisionId: uuid("decision_id"),
    closingPackageId: uuid("closing_package_id"),
    fundingRecordId: uuid("funding_record_id"),
    loanAccountId: uuid("loan_account_id"),
    createdAt: created(),
  },
  (t) => [
    unique("legacy_links_decision").on(t.decisionId),
    unique("legacy_links_closing_package").on(t.closingPackageId),
    unique("legacy_links_funding_record").on(t.fundingRecordId),
    unique("legacy_links_loan_account").on(t.loanAccountId),
    foreignKey({
      name: "legacy_links_facility_fk",
      columns: [t.bankId, t.applicationId, t.facilityId, t.facilityOrigin],
      foreignColumns: [
        financingFacilities.bankId,
        financingFacilities.applicationId,
        financingFacilities.id,
        financingFacilities.origin,
      ],
    }),
    foreignKey({
      name: "legacy_links_decision_fk",
      columns: [t.bankId, t.applicationId, t.decisionId],
      foreignColumns: [
        applicationDecisions.bankId,
        applicationDecisions.applicationId,
        applicationDecisions.id,
      ],
    }),
    foreignKey({
      name: "legacy_links_closing_package_fk",
      columns: [t.bankId, t.applicationId, t.closingPackageId],
      foreignColumns: [
        applicationClosingPackages.bankId,
        applicationClosingPackages.applicationId,
        applicationClosingPackages.id,
      ],
    }),
    foreignKey({
      name: "legacy_links_funding_record_fk",
      columns: [t.bankId, t.applicationId, t.fundingRecordId],
      foreignColumns: [fundingRecords.bankId, fundingRecords.applicationId, fundingRecords.id],
    }),
    foreignKey({
      name: "legacy_links_loan_account_fk",
      columns: [t.bankId, t.applicationId, t.loanAccountId],
      foreignColumns: [loanAccounts.bankId, loanAccounts.applicationId, loanAccounts.id],
    }),
    check(
      "legacy_links_valid",
      sql`${t.facilityOrigin} = 'legacy' AND num_nonnulls(${t.decisionId}, ${t.closingPackageId}, ${t.fundingRecordId}, ${t.loanAccountId}) = 1`,
    ),
    index("legacy_links_facility").on(t.bankId, t.applicationId, t.facilityId),
  ],
);
