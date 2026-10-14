import { z } from "zod";
import { applicationStatusSchema, usdAmountSchema } from "./common.js";

/**
 * L01 financing foundation. A financing request is the borrower's overall need; a structure
 * revision proposes zero to many facilities. Catalog entries are research/reference data:
 * only the three initial families are executable, and every outcome remains synthetic.
 */
export const financingCatalogVersion = "2026-10-12" as const;
export const financingModeSchema = z.enum(["legacy", "structured"]);
export const financingProductFamilySchema = z.enum([
  "sba_7a",
  "conventional_term",
  "equipment_term",
]);
export const financingProductPreferenceSchema = z.enum([
  ...financingProductFamilySchema.options,
  "help_me_choose",
]);
export const financingProductVariantSchema = z.enum([
  "sba_7a_standard",
  "sba_7a_small",
  "conventional_term_unsecured",
  "conventional_term_secured",
  "equipment_term",
]);
export const financingSecuritySchema = z.enum(["secured", "unsecured"]);
/** A sourced program restriction, a configurable bank policy, or a stand-in demo assumption. */
export const financingLimitBasisSchema = z.enum([
  "program_restriction",
  "bank_policy",
  "fixture_assumption",
]);
export const financingUseCategorySchema = z.enum([
  "working_capital",
  "equipment_purchase",
  "real_estate_purchase",
  "business_acquisition",
  "property_improvements",
  "construction",
  "refinance_debt",
  "refinance_real_estate",
  "renewable_energy",
  "fees_and_closing_costs",
  "other",
]);
export const financingSourceKindSchema = z.enum([
  "borrower_contribution",
  "seller_financing",
  "other_lender",
  "grant_or_subsidy",
  "other",
]);
export const financingLineageKindSchema = z.enum(["split", "combine", "duplicate"]);

export const financingSourceIdSchema = z.enum([
  "sba-7a",
  "sba-lenders",
  "sba-504",
  "sba-micro",
  "sba-coordination",
  "key-small",
  "key-equipment",
  "key-abl",
  "key-cre",
  "occ-cre",
]);
type SourceId = z.infer<typeof financingSourceIdSchema>;
const accessedOn = "2026-10-12";
/** Dated public references for catalog claims. Never fetched at runtime or in the browser. */
export const financingSources = {
  "sba-7a": {
    title: "SBA 7(a) loans overview",
    url: "https://www.sba.gov/loans/7a-loans/",
    accessedOn,
  },
  "sba-lenders": {
    title: "SBA lender resources",
    url: "https://www.sba.gov/sba-lenders/",
    accessedOn,
  },
  "sba-504": { title: "SBA 504 loans", url: "https://www.sba.gov/loans/504-loans/", accessedOn },
  "sba-micro": {
    title: "SBA Microloans",
    url: "https://www.sba.gov/loans/microloans/",
    accessedOn,
  },
  "sba-coordination": {
    title: "SBA Policy Notice 5000-879058 (7(a) and 504 coordination)",
    url: "https://legacy.sba.gov/document/policy-notice-5000-879058-coordination-7a-504-maximum-loan-limits",
    accessedOn,
  },
  "key-small": {
    title: "KeyBank small business loans and lines",
    url: "https://www.key.com/small-business/banking/loans-lines/index.html",
    accessedOn,
  },
  "key-equipment": {
    title: "Key Equipment Finance",
    url: "https://www.key.com/businesses-institutions/solutions/financing/key-equipment-finance.html",
    accessedOn,
  },
  "key-abl": {
    title: "Key asset-based lending",
    url: "https://www.key.com/businesses-institutions/solutions/financing/asset-based-lending.html",
    accessedOn,
  },
  "key-cre": {
    title: "Key commercial mortgage financing",
    url: "https://www.key.com/businesses-institutions/industry-expertise/commercial-real-estate/capital-commercial-mortgage-production.html",
    accessedOn,
  },
  "occ-cre": {
    title: "OCC Comptroller's Handbook: Commercial Real Estate Lending",
    url: "https://www.occ.gov/publications-and-resources/publications/comptrollers-handbook/files/commercial-real-estate-lending/pub-ch-commercial-real-estate.pdf",
    accessedOn,
  },
} as const satisfies Record<SourceId, { title: string; url: string; accessedOn: string }>;

type Family = z.infer<typeof financingProductFamilySchema>;
type Variant = z.infer<typeof financingProductVariantSchema>;
type CatalogEntry = {
  number: number;
  key: string;
  name: string;
  distinction: string;
  support: "initial" | "reference";
  family: Family | null;
  sourceIds: readonly SourceId[];
};
/** The 19 researched types and variants. "initial" entries are the only executable products. */
export const financingProductCatalog = [
  {
    number: 1,
    key: "sba_7a_standard",
    name: "Standard SBA 7(a) term loan",
    distinction: "Broad business purposes; above $350,000 through $5 million",
    support: "initial",
    family: "sba_7a",
    sourceIds: ["sba-lenders", "sba-7a"],
  },
  {
    number: 2,
    key: "sba_7a_small",
    name: "SBA 7(a) Small",
    distinction: "Term lending at $350,000 or less; separate processing rules",
    support: "initial",
    family: "sba_7a",
    sourceIds: ["sba-lenders"],
  },
  {
    number: 3,
    key: "sba_express",
    name: "SBA Express",
    distinction: "Delegated method; up to $500,000; term or revolving structure",
    support: "reference",
    family: null,
    sourceIds: ["sba-lenders"],
  },
  {
    number: 4,
    key: "sba_working_capital_pilot",
    name: "SBA Working Capital Pilot",
    distinction: "Monitored working-capital credit line",
    support: "reference",
    family: null,
    sourceIds: ["sba-7a"],
  },
  {
    number: 5,
    key: "sba_caplines",
    name: "SBA CAPLines",
    distinction: "Seasonal, contract, builders and working-capital variants",
    support: "reference",
    family: null,
    sourceIds: ["sba-lenders"],
  },
  {
    number: 6,
    key: "sba_export_express",
    name: "SBA Export Express",
    distinction: "Smaller export-related financing",
    support: "reference",
    family: null,
    sourceIds: ["sba-lenders"],
  },
  {
    number: 7,
    key: "sba_export_working_capital",
    name: "SBA Export Working Capital",
    distinction: "Financing export transactions",
    support: "reference",
    family: null,
    sourceIds: ["sba-lenders"],
  },
  {
    number: 8,
    key: "sba_international_trade",
    name: "SBA International Trade",
    distinction: "Eligible export expansion or import-competition needs",
    support: "reference",
    family: null,
    sourceIds: ["sba-lenders"],
  },
  {
    number: 9,
    key: "sba_504",
    name: "SBA 504 project financing",
    distinction: "Eligible fixed assets; bank/CDC/borrower structure; multi-source model reserved",
    support: "reference",
    family: null,
    sourceIds: ["sba-504", "sba-coordination"],
  },
  {
    number: 10,
    key: "sba_microloan",
    name: "SBA Microloan",
    distinction: "Up to $50,000 through nonprofit intermediaries; referral, not bank-originated",
    support: "reference",
    family: null,
    sourceIds: ["sba-micro"],
  },
  {
    number: 11,
    key: "conventional_term_unsecured",
    name: "Conventional unsecured business term loan",
    distinction: "A fixed advance without pledged collateral",
    support: "initial",
    family: "conventional_term",
    sourceIds: ["key-small"],
  },
  {
    number: 12,
    key: "conventional_term_secured",
    name: "Conventional secured business term loan",
    distinction: "A fixed advance with specified collateral",
    support: "initial",
    family: "conventional_term",
    sourceIds: ["key-small"],
  },
  {
    number: 13,
    key: "equipment_term",
    name: "Equipment term loan",
    distinction: "Finance identified equipment; distinguish a loan from a lease",
    support: "initial",
    family: "equipment_term",
    sourceIds: ["key-equipment"],
  },
  {
    number: 14,
    key: "unsecured_line_of_credit",
    name: "Unsecured business line of credit",
    distinction: "Working-capital commitment and later advances",
    support: "reference",
    family: null,
    sourceIds: ["key-small"],
  },
  {
    number: 15,
    key: "secured_revolving_line",
    name: "Secured or asset-based revolving line",
    distinction: "Credit supported by business assets; borrowing-base controls where applicable",
    support: "reference",
    family: null,
    sourceIds: ["key-abl"],
  },
  {
    number: 16,
    key: "owner_occupied_cre_mortgage",
    name: "Owner-occupied commercial mortgage",
    distinction: "Business-use property acquisition/refinancing",
    support: "reference",
    family: null,
    sourceIds: ["key-small"],
  },
  {
    number: 17,
    key: "investor_cre_term_loan",
    name: "Investor commercial real-estate term loan",
    distinction: "Income-producing property financing",
    support: "reference",
    family: null,
    sourceIds: ["key-cre"],
  },
  {
    number: 18,
    key: "commercial_construction_loan",
    name: "Commercial construction loan",
    distinction: "Construction/renovation with controlled advances",
    support: "reference",
    family: null,
    sourceIds: ["occ-cre"],
  },
  {
    number: 19,
    key: "cre_bridge_loan",
    name: "Commercial real-estate bridge loan",
    distinction: "Short-term financing pending stabilization and permanent financing/sale",
    support: "reference",
    family: null,
    sourceIds: ["occ-cre"],
  },
] as const satisfies readonly CatalogEntry[];

export const financingProductFamilies = [
  {
    key: "sba_7a",
    name: "SBA 7(a) term loan",
    variants: ["sba_7a_standard", "sba_7a_small"],
    resolvedBy: "principal",
  },
  {
    key: "conventional_term",
    name: "Conventional business term loan",
    variants: ["conventional_term_unsecured", "conventional_term_secured"],
    resolvedBy: "security",
  },
  {
    key: "equipment_term",
    name: "Equipment term loan",
    variants: ["equipment_term"],
    resolvedBy: "single",
  },
] as const satisfies readonly {
  key: Family;
  name: string;
  variants: readonly Variant[];
  resolvedBy: "principal" | "security" | "single";
}[];
export const financingPreferenceLabels = {
  sba_7a: "SBA 7(a) term loan",
  conventional_term: "Conventional business term loan",
  equipment_term: "Equipment term loan",
  help_me_choose: "Help me choose",
} as const satisfies Record<z.infer<typeof financingProductPreferenceSchema>, string>;
export function financingVariantName(variant: Variant): string {
  return financingProductCatalog.find((entry) => entry.key === variant)?.name ?? variant;
}
export function financingFamilyName(family: Family): string {
  return financingProductFamilies.find((entry) => entry.key === family)?.name ?? family;
}

/**
 * Lifecycle capabilities for structured packages. Credit decisions, offers, closing and
 * funding stay unavailable until their owning L-tasks implement and verify them.
 */
export const structuredFinancingLifecycle = {
  version: 1,
  creditDecision: "unavailable",
  offerAcceptance: "unavailable",
  closing: "unavailable",
  funding: "unavailable",
} as const;
export const financingLifecycleSchema = z.object({
  version: z.number().int().positive(),
  creditDecision: z.enum(["legacy_amount_approval", "unavailable"]),
  offerAcceptance: z.enum(["not_applicable", "unavailable"]),
  closing: z.enum(["legacy_single_package", "unavailable"]),
  funding: z.enum(["legacy_single_funding", "unavailable"]),
});

/** Exact USD arithmetic on decimal strings; never round-trip money through floating point. */
export function usdToCents(amount: string): bigint {
  if (!usdAmountSchema.safeParse(amount).success) throw new Error("Invalid USD amount.");
  return BigInt(amount.replace(".", ""));
}
export function centsToUsd(cents: bigint): string {
  if (cents < 0n) throw new Error("USD amounts in financing views are never negative.");
  const digits = cents.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
// Zod 4 runs refinements even after the format check fails, so this must never throw.
export const positiveUsdAmountSchema = usdAmountSchema.refine(
  (value) => value !== "0.00",
  "Enter an amount greater than zero.",
);

const command = {
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
};
const reasonSchema = z.string().trim().min(1).max(500);
const keySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

export const saveFinancingRequestSchema = z
  .strictObject({
    ...command,
    requestedAmount: positiveUsdAmountSchema.nullable(),
    productPreference: financingProductPreferenceSchema.nullable(),
    reason: reasonSchema.optional(),
  })
  .refine((input) => input.requestedAmount !== null || input.productPreference !== null, {
    message: "Provide the financing need or a product preference.",
    path: ["requestedAmount"],
  });

export const financingDraftFacilitySchema = z
  .strictObject({
    key: keySchema,
    /** Continue an existing facility identity; omit to introduce a new facility. */
    facilityId: z.string().uuid().optional(),
    family: financingProductFamilySchema,
    security: financingSecuritySchema.nullable().optional(),
    principal: positiveUsdAmountSchema.nullable(),
  })
  .refine((facility) => facility.family === "conventional_term" || !facility.security, {
    message: "Secured or unsecured applies only to conventional term facilities.",
    path: ["security"],
  });
export const financingDraftUseSchema = z.strictObject({
  key: keySchema,
  category: financingUseCategorySchema,
  description: z.string().trim().min(1).max(200),
  amount: positiveUsdAmountSchema,
});
export const financingDraftSourceSchema = z.strictObject({
  key: keySchema,
  kind: financingSourceKindSchema,
  description: z.string().trim().min(1).max(200),
  amount: positiveUsdAmountSchema,
});
export const financingDraftAllocationSchema = z
  .strictObject({
    useKey: keySchema,
    facilityKey: keySchema.optional(),
    sourceKey: keySchema.optional(),
    amount: positiveUsdAmountSchema,
  })
  .refine((allocation) => !!allocation.facilityKey !== !!allocation.sourceKey, {
    message: "Allocate each amount from exactly one facility or one source.",
    path: ["facilityKey"],
  });
export const financingDraftLineageSchema = z
  .strictObject({
    kind: financingLineageKindSchema,
    predecessorFacilityIds: z.array(z.string().uuid()).min(1).max(10),
    successorKeys: z.array(keySchema).min(1).max(10),
  })
  .superRefine((entry, context) => {
    const predecessors = entry.predecessorFacilityIds.length;
    const successors = entry.successorKeys.length;
    const valid =
      entry.kind === "split"
        ? predecessors === 1 && successors >= 2
        : entry.kind === "combine"
          ? predecessors >= 2 && successors === 1
          : predecessors === 1 && successors === 1;
    if (!valid)
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message:
          "A split has one predecessor and several successors; a combination has several predecessors and one successor; a duplicate has one of each.",
      });
    if (new Set(entry.predecessorFacilityIds).size !== predecessors)
      context.addIssue({ code: "custom", path: ["predecessorFacilityIds"], message: "Duplicate." });
    if (new Set(entry.successorKeys).size !== successors)
      context.addIssue({ code: "custom", path: ["successorKeys"], message: "Duplicate." });
  });

/** A complete replacement of the mutable draft. Hard errors fail; incomplete drafts save with findings. */
export const saveFinancingDraftSchema = z
  .strictObject({
    idempotencyKey: z.string().uuid(),
    /** Null creates a draft from the latest published revision; otherwise the current draft revision. */
    expectedDraftRevision: z.number().int().positive().nullable(),
    facilities: z.array(financingDraftFacilitySchema).max(20),
    uses: z.array(financingDraftUseSchema).max(50),
    sources: z.array(financingDraftSourceSchema).max(20),
    allocations: z.array(financingDraftAllocationSchema).max(200),
    lineage: z.array(financingDraftLineageSchema).max(20),
  })
  .superRefine((draft, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    const unique = (values: string[], path: string) => {
      if (new Set(values).size !== values.length) issue([path], "Each key must be unique.");
    };
    unique(
      draft.facilities.map((f) => f.key),
      "facilities",
    );
    unique(
      draft.uses.map((u) => u.key),
      "uses",
    );
    unique(
      draft.sources.map((s) => s.key),
      "sources",
    );
    const continued = draft.facilities.flatMap((f) => (f.facilityId ? [f.facilityId] : []));
    if (new Set(continued).size !== continued.length)
      issue(["facilities"], "A facility can appear only once in a structure.");
    const facilities = new Set(draft.facilities.map((f) => f.key));
    const uses = new Set(draft.uses.map((u) => u.key));
    const sources = new Set(draft.sources.map((s) => s.key));
    const pairs = new Set<string>();
    draft.allocations.forEach((allocation, index) => {
      if (!uses.has(allocation.useKey)) issue(["allocations", index, "useKey"], "Unknown use.");
      if (allocation.facilityKey && !facilities.has(allocation.facilityKey))
        issue(["allocations", index, "facilityKey"], "Unknown facility.");
      if (allocation.sourceKey && !sources.has(allocation.sourceKey))
        issue(["allocations", index, "sourceKey"], "Unknown source.");
      const pair = `${allocation.useKey}|${allocation.facilityKey ? `f:${allocation.facilityKey}` : `s:${allocation.sourceKey}`}`;
      if (pairs.has(pair))
        issue(["allocations", index], "A cost can be allocated from each funder only once.");
      pairs.add(pair);
    });
    const successorKeys = draft.lineage.flatMap((entry) => entry.successorKeys);
    if (new Set(successorKeys).size !== successorKeys.length)
      issue(["lineage"], "A facility can descend from only one lineage entry.");
    for (const key of successorKeys) {
      const successor = draft.facilities.find((f) => f.key === key);
      if (!successor) issue(["lineage"], "Lineage successors must be facilities in this draft.");
      else if (successor.facilityId)
        issue(["lineage"], "Lineage successors must be newly introduced facilities.");
    }
    const replaced = draft.lineage
      .filter((entry) => entry.kind !== "duplicate")
      .flatMap((entry) => entry.predecessorFacilityIds);
    if (new Set(replaced).size !== replaced.length)
      issue(["lineage"], "A facility can be split or combined only once per revision.");
    if (replaced.some((id) => continued.includes(id)))
      issue(["lineage"], "A split or combined facility is replaced by its successors.");
  });
export const publishFinancingDraftSchema = z.strictObject({
  ...command,
  expectedDraftRevision: z.number().int().positive(),
  reason: reasonSchema,
});

export const financingFindingCodeSchema = z.enum([
  "request_need_missing",
  "request_changed",
  "request_unconfirmed",
  "no_facilities",
  "facility_amount_missing",
  "facility_security_missing",
  "product_policy_unavailable",
  "product_policy_review_overdue",
  "facility_below_minimum",
  "facility_above_maximum",
  "program_aggregate_exceeded",
  "program_exposure_unknown",
  "financing_gap",
  "financing_exceeds_request",
  "uses_missing",
  "uses_unreconciled",
  "allocation_incomplete",
  "reduced_financing",
  "credit_decision_unavailable",
  "funding_unavailable",
]);
export const financingGateSchema = z.enum(["publication", "approval", "funding"]);
export const financingFindingSchema = z.object({
  code: financingFindingCodeSchema,
  blocks: z.array(financingGateSchema),
  message: z.string(),
  facilityId: z.string().uuid().nullable(),
  amount: usdAmountSchema.nullable(),
  basis: financingLimitBasisSchema.nullable(),
});
export const financingTotalsSchema = z.object({
  requestedNeed: usdAmountSchema.nullable(),
  financing: usdAmountSchema,
  contributions: usdAmountSchema,
  projectCost: usdAmountSchema.nullable(),
  financingGap: usdAmountSchema,
  financingExcess: usdAmountSchema,
  unallocatedCost: usdAmountSchema,
});
const policySummarySchema = z.object({
  id: z.string().uuid(),
  variant: financingProductVariantSchema,
  version: z.number().int().positive(),
  minimum: usdAmountSchema,
  maximum: usdAmountSchema,
  minimumBasis: financingLimitBasisSchema,
  maximumBasis: financingLimitBasisSchema,
});
export const financingFacilityViewSchema = z.object({
  facilityId: z.string().uuid(),
  versionId: z.string().uuid(),
  ordinal: z.number().int().positive(),
  key: z.string(),
  family: financingProductFamilySchema,
  security: financingSecuritySchema.nullable(),
  variant: financingProductVariantSchema.nullable(),
  productName: z.string(),
  policy: policySummarySchema.nullable(),
  principal: usdAmountSchema.nullable(),
  allocated: usdAmountSchema,
  lineage: z.array(
    z.object({
      kind: financingLineageKindSchema,
      predecessorFacilityId: z.string().uuid(),
      predecessorOrdinal: z.number().int().positive(),
    }),
  ),
});
export const financingStructureViewSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["draft", "published"]),
  sequence: z.number().int().positive().nullable(),
  draftRevision: z.number().int().positive(),
  requestRevision: z.number().int().positive(),
  basedOnSequence: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  facilities: z.array(financingFacilityViewSchema),
  uses: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string(),
      category: financingUseCategorySchema,
      description: z.string(),
      amount: usdAmountSchema,
      allocated: usdAmountSchema,
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string(),
      kind: financingSourceKindSchema,
      description: z.string(),
      amount: usdAmountSchema,
      allocated: usdAmountSchema,
    }),
  ),
  allocations: z.array(
    z.object({
      id: z.string().uuid(),
      useId: z.string().uuid(),
      facilityId: z.string().uuid().nullable(),
      sourceId: z.string().uuid().nullable(),
      amount: usdAmountSchema,
    }),
  ),
  totals: financingTotalsSchema,
  findings: z.array(financingFindingSchema),
  ready: z.object({ publication: z.boolean(), approval: z.boolean(), funding: z.boolean() }),
});
export const financingRequestViewSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  requestedAmount: usdAmountSchema.nullable(),
  productPreference: financingProductPreferenceSchema.nullable(),
  catalogVersion: z.string(),
  reason: z.string().nullable(),
  authorKind: z.enum(["applicant", "staff"]),
  confirmedByApplicant: z.boolean(),
  createdAt: z.string().datetime(),
});
export const financingProductPolicyViewSchema = policySummarySchema.extend({
  family: financingProductFamilySchema,
  name: z.string(),
  security: financingSecuritySchema.nullable(),
  aggregateMaximum: usdAmountSchema.nullable(),
  aggregateBasis: financingLimitBasisSchema.nullable(),
  effectiveOn: z.string().date(),
  expiresOn: z.string().date().nullable(),
  reviewDueOn: z.string().date(),
  sources: z.array(
    z.object({
      sourceId: financingSourceIdSchema,
      section: z.string(),
      publishedOn: z.string().date().nullable(),
      effectiveOn: z.string().date().nullable(),
      reviewedOn: z.string().date(),
    }),
  ),
  configurationNote: z.string(),
});
export const financingCapabilitySchema = z.enum([
  "saveRequest",
  "saveDraft",
  "publish",
  "approve",
  "fund",
]);
export const financingViewSchema = z.object({
  applicationId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: applicationStatusSchema,
  mode: financingModeSchema,
  simulated: z.literal(true),
  catalogVersion: z.string(),
  canManage: z.boolean(),
  lifecycle: financingLifecycleSchema,
  capabilities: z.object({
    saveRequest: z.boolean(),
    saveDraft: z.boolean(),
    publish: z.boolean(),
    approve: z.boolean(),
    fund: z.boolean(),
  }),
  unavailable: z.array(z.object({ capability: financingCapabilitySchema, reason: z.string() })),
  request: financingRequestViewSchema.nullable(),
  requestHistory: z.array(financingRequestViewSchema),
  draft: financingStructureViewSchema.nullable(),
  published: financingStructureViewSchema.nullable(),
  publishedHistory: z.array(
    z.object({
      id: z.string().uuid(),
      sequence: z.number().int().positive(),
      requestRevision: z.number().int().positive(),
      reason: z.string().nullable(),
      publishedAt: z.string().datetime(),
      facilityCount: z.number().int().nonnegative(),
      financing: usdAmountSchema,
    }),
  ),
  legacy: z
    .object({
      facilityId: z.string().uuid().nullable(),
      productName: z.string().nullable(),
      productVersion: z.number().int().positive().nullable(),
      requestedAmount: usdAmountSchema.nullable(),
      approvedAmount: usdAmountSchema.nullable(),
      fundedAmount: usdAmountSchema.nullable(),
      loanAccountId: z.string().uuid().nullable(),
    })
    .nullable(),
  products: z.array(financingProductPolicyViewSchema),
});

export type FinancingMode = z.infer<typeof financingModeSchema>;
export type FinancingProductFamily = Family;
export type FinancingProductVariant = Variant;
export type FinancingProductPreference = z.infer<typeof financingProductPreferenceSchema>;
export type FinancingSecurity = z.infer<typeof financingSecuritySchema>;
export type FinancingLimitBasis = z.infer<typeof financingLimitBasisSchema>;
export type FinancingFinding = z.infer<typeof financingFindingSchema>;
export type FinancingFindingCode = z.infer<typeof financingFindingCodeSchema>;
export type FinancingGate = z.infer<typeof financingGateSchema>;
export type FinancingTotals = z.infer<typeof financingTotalsSchema>;
export type FinancingView = z.infer<typeof financingViewSchema>;
export type FinancingStructureView = z.infer<typeof financingStructureViewSchema>;
export type SaveFinancingRequest = z.infer<typeof saveFinancingRequestSchema>;
export type SaveFinancingDraft = z.infer<typeof saveFinancingDraftSchema>;
export type PublishFinancingDraft = z.infer<typeof publishFinancingDraftSchema>;
