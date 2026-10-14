import type {
  FinancingFamily,
  FinancingLimitBasis,
  FinancingPolicySource,
  FinancingVariant,
} from "./financing-schema.js";

const reviewedOn = "2026-10-12";
const cite = (section: string, sourceId = "sba-7a"): FinancingPolicySource => ({
  sourceId,
  section,
  publishedOn: null,
  effectiveOn: null,
  reviewedOn,
});
const sbaNote =
  "Synthetic Keybank demo configuration. Individual SBA 7(a) limits follow the cited SBA pages as reviewed on 2026-10-12; the package-level 7(a) total is a conservative demo assumption pending exposure review. This is not an SBA eligibility determination.";
const bankNote =
  "Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank's actual credit policy; the cited page is a product example only.";

export type FinancingPolicyFixture = {
  family: FinancingFamily;
  variant: FinancingVariant;
  version: number;
  security: "secured" | "unsecured" | null;
  minimumPrincipal: string;
  maximumPrincipal: string;
  minimumBasis: FinancingLimitBasis;
  maximumBasis: FinancingLimitBasis;
  aggregateMaximum: string | null;
  aggregateBasis: FinancingLimitBasis | null;
  catalogVersion: string;
  effectiveOn: string;
  expiresOn: string | null;
  reviewDueOn: string;
  sources: FinancingPolicySource[];
  configurationNote: string;
};

/**
 * Version 1 of the three initial product families. Migration 0026 inserts identical rows for
 * existing synthetic banks; seeding inserts them for new synthetic banks. Never edit a version:
 * add a new one, so published structures keep the exact policy they pinned.
 */
export const financingPolicyFixtures: readonly FinancingPolicyFixture[] = [
  {
    family: "sba_7a",
    variant: "sba_7a_standard",
    version: 1,
    security: null,
    minimumPrincipal: "350000.01",
    maximumPrincipal: "5000000.00",
    minimumBasis: "program_restriction",
    maximumBasis: "program_restriction",
    aggregateMaximum: "5000000.00",
    aggregateBasis: "fixture_assumption",
    catalogVersion: "2026-10-12",
    effectiveOn: "2026-10-12",
    expiresOn: null,
    reviewDueOn: "2027-04-12",
    sources: [cite("Maximum 7(a) loan amount"), cite("7(a) loan program types", "sba-lenders")],
    configurationNote: sbaNote,
  },
  {
    family: "sba_7a",
    variant: "sba_7a_small",
    version: 1,
    security: null,
    minimumPrincipal: "10000.00",
    maximumPrincipal: "350000.00",
    minimumBasis: "bank_policy",
    maximumBasis: "program_restriction",
    aggregateMaximum: "5000000.00",
    aggregateBasis: "fixture_assumption",
    catalogVersion: "2026-10-12",
    effectiveOn: "2026-10-12",
    expiresOn: null,
    reviewDueOn: "2027-04-12",
    sources: [cite("7(a) Small loans", "sba-lenders"), cite("Maximum 7(a) loan amount")],
    configurationNote: sbaNote,
  },
  {
    family: "conventional_term",
    variant: "conventional_term_unsecured",
    version: 1,
    security: "unsecured",
    minimumPrincipal: "10000.00",
    maximumPrincipal: "1000000.00",
    minimumBasis: "bank_policy",
    maximumBasis: "bank_policy",
    aggregateMaximum: null,
    aggregateBasis: null,
    catalogVersion: "2026-10-12",
    effectiveOn: "2026-10-12",
    expiresOn: null,
    reviewDueOn: "2027-04-12",
    sources: [cite("Business term loans (product example)", "key-small")],
    configurationNote: bankNote,
  },
  {
    family: "conventional_term",
    variant: "conventional_term_secured",
    version: 1,
    security: "secured",
    minimumPrincipal: "10000.00",
    maximumPrincipal: "25000000.00",
    minimumBasis: "bank_policy",
    maximumBasis: "bank_policy",
    aggregateMaximum: null,
    aggregateBasis: null,
    catalogVersion: "2026-10-12",
    effectiveOn: "2026-10-12",
    expiresOn: null,
    reviewDueOn: "2027-04-12",
    sources: [cite("Business term loans (product example)", "key-small")],
    configurationNote: bankNote,
  },
  {
    family: "equipment_term",
    variant: "equipment_term",
    version: 1,
    security: null,
    minimumPrincipal: "10000.00",
    maximumPrincipal: "10000000.00",
    minimumBasis: "bank_policy",
    maximumBasis: "bank_policy",
    aggregateMaximum: null,
    aggregateBasis: null,
    catalogVersion: "2026-10-12",
    effectiveOn: "2026-10-12",
    expiresOn: null,
    reviewDueOn: "2027-04-12",
    sources: [cite("Equipment loans (product example)", "key-equipment")],
    configurationNote: bankNote,
  },
];
