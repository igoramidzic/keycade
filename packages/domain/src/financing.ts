import {
  centsToUsd,
  type FinancingFinding,
  type FinancingGate,
  type FinancingProductFamily,
  type FinancingStructureView,
  type FinancingView,
  financingCatalogVersion,
  financingFamilyName,
  financingVariantName,
  financingViewSchema,
  publishFinancingDraftSchema,
  saveFinancingDraftSchema,
  saveFinancingRequestSchema,
  structuredFinancingLifecycle,
  usdToCents,
} from "@keylend/contracts";
import {
  applicationDecisions,
  applicationSetups,
  applicationSubmissions,
  applications,
  auditEvents,
  type Database,
  type DatabaseTransaction,
  financingAllocations,
  financingCommands,
  financingFacilities,
  financingFacilityLineage,
  financingFacilityVersions,
  financingProductPolicies,
  financingRequestRevisions,
  financingSources,
  financingStructureRevisions,
  financingUses,
  fundingRecords,
  legacyFacilityLinks,
  loanAccounts,
  loanProducts,
} from "@keylend/db";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  type Actor,
  type ApplicationAccess,
  requireApplicantPortalAccess,
} from "./authorization.js";
import { lockCheckApplication } from "./checks.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";
import { recordApplicantActivity } from "./notification-intents.js";
import { reconcileTasks } from "./tasks.js";

type Tx = DatabaseTransaction;
type App = typeof applications.$inferSelect;
type Policy = typeof financingProductPolicies.$inferSelect;
type RequestRow = typeof financingRequestRevisions.$inferSelect;
type StructureRow = typeof financingStructureRevisions.$inferSelect;
type Operation = typeof financingCommands.$inferSelect.operation;

export type FinancingPolicySnapshot = Pick<
  Policy,
  | "id"
  | "family"
  | "variant"
  | "version"
  | "security"
  | "minimumPrincipal"
  | "maximumPrincipal"
  | "minimumBasis"
  | "maximumBasis"
  | "aggregateMaximum"
  | "aggregateBasis"
  | "effectiveOn"
  | "expiresOn"
  | "reviewDueOn"
  | "active"
>;
export type FinancingEvaluationInput = {
  /** UTC calendar date from the injected clock. */
  today: string;
  request: { id: string; requestedAmount: string | null; authorKind: "applicant" | "staff" } | null;
  /** The structure's own request revision; a mismatch with the current request blocks publication. */
  structureRequestId?: string;
  facilities: {
    facilityId: string;
    family: FinancingProductFamily;
    security: "secured" | "unsecured" | null;
    principal: string | null;
    policy: FinancingPolicySnapshot | null;
  }[];
  uses: { id: string; amount: string }[];
  sources: { id: string; amount: string }[];
  allocations: {
    useId: string;
    facilityId: string | null;
    sourceId: string | null;
    amount: string;
  }[];
};

const editable = new Set<App["status"]>(["collecting_information", "needs_information"]);
const allGates: FinancingGate[] = ["publication", "approval", "funding"];
const creditGates: FinancingGate[] = ["approval", "funding"];
const sum = (values: string[]) => values.reduce((total, value) => total + usdToCents(value), 0n);
const usd = (cents: bigint) => centsToUsd(cents < 0n ? -cents : cents);

export function financingPolicyIsCurrent(
  policy: Pick<FinancingPolicySnapshot, "active" | "effectiveOn" | "expiresOn">,
  today: string,
) {
  return (
    policy.active && policy.effectiveOn <= today && (!policy.expiresOn || policy.expiresOn > today)
  );
}

/**
 * Server-side variant resolution under the bank's current policy versions. SBA 7(a) resolves by
 * principal (Small at or below its maximum), conventional by its secured/unsecured attribute.
 * An over-limit principal still pins the largest variant so the limit violation is reported.
 */
export function resolveFinancingPolicy<P extends FinancingPolicySnapshot>(
  policies: readonly P[],
  facility: {
    family: FinancingProductFamily;
    security: "secured" | "unsecured" | null;
    principal: string | null;
  },
  today: string,
): P | null {
  const latest = new Map<string, P>();
  for (const policy of policies) {
    if (policy.family !== facility.family || !financingPolicyIsCurrent(policy, today)) continue;
    const prior = latest.get(policy.variant);
    if (!prior || policy.version > prior.version) latest.set(policy.variant, policy);
  }
  const candidates = [...latest.values()];
  if (facility.family === "conventional_term")
    return facility.security
      ? (candidates.find((policy) => policy.security === facility.security) ?? null)
      : null;
  if (facility.family === "equipment_term") return candidates[0] ?? null;
  if (!facility.principal || !candidates.length) return null;
  const principal = usdToCents(facility.principal);
  const ordered = candidates.sort((a, b) =>
    usdToCents(a.maximumPrincipal) < usdToCents(b.maximumPrincipal) ? -1 : 1,
  );
  return (
    ordered.find((policy) => principal <= usdToCents(policy.maximumPrincipal)) ??
    ordered.at(-1) ??
    null
  );
}

/** Pure, exact-cents evaluation. Findings never decide credit; they only gate workflow steps. */
export function evaluateFinancingStructure(input: FinancingEvaluationInput) {
  const findings: FinancingFinding[] = [];
  const add = (
    code: FinancingFinding["code"],
    blocks: FinancingGate[],
    message: string,
    extra: Partial<Pick<FinancingFinding, "facilityId" | "amount" | "basis">> = {},
  ) =>
    findings.push({
      code,
      blocks,
      message,
      facilityId: extra.facilityId ?? null,
      amount: extra.amount ?? null,
      basis: extra.basis ?? null,
    });
  const need = input.request?.requestedAmount ? usdToCents(input.request.requestedAmount) : null;
  if (need === null)
    add("request_need_missing", allGates, "Record the overall financing need first.");
  if (input.request && input.structureRequestId && input.structureRequestId !== input.request.id)
    add(
      "request_changed",
      ["publication"],
      "The financing request changed after this draft was saved. Save the draft again to review it against the current request.",
    );
  if (input.request?.authorKind === "staff")
    add(
      "request_unconfirmed",
      creditGates,
      "The applicant has not confirmed the current financing request.",
    );
  if (!input.facilities.length) add("no_facilities", allGates, "Add at least one facility.");
  const exposure = new Map<
    FinancingProductFamily,
    { total: bigint; limit: bigint; basis: FinancingFinding["basis"] }
  >();
  for (const facility of input.facilities) {
    const facilityId = facility.facilityId;
    if (!facility.principal)
      add("facility_amount_missing", allGates, "Enter this facility's principal.", { facilityId });
    if (facility.family === "conventional_term" && !facility.security)
      add(
        "facility_security_missing",
        allGates,
        "Choose secured or unsecured for this conventional facility.",
        { facilityId },
      );
    const policy = facility.policy;
    if (!policy || !financingPolicyIsCurrent(policy, input.today)) {
      if (facility.principal && (facility.family !== "conventional_term" || facility.security))
        add(
          "product_policy_unavailable",
          allGates,
          "No current product policy supports this facility. Save the draft again to apply the bank's current policy.",
          { facilityId },
        );
      continue;
    }
    if (policy.reviewDueOn < input.today)
      add(
        "product_policy_review_overdue",
        creditGates,
        "The pinned product policy is past its review date.",
        { facilityId },
      );
    const name = financingVariantName(policy.variant);
    if (facility.principal) {
      const principal = usdToCents(facility.principal);
      if (principal < usdToCents(policy.minimumPrincipal))
        add(
          "facility_below_minimum",
          allGates,
          `${name} principal is below its minimum of USD ${policy.minimumPrincipal}.`,
          { facilityId, amount: policy.minimumPrincipal, basis: policy.minimumBasis },
        );
      if (principal > usdToCents(policy.maximumPrincipal))
        add(
          "facility_above_maximum",
          allGates,
          `${name} principal exceeds its maximum of USD ${policy.maximumPrincipal}.`,
          { facilityId, amount: policy.maximumPrincipal, basis: policy.maximumBasis },
        );
      if (policy.aggregateMaximum) {
        const prior = exposure.get(facility.family);
        const limit = usdToCents(policy.aggregateMaximum);
        exposure.set(facility.family, {
          total: (prior?.total ?? 0n) + principal,
          limit: prior && prior.limit < limit ? prior.limit : limit,
          basis: prior && prior.limit < limit ? prior.basis : policy.aggregateBasis,
        });
      }
    }
  }
  // Splitting a program's financing into several facilities never avoids its package limit.
  for (const [family, { total, limit, basis }] of exposure)
    if (total > limit)
      add(
        "program_aggregate_exceeded",
        allGates,
        `Proposed ${financingFamilyName(family)} facilities total USD ${usd(total)}, above the package limit of USD ${usd(limit)}.`,
        { amount: usd(limit), basis },
      );
  if (input.facilities.some((facility) => facility.family === "sba_7a"))
    add(
      "program_exposure_unknown",
      creditGates,
      "Existing SBA exposure for the business and its affiliates has not been reviewed.",
    );
  const financing = sum(input.facilities.flatMap((f) => (f.principal ? [f.principal] : [])));
  const contributions = sum(input.sources.map((source) => source.amount));
  const projectCost = input.uses.length ? sum(input.uses.map((use) => use.amount)) : null;
  const gap = need !== null && need > financing ? need - financing : 0n;
  const excess = need !== null && financing > need ? financing - need : 0n;
  const allocatedTo = (
    pick: (allocation: FinancingEvaluationInput["allocations"][number]) => boolean,
  ) => sum(input.allocations.filter(pick).map((allocation) => allocation.amount));
  const unallocatedCost = input.uses.reduce(
    (total, use) => total + usdToCents(use.amount) - allocatedTo((a) => a.useId === use.id),
    0n,
  );
  const reconciled = projectCost !== null && projectCost === financing + contributions;
  if (excess > 0n)
    add(
      "financing_exceeds_request",
      allGates,
      "Proposed financing exceeds the requested need. Record a revised request before increasing it.",
      { amount: usd(excess) },
    );
  if (gap > 0n) {
    if (reconciled)
      add(
        "reduced_financing",
        [],
        "The structure provides less than requested; documented sources cover the remaining project cost. The applicant must accept the reduced financing.",
        { amount: usd(gap) },
      );
    else
      add(
        "financing_gap",
        allGates,
        "Part of the requested need is unfinanced. Revise the request, change a facility or document another source.",
        { amount: usd(gap) },
      );
  }
  if (projectCost === null)
    add("uses_missing", creditGates, "Document the project costs the financing will pay for.");
  else if (!reconciled)
    add(
      "uses_unreconciled",
      allGates,
      "Project costs must equal facility principal plus identified sources.",
      { amount: usd(projectCost - financing - contributions) },
    );
  if (
    projectCost !== null &&
    (unallocatedCost > 0n ||
      input.facilities.some(
        (f) =>
          !!f.principal &&
          allocatedTo((a) => a.facilityId === f.facilityId) < usdToCents(f.principal),
      ) ||
      input.sources.some((s) => allocatedTo((a) => a.sourceId === s.id) < usdToCents(s.amount)))
  )
    add(
      "allocation_incomplete",
      creditGates,
      "Allocate every cost to the facilities and sources that pay for it.",
    );
  if (structuredFinancingLifecycle.creditDecision === "unavailable")
    add(
      "credit_decision_unavailable",
      ["approval"],
      "Package credit decisions for structured financing are not available yet.",
    );
  if (structuredFinancingLifecycle.funding === "unavailable")
    add(
      "funding_unavailable",
      ["funding"],
      "Facility funding for structured financing is not available yet.",
    );
  const ready = (gate: FinancingGate) => !findings.some((f) => f.blocks.includes(gate));
  return {
    totals: {
      requestedNeed: need === null ? null : usd(need),
      financing: usd(financing),
      contributions: usd(contributions),
      projectCost: projectCost === null ? null : usd(projectCost),
      financingGap: usd(gap),
      financingExcess: usd(excess),
      unallocatedCost: usd(unallocatedCost < 0n ? 0n : unallocatedCost),
    },
    findings,
    ready: {
      publication: ready("publication"),
      approval: ready("approval"),
      funding: ready("funding"),
    },
  };
}

/** Old single-product routes call this before any decision, closing or funding work. */
export function assertLegacyFinancingLifecycle(
  app: Pick<App, "financingMode">,
  step: "credit_decision" | "closing" | "funding",
) {
  if (app.financingMode === "legacy") return;
  const message =
    step === "credit_decision"
      ? "Package credit decisions for structured financing are not available yet."
      : step === "closing"
        ? "Facility closing for structured financing is not available yet."
        : "Facility funding for structured financing is not available yet.";
  throw new DomainError("FINANCING_LIFECYCLE_UNAVAILABLE", 409, message);
}

/** Additive legacy mapping written in the same transaction as the original legacy record. */
export async function linkLegacyFacilityRecords(
  tx: Tx,
  app: Pick<App, "bankId" | "id" | "productId" | "financingMode">,
  records: {
    decisionId?: string;
    closingPackageId?: string;
    fundingRecordId?: string;
    loanAccountId?: string;
  },
  now: Date,
) {
  assertLegacyFinancingLifecycle(app, "credit_decision");
  await tx.execute(sql`
    INSERT INTO financing_facilities (bank_id, application_id, origin, ordinal, legacy_product_id, created_at)
    SELECT ${app.bankId}::uuid, ${app.id}::uuid, 'legacy',
      COALESCE((SELECT max(ordinal) FROM financing_facilities WHERE application_id = ${app.id}::uuid), 0) + 1,
      ${app.productId}::uuid, ${now}
    ON CONFLICT DO NOTHING`);
  const [facility] = await tx
    .select({ id: financingFacilities.id })
    .from(financingFacilities)
    .where(
      and(
        eq(financingFacilities.bankId, app.bankId),
        eq(financingFacilities.applicationId, app.id),
        eq(financingFacilities.origin, "legacy"),
      ),
    );
  if (!facility) throw new Error("Legacy facility unavailable.");
  const rows = (
    [
      ["decisionId", records.decisionId],
      ["closingPackageId", records.closingPackageId],
      ["fundingRecordId", records.fundingRecordId],
      ["loanAccountId", records.loanAccountId],
    ] as const
  ).flatMap(([column, id]) =>
    id
      ? [{ bankId: app.bankId, applicationId: app.id, facilityId: facility.id, [column]: id }]
      : [],
  );
  if (rows.length) await tx.insert(legacyFacilityLinks).values(rows).onConflictDoNothing();
}

/** Immutable structured references for a submission snapshot; null for legacy applications. */
export async function readFinancingSubmissionReference(tx: Tx, app: App) {
  if (app.financingMode !== "structured") return null;
  const [request] = await tx
    .select()
    .from(financingRequestRevisions)
    .where(scope(financingRequestRevisions, app))
    .orderBy(desc(financingRequestRevisions.revision))
    .limit(1);
  const [structure] = await tx
    .select()
    .from(financingStructureRevisions)
    .where(
      and(
        scope(financingStructureRevisions, app),
        eq(financingStructureRevisions.state, "published"),
      ),
    )
    .orderBy(desc(financingStructureRevisions.sequence))
    .limit(1);
  if (!request) return null;
  return {
    facts: {
      mode: "structured" as const,
      requestRevision: request.revision,
      requestedAmount: request.requestedAmount,
      productPreference: request.productPreference,
      structureSequence: structure?.sequence ?? null,
    },
    references: {
      requestRevisionId: request.id,
      structureRevisionId: structure?.id ?? null,
    },
  };
}

function scope(table: { bankId: AnyPgColumn; applicationId: AnyPgColumn }, app: App) {
  return and(eq(table.bankId, app.bankId), eq(table.applicationId, app.id));
}
function invalid(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
function badInput(message: string): never {
  throw new DomainError("INVALID_INPUT", 400, message);
}
function conflict(): never {
  throw new DomainError("REVISION_CONFLICT", 409, "The financing changed. Reload and try again.");
}
async function accessFor(tx: Tx, actor: Actor, app: App) {
  if (actor.kind !== "user" || !app.synthetic) return deny();
  // Applicants reach financing only from the portal, after their own setup is complete.
  const access = await requireApplicantPortalAccess(tx, actor, app.bankId, app.id);
  const applicant =
    access.kind === "participant" && access.role === "applicant_admin" && access.scope === "full";
  if (access.kind !== "staff" && !applicant) return deny();
  return { access, userId: actor.userId, staff: access.kind === "staff" };
}
async function requests(tx: Tx, app: App) {
  return tx
    .select()
    .from(financingRequestRevisions)
    .where(scope(financingRequestRevisions, app))
    .orderBy(asc(financingRequestRevisions.revision));
}
async function convertible(tx: Tx, app: App) {
  if (app.financingMode !== "legacy" || app.status !== "collecting_information") return false;
  const [setup] = await tx
    .select({ completedAt: applicationSetups.completedAt })
    .from(applicationSetups)
    .where(
      and(eq(applicationSetups.bankId, app.bankId), eq(applicationSetups.applicationId, app.id)),
    );
  const [submission] = await tx
    .select({ id: applicationSubmissions.id })
    .from(applicationSubmissions)
    .where(scope(applicationSubmissions, app))
    .limit(1);
  return !!setup?.completedAt && !submission;
}
async function replay(
  tx: Tx,
  app: App,
  input: { idempotencyKey: string },
  operation: Operation,
  userId: string,
  payloadHash: string,
) {
  const [previous] = await tx
    .select()
    .from(financingCommands)
    .where(
      and(
        scope(financingCommands, app),
        eq(financingCommands.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (
    previous &&
    (previous.actorUserId !== userId ||
      previous.operation !== operation ||
      previous.payloadHash !== payloadHash)
  )
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "This request key was used for a different financing action.",
    );
  return !!previous;
}
async function bumpApplication(tx: Tx, app: App, set: Partial<App>, now: Date) {
  const [updated] = await tx
    .update(applications)
    .set({ ...set, revision: app.revision + 1, updatedAt: now })
    .where(and(eq(applications.id, app.id), eq(applications.revision, app.revision)))
    .returning();
  if (!updated) conflict();
  await tx
    .update(applicationSetups)
    .set({ revision: updated.revision })
    .where(
      and(eq(applicationSetups.bankId, app.bankId), eq(applicationSetups.applicationId, app.id)),
    );
  return updated;
}

type Children = Awaited<ReturnType<typeof loadChildren>>;
async function loadChildren(tx: Tx, app: App, structureIds: string[]) {
  if (!structureIds.length)
    return { versions: [], uses: [], sources: [], allocations: [], lineage: [], facilities: [] };
  const versions = await tx
    .select()
    .from(financingFacilityVersions)
    .where(
      and(
        scope(financingFacilityVersions, app),
        inArray(financingFacilityVersions.structureRevisionId, structureIds),
      ),
    )
    .orderBy(asc(financingFacilityVersions.position));
  const uses = await tx
    .select()
    .from(financingUses)
    .where(and(scope(financingUses, app), inArray(financingUses.structureRevisionId, structureIds)))
    .orderBy(asc(financingUses.position));
  const sources = await tx
    .select()
    .from(financingSources)
    .where(
      and(
        scope(financingSources, app),
        inArray(financingSources.structureRevisionId, structureIds),
      ),
    )
    .orderBy(asc(financingSources.position));
  const allocations = await tx
    .select()
    .from(financingAllocations)
    .where(
      and(
        scope(financingAllocations, app),
        inArray(financingAllocations.structureRevisionId, structureIds),
      ),
    )
    .orderBy(asc(financingAllocations.id));
  const lineage = await tx
    .select()
    .from(financingFacilityLineage)
    .where(
      and(
        scope(financingFacilityLineage, app),
        inArray(financingFacilityLineage.structureRevisionId, structureIds),
      ),
    );
  const facilities = await tx
    .select()
    .from(financingFacilities)
    .where(scope(financingFacilities, app));
  return { versions, uses, sources, allocations, lineage, facilities };
}
function evaluationFor(
  structure: StructureRow,
  children: Children,
  policies: Policy[],
  request: RequestRow | null,
  today: string,
) {
  const versions = children.versions.filter((v) => v.structureRevisionId === structure.id);
  const versionFacility = new Map(versions.map((v) => [v.id, v.facilityId]));
  return evaluateFinancingStructure({
    today,
    request,
    structureRequestId: structure.state === "draft" ? structure.requestRevisionId : undefined,
    facilities: versions.map((v) => ({
      facilityId: v.facilityId,
      family: v.family,
      security: v.security,
      principal: v.principal,
      policy: policies.find((p) => p.id === v.productPolicyId) ?? null,
    })),
    uses: children.uses.filter((u) => u.structureRevisionId === structure.id),
    sources: children.sources.filter((s) => s.structureRevisionId === structure.id),
    allocations: children.allocations
      .filter((a) => a.structureRevisionId === structure.id)
      .map((a) => ({
        useId: a.useId,
        facilityId: a.facilityVersionId ? (versionFacility.get(a.facilityVersionId) ?? null) : null,
        sourceId: a.sourceId,
        amount: a.amount,
      })),
  });
}
function structureView(
  structure: StructureRow,
  children: Children,
  policies: Policy[],
  structures: StructureRow[],
  history: RequestRow[],
  current: RequestRow | null,
  today: string,
  staff: boolean,
): FinancingStructureView {
  const own = history.find((r) => r.id === structure.requestRevisionId);
  // Published revisions are judged against the request they were published with.
  const evaluation = evaluationFor(
    structure,
    children,
    policies,
    structure.state === "draft" ? current : (own ?? null),
    today,
  );
  const versions = children.versions.filter((v) => v.structureRevisionId === structure.id);
  const allocations = children.allocations.filter((a) => a.structureRevisionId === structure.id);
  const allocated = (pick: (a: (typeof allocations)[number]) => boolean) =>
    usd(sum(allocations.filter(pick).map((a) => a.amount)));
  const ordinal = (id: string) => children.facilities.find((f) => f.id === id)?.ordinal ?? 1;
  return {
    id: structure.id,
    state: structure.state,
    sequence: structure.sequence,
    draftRevision: structure.draftRevision,
    requestRevision: own?.revision ?? 1,
    basedOnSequence: structures.find((s) => s.id === structure.basedOnId)?.sequence ?? null,
    reason: staff ? structure.reason : null,
    createdAt: structure.createdAt.toISOString(),
    updatedAt: structure.updatedAt.toISOString(),
    publishedAt: structure.publishedAt?.toISOString() ?? null,
    facilities: versions.map((v) => {
      const policy = policies.find((p) => p.id === v.productPolicyId) ?? null;
      return {
        facilityId: v.facilityId,
        versionId: v.id,
        ordinal: ordinal(v.facilityId),
        key: v.draftKey,
        family: v.family,
        security: v.security,
        variant: policy?.variant ?? null,
        productName: policy ? financingVariantName(policy.variant) : financingFamilyName(v.family),
        policy: policy
          ? {
              id: policy.id,
              variant: policy.variant,
              version: policy.version,
              minimum: policy.minimumPrincipal,
              maximum: policy.maximumPrincipal,
              minimumBasis: policy.minimumBasis,
              maximumBasis: policy.maximumBasis,
            }
          : null,
        principal: v.principal,
        allocated: allocated((a) => a.facilityVersionId === v.id),
        lineage: children.lineage
          .filter(
            (l) => l.structureRevisionId === structure.id && l.successorFacilityId === v.facilityId,
          )
          .map((l) => ({
            kind: l.kind,
            predecessorFacilityId: l.predecessorFacilityId,
            predecessorOrdinal: ordinal(l.predecessorFacilityId),
          })),
      };
    }),
    uses: children.uses
      .filter((u) => u.structureRevisionId === structure.id)
      .map((u) => ({
        id: u.id,
        key: u.draftKey,
        category: u.category as FinancingStructureView["uses"][number]["category"],
        description: u.description,
        amount: u.amount,
        allocated: allocated((a) => a.useId === u.id),
      })),
    sources: children.sources
      .filter((s) => s.structureRevisionId === structure.id)
      .map((s) => ({
        id: s.id,
        key: s.draftKey,
        kind: s.kind as FinancingStructureView["sources"][number]["kind"],
        description: s.description,
        amount: s.amount,
        allocated: allocated((a) => a.sourceId === s.id),
      })),
    allocations: allocations.map((a) => ({
      id: a.id,
      useId: a.useId,
      facilityId: a.facilityVersionId
        ? (versions.find((v) => v.id === a.facilityVersionId)?.facilityId ?? null)
        : null,
      sourceId: a.sourceId,
      amount: a.amount,
    })),
    totals: evaluation.totals,
    findings: staff ? evaluation.findings : [],
    ready: evaluation.ready,
  };
}
async function legacySummary(tx: Tx, app: App) {
  const [facility] = await tx
    .select()
    .from(financingFacilities)
    .where(and(scope(financingFacilities, app), eq(financingFacilities.origin, "legacy")));
  const productId = facility?.legacyProductId ?? app.productId;
  const [product] = productId
    ? await tx
        .select({ name: loanProducts.name, version: loanProducts.version })
        .from(loanProducts)
        .where(and(eq(loanProducts.bankId, app.bankId), eq(loanProducts.id, productId)))
    : [];
  const [decision] = await tx
    .select({ approvedAmount: applicationDecisions.approvedAmount })
    .from(applicationDecisions)
    .where(and(scope(applicationDecisions, app), eq(applicationDecisions.outcome, "approved")))
    .orderBy(desc(applicationDecisions.applicationRevision))
    .limit(1);
  const [funded] = await tx
    .select({ amount: fundingRecords.fundedAmount, accountId: loanAccounts.id })
    .from(fundingRecords)
    .leftJoin(loanAccounts, eq(loanAccounts.fundingRecordId, fundingRecords.id))
    .where(scope(fundingRecords, app))
    .limit(1);
  return {
    facilityId: facility?.id ?? null,
    productName: product?.name ?? null,
    productVersion: product?.version ?? null,
    requestedAmount: app.requestedAmount,
    approvedAmount: decision?.approvedAmount ?? null,
    fundedAmount: funded?.amount ?? null,
    loanAccountId: funded?.accountId ?? null,
  };
}
function productViews(policies: Policy[], today: string) {
  const current = new Map<string, Policy>();
  for (const policy of policies)
    if (financingPolicyIsCurrent(policy, today)) {
      const prior = current.get(policy.variant);
      if (!prior || policy.version > prior.version) current.set(policy.variant, policy);
    }
  return [...current.values()]
    .sort((a, b) => a.family.localeCompare(b.family) || a.variant.localeCompare(b.variant))
    .map((p) => ({
      id: p.id,
      family: p.family,
      variant: p.variant,
      name: financingVariantName(p.variant),
      version: p.version,
      security: p.security,
      minimum: p.minimumPrincipal,
      maximum: p.maximumPrincipal,
      minimumBasis: p.minimumBasis,
      maximumBasis: p.maximumBasis,
      aggregateMaximum: p.aggregateMaximum,
      aggregateBasis: p.aggregateBasis,
      effectiveOn: p.effectiveOn,
      expiresOn: p.expiresOn,
      reviewDueOn: p.reviewDueOn,
      sources: p.sources as FinancingView["products"][number]["sources"],
      configurationNote: p.configurationNote,
    }));
}
async function view(
  tx: Tx,
  app: App,
  access: ApplicationAccess,
  now: Date,
): Promise<FinancingView> {
  const staff = access.kind === "staff";
  const today = now.toISOString().slice(0, 10);
  const structured = app.financingMode === "structured";
  const history = structured ? await requests(tx, app) : [];
  const current = history.at(-1) ?? null;
  const structures = structured
    ? await tx
        .select()
        .from(financingStructureRevisions)
        .where(scope(financingStructureRevisions, app))
        .orderBy(asc(financingStructureRevisions.createdAt))
    : [];
  const published = structures
    .filter((s) => s.state === "published")
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const latest = published.at(-1) ?? null;
  const draft = staff ? (structures.find((s) => s.state === "draft") ?? null) : null;
  const policies = await tx
    .select()
    .from(financingProductPolicies)
    .where(eq(financingProductPolicies.bankId, app.bankId));
  const children = await loadChildren(
    tx,
    app,
    [draft?.id, latest?.id].filter((id): id is string => !!id),
  );
  const summaries = published.length
    ? await tx
        .select({
          structureRevisionId: financingFacilityVersions.structureRevisionId,
          count: sql<number>`count(*)::int`,
          financing: sql<string>`coalesce(sum(${financingFacilityVersions.principal}), 0)::numeric(20,2)::text`,
        })
        .from(financingFacilityVersions)
        .where(
          and(
            scope(financingFacilityVersions, app),
            inArray(
              financingFacilityVersions.structureRevisionId,
              published.map((s) => s.id),
            ),
          ),
        )
        .groupBy(financingFacilityVersions.structureRevisionId)
    : [];
  const draftView = draft
    ? structureView(draft, children, policies, structures, history, current, today, staff)
    : null;
  const editableStage = editable.has(app.status);
  const canConvert = !structured && (await convertible(tx, app));
  const capabilities = {
    saveRequest: structured ? editableStage : canConvert,
    saveDraft: staff && structured && editableStage,
    publish: staff && structured && editableStage && !!draftView?.ready.publication,
    approve: false,
    fund: false,
  };
  const unavailable: FinancingView["unavailable"] = [];
  if (!capabilities.saveRequest)
    unavailable.push({
      capability: "saveRequest",
      reason: structured
        ? "Financing request changes after submission require the amendment workflow, which is not available yet."
        : "A structured financing request can start after initial setup and before the first submission.",
    });
  if (!capabilities.saveDraft)
    unavailable.push({
      capability: "saveDraft",
      reason: !staff
        ? "Bank staff prepare financing structures."
        : structured
          ? "Restructuring after submission requires the amendment workflow, which is not available yet."
          : "Start a structured financing request first.",
    });
  if (!capabilities.publish)
    unavailable.push({
      capability: "publish",
      reason: draftView
        ? "Resolve the publication findings first."
        : "Save a draft structure before publishing.",
    });
  unavailable.push(
    {
      capability: "approve",
      reason: structured
        ? "Package credit decisions for structured financing are not available yet."
        : "Single-product applications use the existing review decision.",
    },
    {
      capability: "fund",
      reason: structured
        ? "Facility funding for structured financing is not available yet."
        : "Single-product applications use the existing closing and funding workflow.",
    },
  );
  const requestView = (r: RequestRow) => ({
    id: r.id,
    revision: r.revision,
    requestedAmount: r.requestedAmount,
    productPreference: r.productPreference,
    catalogVersion: r.catalogVersion,
    reason: staff || r.authorKind === "applicant" ? r.reason : null,
    authorKind: r.authorKind,
    confirmedByApplicant: r.authorKind === "applicant",
    createdAt: r.createdAt.toISOString(),
  });
  return financingViewSchema.parse({
    applicationId: app.id,
    revision: app.revision,
    status: app.status,
    mode: app.financingMode,
    simulated: true,
    catalogVersion: financingCatalogVersion,
    canManage: staff,
    lifecycle: structured
      ? structuredFinancingLifecycle
      : {
          version: structuredFinancingLifecycle.version,
          creditDecision: "legacy_amount_approval",
          offerAcceptance: "not_applicable",
          closing: "legacy_single_package",
          funding: "legacy_single_funding",
        },
    capabilities,
    unavailable,
    request: current ? requestView(current) : null,
    requestHistory: history.map(requestView),
    draft: draftView,
    published: latest
      ? structureView(latest, children, policies, structures, history, current, today, staff)
      : null,
    publishedHistory: published.map((s) => {
      const summary = summaries.find((row) => row.structureRevisionId === s.id);
      return {
        id: s.id,
        sequence: s.sequence,
        requestRevision: history.find((r) => r.id === s.requestRevisionId)?.revision ?? 1,
        reason: staff ? s.reason : null,
        publishedAt: s.publishedAt?.toISOString(),
        facilityCount: summary?.count ?? 0,
        financing: summary?.financing ?? "0.00",
      };
    }),
    legacy: structured ? null : await legacySummary(tx, app),
    products: staff ? productViews(policies, today) : [],
  });
}

export function createFinancingService(
  db: Pick<Database, "transaction">,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function read(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const app = await lockCheckApplication(tx, bankId, applicationId);
      const { access } = await accessFor(tx, actor, app);
      return view(tx, app, access, clock());
    });
  }

  async function saveRequest(
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    const parsed = saveFinancingRequestSchema.safeParse(raw);
    if (!parsed.success) badInput("Invalid financing request.");
    const input = parsed.data;
    return db.transaction(async (tx) => {
      const app = await lockCheckApplication(tx, bankId, applicationId);
      const { access, userId, staff } = await accessFor(tx, actor, app);
      const payloadHash = hashIdentityCredential(JSON.stringify(input));
      if (await replay(tx, app, input, "save_request", userId, payloadHash))
        return view(tx, app, access, clock());
      if (app.revision !== input.expectedRevision) conflict();
      const converting = app.financingMode === "legacy";
      if (converting && !(await convertible(tx, app)))
        invalid(
          "A structured financing request can start after initial setup and before the first submission.",
        );
      if (!converting && !editable.has(app.status))
        invalid(
          "Financing request changes after submission require the amendment workflow, which is not available yet.",
        );
      const now = clock();
      const history = converting ? [] : await requests(tx, app);
      const current = history.at(-1) ?? null;
      const authorKind = staff ? "staff" : "applicant";
      const same =
        current?.requestedAmount === input.requestedAmount &&
        current?.productPreference === input.productPreference;
      // Repeating the current values is a no-op, except an applicant confirming staff-entered values.
      const confirming = same && current?.authorKind === "staff" && authorKind === "applicant";
      let result = current?.id ?? null;
      let updated = app;
      if (!same || confirming) {
        const reason =
          input.reason ??
          (confirming
            ? "Confirmed by the applicant."
            : current && !staff
              ? "Updated by the applicant."
              : undefined);
        // Staff changes after the first revision must say why the request changed.
        if (current && !reason) badInput("Explain why the financing request changed.");
        const [revision] = await tx
          .insert(financingRequestRevisions)
          .values({
            bankId,
            applicationId,
            revision: (current?.revision ?? 0) + 1,
            requestedAmount: input.requestedAmount,
            productPreference: input.productPreference,
            catalogVersion: financingCatalogVersion,
            reason: reason ?? null,
            authorKind,
            createdByUserId: userId,
            createdAt: now,
          })
          .returning();
        if (!revision) throw new Error("Financing request insert failed.");
        result = revision.id;
        // The application mirrors the current overall need for existing summaries and requirement rules.
        updated = await bumpApplication(
          tx,
          app,
          { requestedAmount: input.requestedAmount, financingMode: "structured" },
          now,
        );
        await reconcileTasks(tx, bankId, applicationId, requestId, now);
        await tx.insert(auditEvents).values({
          bankId,
          applicationId,
          actorType: "user",
          actorUserId: userId,
          action: converting ? "financing.structured_started" : "financing.request_revised",
          targetType: "financing_request",
          targetId: revision.id,
          changedFields: ["requestedAmount", "productPreference"],
          requestId,
          metadata: { revision: revision.revision, applicationRevision: updated.revision },
          createdAt: now,
        });
      }
      if (!result) throw new Error("Financing request unavailable.");
      if (!staff) await recordApplicantActivity(tx, bankId, applicationId, userId, now);
      await tx.insert(financingCommands).values({
        bankId,
        applicationId,
        actorUserId: userId,
        operation: "save_request",
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        resultId: result,
        createdAt: now,
      });
      return view(tx, updated, access, now);
    });
  }

  async function staffStructured(tx: Tx, actor: Actor, bankId: string, applicationId: string) {
    const app = await lockCheckApplication(tx, bankId, applicationId);
    const context = await accessFor(tx, actor, app);
    if (!context.staff) return deny();
    return { app, ...context };
  }
  function requireEditable(app: App) {
    if (app.financingMode !== "structured") invalid("Start a structured financing request first.");
    if (!editable.has(app.status))
      invalid(
        "Restructuring after submission requires the amendment workflow, which is not available yet.",
      );
  }

  async function saveDraft(
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    const parsed = saveFinancingDraftSchema.safeParse(raw);
    if (!parsed.success) badInput("Invalid financing structure.");
    const input = parsed.data;
    return db.transaction(async (tx) => {
      const { app, access, userId } = await staffStructured(tx, actor, bankId, applicationId);
      const payloadHash = hashIdentityCredential(JSON.stringify(input));
      if (await replay(tx, app, input, "save_draft", userId, payloadHash))
        return view(tx, app, access, clock());
      requireEditable(app);
      const now = clock();
      const today = now.toISOString().slice(0, 10);
      const current = (await requests(tx, app)).at(-1);
      if (!current) invalid("Record the financing request first.");
      const [draft] = await tx
        .select()
        .from(financingStructureRevisions)
        .where(
          and(
            scope(financingStructureRevisions, app),
            eq(financingStructureRevisions.state, "draft"),
          ),
        )
        .for("update");
      if ((draft?.draftRevision ?? null) !== input.expectedDraftRevision) conflict();
      const [basedOn] = await tx
        .select()
        .from(financingStructureRevisions)
        .where(
          and(
            scope(financingStructureRevisions, app),
            eq(financingStructureRevisions.state, "published"),
          ),
        )
        .orderBy(desc(financingStructureRevisions.sequence))
        .limit(1);
      const published = basedOn
        ? await tx
            .select({ facilityId: financingFacilityVersions.facilityId })
            .from(financingFacilityVersions)
            .where(
              and(
                scope(financingFacilityVersions, app),
                eq(financingFacilityVersions.structureRevisionId, basedOn.id),
              ),
            )
        : [];
      const introduced = draft
        ? await tx
            .select({ id: financingFacilities.id })
            .from(financingFacilities)
            .where(
              and(
                scope(financingFacilities, app),
                eq(financingFacilities.introducedInStructureId, draft.id),
              ),
            )
        : [];
      const publishedIds = new Set(published.map((row) => row.facilityId));
      const continuable = new Set([...publishedIds, ...introduced.map((row) => row.id)]);
      if (input.facilities.some((f) => f.facilityId && !continuable.has(f.facilityId)))
        badInput("A referenced facility is not part of this financing structure.");
      if (
        input.lineage.some((entry) =>
          entry.predecessorFacilityIds.some((id) => !publishedIds.has(id)),
        )
      )
        badInput("Lineage must start from facilities in the latest published structure.");
      // Hard errors: a cost cannot be financed twice and no funder can allocate more than it provides.
      const allocated = (pick: (a: (typeof input.allocations)[number]) => boolean) =>
        sum(input.allocations.filter(pick).map((a) => a.amount));
      for (const use of input.uses)
        if (allocated((a) => a.useKey === use.key) > usdToCents(use.amount))
          badInput("A cost cannot be allocated more than its amount.");
      for (const facility of input.facilities) {
        const total = allocated((a) => a.facilityKey === facility.key);
        if (total > 0n && (!facility.principal || total > usdToCents(facility.principal)))
          badInput("A facility cannot allocate more than its principal.");
      }
      for (const source of input.sources)
        if (allocated((a) => a.sourceKey === source.key) > usdToCents(source.amount))
          badInput("A source cannot allocate more than its amount.");
      const policies = await tx
        .select()
        .from(financingProductPolicies)
        .where(eq(financingProductPolicies.bankId, bankId));
      let structure = draft;
      if (!structure) {
        [structure] = await tx
          .insert(financingStructureRevisions)
          .values({
            bankId,
            applicationId,
            state: "draft",
            draftRevision: 1,
            requestRevisionId: current.id,
            basedOnId: basedOn?.id ?? null,
            createdByUserId: userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      } else {
        [structure] = await tx
          .update(financingStructureRevisions)
          .set({
            draftRevision: structure.draftRevision + 1,
            requestRevisionId: current.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(financingStructureRevisions.id, structure.id),
              eq(financingStructureRevisions.draftRevision, structure.draftRevision),
            ),
          )
          .returning();
      }
      if (!structure) conflict();
      const structureId = structure.id;
      const child = <T extends { structureRevisionId: AnyPgColumn }>(table: T) =>
        eq(table.structureRevisionId, structureId);
      await tx.delete(financingAllocations).where(child(financingAllocations));
      await tx.delete(financingFacilityLineage).where(child(financingFacilityLineage));
      await tx.delete(financingFacilityVersions).where(child(financingFacilityVersions));
      await tx.delete(financingUses).where(child(financingUses));
      await tx.delete(financingSources).where(child(financingSources));
      const kept = input.facilities.flatMap((f) => (f.facilityId ? [f.facilityId] : []));
      // Identities this draft introduced but no longer uses were never published; discard them.
      await tx
        .delete(financingFacilities)
        .where(
          and(
            scope(financingFacilities, app),
            eq(financingFacilities.introducedInStructureId, structureId),
            kept.length ? notInArray(financingFacilities.id, kept) : undefined,
          ),
        );
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${financingFacilities.ordinal}), 0)::int` })
        .from(financingFacilities)
        .where(eq(financingFacilities.applicationId, applicationId));
      let ordinal = next;
      const facilityIds = new Map<string, string>();
      for (const facility of input.facilities) {
        if (facility.facilityId) {
          facilityIds.set(facility.key, facility.facilityId);
          continue;
        }
        ordinal += 1;
        const [created] = await tx
          .insert(financingFacilities)
          .values({
            bankId,
            applicationId,
            origin: "structured",
            ordinal,
            introducedInStructureId: structureId,
            createdByUserId: userId,
            createdAt: now,
          })
          .returning({ id: financingFacilities.id });
        if (!created) throw new Error("Facility insert failed.");
        facilityIds.set(facility.key, created.id);
      }
      const versionIds = new Map<string, string>();
      for (const [position, facility] of input.facilities.entries()) {
        const security =
          facility.family === "conventional_term" ? (facility.security ?? null) : null;
        const policy = resolveFinancingPolicy(
          policies,
          { family: facility.family, security, principal: facility.principal },
          today,
        );
        const [version] = await tx
          .insert(financingFacilityVersions)
          .values({
            bankId,
            applicationId,
            structureRevisionId: structureId,
            facilityId: facilityIds.get(facility.key) as string,
            position,
            draftKey: facility.key,
            family: facility.family,
            security,
            productPolicyId: policy?.id ?? null,
            principal: facility.principal,
            createdAt: now,
          })
          .returning({ id: financingFacilityVersions.id });
        if (!version) throw new Error("Facility version insert failed.");
        versionIds.set(facility.key, version.id);
      }
      const useIds = new Map<string, string>();
      for (const [position, use] of input.uses.entries()) {
        const [row] = await tx
          .insert(financingUses)
          .values({
            bankId,
            applicationId,
            structureRevisionId: structureId,
            position,
            draftKey: use.key,
            category: use.category,
            description: use.description,
            amount: use.amount,
          })
          .returning({ id: financingUses.id });
        if (!row) throw new Error("Use insert failed.");
        useIds.set(use.key, row.id);
      }
      const sourceIds = new Map<string, string>();
      for (const [position, source] of input.sources.entries()) {
        const [row] = await tx
          .insert(financingSources)
          .values({
            bankId,
            applicationId,
            structureRevisionId: structureId,
            position,
            draftKey: source.key,
            kind: source.kind,
            description: source.description,
            amount: source.amount,
          })
          .returning({ id: financingSources.id });
        if (!row) throw new Error("Source insert failed.");
        sourceIds.set(source.key, row.id);
      }
      if (input.allocations.length)
        await tx.insert(financingAllocations).values(
          input.allocations.map((a) => ({
            bankId,
            applicationId,
            structureRevisionId: structureId,
            useId: useIds.get(a.useKey) as string,
            facilityVersionId: a.facilityKey ? (versionIds.get(a.facilityKey) ?? null) : null,
            sourceId: a.sourceKey ? (sourceIds.get(a.sourceKey) ?? null) : null,
            amount: a.amount,
          })),
        );
      const edges = input.lineage.flatMap((entry) =>
        entry.predecessorFacilityIds.flatMap((predecessor) =>
          entry.successorKeys.map((key) => ({
            bankId,
            applicationId,
            structureRevisionId: structureId,
            kind: entry.kind,
            predecessorFacilityId: predecessor,
            successorFacilityId: facilityIds.get(key) as string,
          })),
        ),
      );
      if (edges.length) await tx.insert(financingFacilityLineage).values(edges);
      await tx.insert(financingCommands).values({
        bankId,
        applicationId,
        actorUserId: userId,
        operation: "save_draft",
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        resultId: structureId,
        createdAt: now,
      });
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: "financing.draft_saved",
        targetType: "financing_structure",
        targetId: structureId,
        changedFields: ["facilities", "uses", "sources", "allocations", "lineage"],
        requestId,
        metadata: {
          draftRevision: structure.draftRevision,
          facilities: input.facilities.length,
          uses: input.uses.length,
          sources: input.sources.length,
        },
        createdAt: now,
      });
      return view(tx, app, access, now);
    });
  }

  async function publish(
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    const parsed = publishFinancingDraftSchema.safeParse(raw);
    if (!parsed.success) badInput("Invalid financing publication.");
    const input = parsed.data;
    return db.transaction(async (tx) => {
      const { app, access, userId } = await staffStructured(tx, actor, bankId, applicationId);
      const payloadHash = hashIdentityCredential(JSON.stringify(input));
      if (await replay(tx, app, input, "publish", userId, payloadHash))
        return view(tx, app, access, clock());
      requireEditable(app);
      if (app.revision !== input.expectedRevision) conflict();
      const [draft] = await tx
        .select()
        .from(financingStructureRevisions)
        .where(
          and(
            scope(financingStructureRevisions, app),
            eq(financingStructureRevisions.state, "draft"),
          ),
        )
        .for("update");
      if (!draft || draft.draftRevision !== input.expectedDraftRevision) conflict();
      const now = clock();
      const today = now.toISOString().slice(0, 10);
      const history = await requests(tx, app);
      const policies = await tx
        .select()
        .from(financingProductPolicies)
        .where(eq(financingProductPolicies.bankId, bankId));
      const children = await loadChildren(tx, app, [draft.id]);
      const evaluation = evaluationFor(draft, children, policies, history.at(-1) ?? null, today);
      if (!evaluation.ready.publication)
        invalid(
          `Resolve these items before publishing: ${evaluation.findings
            .filter((f) => f.blocks.includes("publication"))
            .map((f) => f.message)
            .join(" ")}`,
        );
      const [{ sequence } = { sequence: 0 }] = await tx
        .select({
          sequence: sql<number>`coalesce(max(${financingStructureRevisions.sequence}), 0)::int`,
        })
        .from(financingStructureRevisions)
        .where(scope(financingStructureRevisions, app));
      const [published] = await tx
        .update(financingStructureRevisions)
        .set({
          state: "published",
          sequence: sequence + 1,
          reason: input.reason,
          publishedByUserId: userId,
          publishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(financingStructureRevisions.id, draft.id),
            eq(financingStructureRevisions.state, "draft"),
          ),
        )
        .returning();
      if (!published) conflict();
      const updated = await bumpApplication(tx, app, {}, now);
      await tx.insert(financingCommands).values({
        bankId,
        applicationId,
        actorUserId: userId,
        operation: "publish",
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        resultId: published.id,
        createdAt: now,
      });
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: "financing.structure_published",
        targetType: "financing_structure",
        targetId: published.id,
        changedFields: ["state", "sequence"],
        requestId,
        metadata: {
          sequence: published.sequence,
          facilities: children.versions.length,
          applicationRevision: updated.revision,
        },
        createdAt: now,
      });
      return view(tx, updated, access, now);
    });
  }

  return { read, saveRequest, saveDraft, publish };
}
export type FinancingService = ReturnType<typeof createFinancingService>;
