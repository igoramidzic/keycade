import {
  approvedTermsSchema,
  closingViewSchema,
  fundedAccountSummarySchema,
  fundedAccountsViewSchema,
  recordFundingSchema,
  startClosingSchema,
} from "@keycade/contracts";
import {
  applicationClosingPackages,
  applicationDecisions,
  applicationParticipants,
  applicationSetups,
  applicationSubmissions,
  applications,
  applicationTasks,
  auditEvents,
  bankMemberships,
  banks,
  type ClosingConditionTemplate,
  checkRuns,
  closingCommands,
  closingConditions,
  type Database,
  type DatabaseTransaction,
  fundingRecords,
  loanAccounts,
  loanProducts,
  productClosingPolicies,
  taskAssignments,
  users,
} from "@keycade/db";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { type Actor, type ApplicationAccess, requireApplicationAccess } from "./authorization.js";
import { lockCheckApplication } from "./checks.js";
import { readClosingConditions } from "./closing-policy.js";
import { DomainError, deny } from "./errors.js";
import { hashIdentityCredential } from "./identity.js";
import {
  queueApplicationStatusNotifications,
  queueTaskNotification,
} from "./notification-intents.js";
import { evaluateReadiness } from "./readiness.js";
import { createSignatureEvidenceReader } from "./signatures.js";
import { reconcileTasks } from "./tasks.js";

type Tx = DatabaseTransaction;
type App = typeof applications.$inferSelect;
export const defaultClosingConditions: ClosingConditionTemplate[] = [
  {
    key: "funding-confirmation",
    title: "Confirm simulated funding readiness",
    description: "Confirm that the approved funding shown here is a simulation and moves no money.",
    kind: "task",
    required: true,
  },
  {
    key: "closing-agreement",
    title: "Sign simulated closing agreement",
    description:
      "Bank staff prepare a clean synthetic closing document and select the intended verified signers. Every intended signer must complete this simulated agreement.",
    kind: "signature",
    required: true,
  },
];
function invalid(message: string): never {
  throw new DomainError("INVALID_STATE", 409, message);
}
const conflict = (): never => {
  throw new DomainError("REVISION_CONFLICT", 409, "The application changed. Reload and try again.");
};
async function accessFor(tx: Tx, actor: Actor, app: App) {
  const access = await requireApplicationAccess(tx, actor, app.bankId, app.id);
  if (
    actor.kind !== "user" ||
    !app.synthetic ||
    !(
      access.kind === "staff" ||
      (access.kind === "participant" &&
        access.role === "applicant_admin" &&
        access.scope === "full")
    )
  )
    return deny();
  return { access, userId: actor.userId };
}
async function approved(tx: Tx, app: App) {
  const [row] = await tx
    .select({ decision: applicationDecisions, submission: applicationSubmissions })
    .from(applicationDecisions)
    .innerJoin(
      applicationSubmissions,
      eq(applicationSubmissions.id, applicationDecisions.submissionId),
    )
    .where(
      and(
        eq(applicationDecisions.bankId, app.bankId),
        eq(applicationDecisions.applicationId, app.id),
        eq(applicationDecisions.outcome, "approved"),
      ),
    )
    .orderBy(desc(applicationDecisions.applicationRevision))
    .limit(1);
  if (!row || !row.decision.approvedAmount) return null;
  const facts = row.submission.snapshot.facts;
  const terms = approvedTermsSchema.parse({
    decisionId: row.decision.id,
    submissionId: row.submission.id,
    businessId: row.submission.snapshot.businessProfile.id,
    businessName: facts.businessName,
    productName: facts.productName,
    requestedAmount: facts.requestedAmount,
    approvedAmount: row.decision.approvedAmount,
    currency: "USD",
    approvedAt: row.decision.createdAt.toISOString(),
  });
  const current =
    app.businessId === terms.businessId &&
    app.businessName === terms.businessName &&
    app.requestedAmount === terms.requestedAmount &&
    app.purpose === facts.purpose &&
    app.industryCode === facts.industryCode &&
    app.industryTaxonomyVersion === facts.industryTaxonomyVersion &&
    app.productId === row.submission.snapshot.references.productId;
  return { ...row, terms, current };
}
async function ensurePolicy(tx: Tx, app: App, now: Date) {
  const [product] = await tx
    .select()
    .from(loanProducts)
    .where(and(eq(loanProducts.bankId, app.bankId), eq(loanProducts.id, app.productId ?? app.id)));
  if (!product) invalid("The approved product is unavailable.");
  // Migration configures existing hosted/local products; this initializes newly seeded/demo product versions.
  if (product.synthetic && product.slug === "business-credit")
    await tx
      .insert(productClosingPolicies)
      .values({
        bankId: app.bankId,
        productId: product.id,
        version: 1,
        amountPolicy: "exact_approved_amount",
        conditions: defaultClosingConditions,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [productClosingPolicies.productId, productClosingPolicies.version],
      });
  const [policy] = await tx
    .select()
    .from(productClosingPolicies)
    .where(
      and(
        eq(productClosingPolicies.bankId, app.bankId),
        eq(productClosingPolicies.productId, product.id),
      ),
    )
    .orderBy(desc(productClosingPolicies.version))
    .limit(1);
  if (
    !policy ||
    policy.amountPolicy !== "exact_approved_amount" ||
    !Array.isArray(policy.conditions) ||
    policy.conditions.length < 1 ||
    policy.conditions.length > 20 ||
    new Set(policy.conditions.map((c) => c.key)).size !== policy.conditions.length ||
    !policy.conditions.some((c) => c.kind === "signature" && c.required) ||
    policy.conditions.some(
      (c) =>
        !c.key ||
        !/^[a-z0-9-]{1,64}$/.test(c.key) ||
        !c.title?.trim() ||
        c.title.length > 160 ||
        typeof c.description !== "string" ||
        c.description.length > 2000 ||
        !["task", "signature"].includes(c.kind) ||
        typeof c.required !== "boolean",
    )
  )
    invalid("A valid versioned closing policy is required for this product.");
  return policy;
}
async function accountRow(tx: Tx, app: App) {
  const [row] = await tx
    .select({ account: loanAccounts, funding: fundingRecords })
    .from(loanAccounts)
    .innerJoin(fundingRecords, eq(fundingRecords.id, loanAccounts.fundingRecordId))
    .where(and(eq(loanAccounts.bankId, app.bankId), eq(loanAccounts.applicationId, app.id)));
  return row ?? null;
}
function accountSummary(row: {
  account: typeof loanAccounts.$inferSelect;
  funding: typeof fundingRecords.$inferSelect;
}) {
  const { account, funding } = row;
  return fundedAccountSummarySchema.parse({
    id: account.id,
    applicationId: account.applicationId,
    businessId: account.businessId,
    businessName: account.terms.businessName,
    productName: account.terms.productName,
    approvedAmount: account.terms.approvedAmount,
    fundedAmount: funding.fundedAmount,
    fundedOn: funding.fundedOn,
    reference: funding.reference,
    currency: funding.currency,
    simulated: true,
    createdAt: account.createdAt.toISOString(),
  });
}
async function view(tx: Tx, actor: Actor, app: App, access: ApplicationAccess) {
  const staff = access.kind === "staff";
  const decision = await approved(tx, app);
  const [pkg] = await tx
    .select()
    .from(applicationClosingPackages)
    .where(
      and(
        eq(applicationClosingPackages.bankId, app.bankId),
        eq(applicationClosingPackages.applicationId, app.id),
      ),
    );
  const signatureEvidenceCurrent = createSignatureEvidenceReader(tx);
  const conditions = await readClosingConditions(tx, app.bankId, app.id, signatureEvidenceCurrent);
  const readiness = await evaluateReadiness(tx, app, staff ? undefined : { actor, access }, {
    signatureEvidenceCurrent,
    packageExists: !!pkg,
    conditions,
  });
  const account = await accountRow(tx, app);
  const approvedCurrent = !!(
    decision?.current &&
    pkg?.decisionId === decision.decision.id &&
    JSON.stringify(approvedTermsSchema.parse(pkg.terms)) === JSON.stringify(decision.terms)
  );
  const gate = readiness.gates.find((g) => g.stage === "closing");
  if (app.status === "closing" && !approvedCurrent && gate) {
    gate.blockers.push({
      kind: "application",
      id: null,
      stage: "closing",
      title: "Current approved terms required",
      reason: "approved_terms_not_current",
    });
    gate.ready = false;
  }
  // On a funded account, conditions describe the immutable evidence recorded at funding, not a new gate.
  const recorded = account?.funding.evidence.conditions;
  return closingViewSchema.parse({
    applicationId: app.id,
    revision: app.revision,
    status: app.status,
    simulated: true,
    canManage: staff,
    capabilities: {
      startClosing: staff && app.status === "approved" && !!decision?.current && !pkg,
      recordFunding:
        staff &&
        app.status === "closing" &&
        approvedCurrent &&
        !!gate?.ready &&
        conditions.some((c) => c.required && c.kind === "signature") &&
        conditions.every((c) => !c.required || c.passes),
    },
    approvedTerms: pkg?.terms ?? decision?.terms ?? null,
    package: pkg
      ? {
          id: pkg.id,
          revision: pkg.revision,
          policyVersion: pkg.policyVersion,
          amountPolicy: pkg.amountPolicy,
          createdAt: pkg.createdAt.toISOString(),
        }
      : null,
    conditions: conditions.map((c) => ({
      ...c,
      passes:
        app.status === "funded" && Array.isArray(recorded)
          ? recorded.some(
              (r) =>
                r &&
                typeof r === "object" &&
                "id" in r &&
                r.id === c.id &&
                "passes" in r &&
                r.passes === true,
            )
          : c.passes,
    })),
    readiness,
    account: account ? accountSummary(account) : null,
  });
}
export function createClosingService(
  db: Pick<Database, "transaction">,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function read(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const app = await lockCheckApplication(tx, bankId, applicationId);
      const { access } = await accessFor(tx, actor, app);
      await reconcileTasks(tx, bankId, applicationId, "closing-read", clock());
      return view(tx, actor, app, access);
    });
  }
  async function mutate(
    action: "start" | "fund",
    actor: Actor,
    bankId: string,
    applicationId: string,
    raw: unknown,
    requestId: string,
  ) {
    const schema = action === "start" ? startClosingSchema : recordFundingSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new DomainError("INVALID_INPUT", 400, "Invalid closing action.");
    const data = parsed.data;
    return db.transaction(async (tx) => {
      const app = await lockCheckApplication(tx, bankId, applicationId);
      const { access, userId } = await accessFor(tx, actor, app);
      if (access.kind !== "staff") return deny();
      const payloadHash = hashIdentityCredential(JSON.stringify(data));
      const [previous] = await tx
        .select()
        .from(closingCommands)
        .where(
          and(
            eq(closingCommands.bankId, bankId),
            eq(closingCommands.applicationId, applicationId),
            eq(closingCommands.idempotencyKey, data.idempotencyKey),
          ),
        );
      if (previous) {
        if (
          previous.actorUserId !== userId ||
          previous.action !== action ||
          previous.payloadHash !== payloadHash
        )
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "This request key was used for a different closing action.",
          );
        return view(tx, actor, app, access);
      }
      if (app.revision !== data.expectedRevision) conflict();
      if (app.status !== (action === "start" ? "approved" : "closing"))
        invalid("This closing action is unavailable at the current application stage.");
      const now = clock();
      await reconcileTasks(tx, bankId, applicationId, requestId, now);
      const decision = await approved(tx, app);
      if (!decision?.current)
        invalid("Current immutable approved terms are required before closing or funding.");
      let [pkg] = await tx
        .select()
        .from(applicationClosingPackages)
        .where(
          and(
            eq(applicationClosingPackages.bankId, bankId),
            eq(applicationClosingPackages.applicationId, applicationId),
          ),
        );
      let accountId: string | null = null;
      if (action === "start") {
        if (pkg) invalid("This application already has a closing package.");
        const policy = await ensurePolicy(tx, app, now);
        [pkg] = await tx
          .insert(applicationClosingPackages)
          .values({
            bankId,
            applicationId,
            decisionId: decision.decision.id,
            submissionId: decision.submission.id,
            policyId: policy.id,
            policyVersion: policy.version,
            revision: 1,
            amountPolicy: policy.amountPolicy,
            terms: decision.terms,
            conditionTemplates: policy.conditions,
            createdByUserId: userId,
            createdAt: now,
          })
          .returning();
        if (!pkg) throw new Error("Closing package insert failed.");
        const [assignee] = await tx
          .select()
          .from(applicationParticipants)
          .where(
            and(
              eq(applicationParticipants.bankId, bankId),
              eq(applicationParticipants.applicationId, applicationId),
              eq(applicationParticipants.role, "applicant_admin"),
              eq(applicationParticipants.scope, "full"),
              isNull(applicationParticipants.revokedAt),
            ),
          )
          .orderBy(asc(applicationParticipants.id))
          .limit(1);
        for (const template of policy.conditions) {
          let [task] =
            template.key === "funding-confirmation"
              ? await tx
                  .select()
                  .from(applicationTasks)
                  .where(
                    and(
                      eq(applicationTasks.bankId, bankId),
                      eq(applicationTasks.applicationId, applicationId),
                      eq(applicationTasks.stableKey, "funding-confirmation:application"),
                      ne(applicationTasks.state, "cancelled"),
                    ),
                  )
                  .limit(1)
              : [];
          const description = `${template.description} Approved synthetic ${decision.terms.productName}: USD ${decision.terms.approvedAmount}. No money will move.`;
          if (task) {
            [task] = await tx
              .update(applicationTasks)
              .set({
                state: "open",
                reviewedEvidenceRevision: null,
                revision: task.revision + 1,
                description,
                updatedAt: now,
              })
              .where(eq(applicationTasks.id, task.id))
              .returning();
          } else {
            [task] = await tx
              .insert(applicationTasks)
              .values({
                bankId,
                applicationId,
                stableKey: `closing:${pkg.id}:${template.key}`,
                source: "manual",
                title: template.title,
                description,
                reason: "Required by the versioned closing policy for the approved terms.",
                stage: "closing",
                required: template.required,
                state: "open",
                visibility: "shared",
                assigneeParticipantId: assignee?.id ?? null,
                assigneeGenerationAt: assignee?.unassignedAt ?? null,
                inputRevision: app.revision + 1,
                inputFingerprint: `closing:${decision.decision.id}:${policy.id}:${policy.version}`,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            if (task && assignee)
              await tx.insert(taskAssignments).values({
                bankId,
                applicationId,
                taskId: task.id,
                participantId: assignee.id,
                actorUserId: userId,
                createdAt: now,
              });
          }
          if (!task) throw new Error("Closing condition task insert failed.");
          await tx.insert(closingConditions).values({
            bankId,
            applicationId,
            packageId: pkg.id,
            key: template.key,
            title: template.title,
            kind: template.kind,
            required: template.required,
            taskId: task.id,
            createdAt: now,
          });
          await queueTaskNotification(tx, task, "task.created", now);
        }
      } else {
        if (
          !pkg ||
          pkg.decisionId !== decision.decision.id ||
          JSON.stringify(approvedTermsSchema.parse(pkg.terms)) !== JSON.stringify(decision.terms)
        )
          invalid("The closing package no longer matches the approved terms.");
        const signatureEvidenceCurrent = createSignatureEvidenceReader(tx);
        const conditions = await readClosingConditions(
          tx,
          bankId,
          applicationId,
          signatureEvidenceCurrent,
        );
        if (
          !conditions.some((c) => c.kind === "signature" && c.required) ||
          conditions.some((c) => c.required && !c.passes)
        )
          invalid(
            "Complete every required closing condition and current simulated signature first.",
          );
        const readiness = await evaluateReadiness(tx, app, undefined, {
          signatureEvidenceCurrent,
          packageExists: true,
          conditions,
        });
        if (!readiness.gates.find((g) => g.stage === "closing")?.ready)
          invalid("Current required tasks, checks and signed evidence must pass the closing gate.");
        const fund = recordFundingSchema.parse(data);
        if (
          pkg.amountPolicy !== "exact_approved_amount" ||
          fund.fundedAmount !== pkg.terms.approvedAmount
        )
          invalid(
            "This demo product records one funding event equal to the exact approved amount.",
          );
        const today = now.toISOString().slice(0, 10),
          earliest = decision.decision.createdAt.toISOString().slice(0, 10);
        if (fund.fundedOn < earliest || fund.fundedOn > today)
          invalid("The funding date must be on or after approval and no later than today (UTC).");
        const taskEvidence = await tx
          .select({
            taskId: applicationTasks.id,
            evidenceRevision: applicationTasks.evidenceRevision,
            reviewedEvidenceRevision: applicationTasks.reviewedEvidenceRevision,
            state: applicationTasks.state,
          })
          .from(applicationTasks)
          .where(
            and(
              eq(applicationTasks.bankId, bankId),
              eq(applicationTasks.applicationId, applicationId),
              eq(applicationTasks.required, true),
              ne(applicationTasks.state, "cancelled"),
            ),
          );
        const currentChecks = await tx
          .select({ id: checkRuns.id, fingerprint: checkRuns.fingerprint })
          .from(checkRuns)
          .where(
            and(
              eq(checkRuns.bankId, bankId),
              eq(checkRuns.applicationId, applicationId),
              eq(checkRuns.stale, false),
            ),
          );
        const [funding] = await tx
          .insert(fundingRecords)
          .values({
            bankId,
            applicationId,
            packageId: pkg.id,
            decisionId: decision.decision.id,
            approvedAmount: pkg.terms.approvedAmount,
            fundedAmount: fund.fundedAmount,
            fundedOn: fund.fundedOn,
            reference: fund.reference,
            simulated: true,
            recordedByUserId: userId,
            evidence: { conditions, tasks: taskEvidence, checks: currentChecks },
            createdAt: now,
          })
          .returning();
        if (!funding) throw new Error("Funding insert failed.");
        const [account] = await tx
          .insert(loanAccounts)
          .values({
            bankId,
            applicationId,
            businessId: pkg.terms.businessId,
            fundingRecordId: funding.id,
            terms: pkg.terms,
            simulated: true,
            createdAt: now,
          })
          .returning();
        if (!account) throw new Error("Funded account insert failed.");
        accountId = account.id;
      }
      if (!pkg) throw new Error("Closing package unavailable.");
      const [updated] = await tx
        .update(applications)
        .set({
          status: action === "start" ? "closing" : "funded",
          revision: app.revision + 1,
          updatedAt: now,
        })
        .where(and(eq(applications.id, applicationId), eq(applications.revision, app.revision)))
        .returning();
      if (!updated) conflict();
      await tx
        .update(applicationSetups)
        .set({ revision: updated.revision })
        .where(eq(applicationSetups.applicationId, applicationId));
      await tx.insert(closingCommands).values({
        bankId,
        applicationId,
        packageId: pkg.id,
        accountId,
        idempotencyKey: data.idempotencyKey,
        actorUserId: userId,
        action,
        payloadHash,
        applicationRevision: updated.revision,
        createdAt: now,
      });
      await tx.insert(auditEvents).values({
        bankId,
        applicationId,
        actorType: "user",
        actorUserId: userId,
        action: action === "start" ? "application.closing_started" : "application.funding_recorded",
        targetType: "application",
        targetId: applicationId,
        changedFields: ["status", "revision"],
        requestId,
        metadata: {
          revision: updated.revision,
          decisionId: decision.decision.id,
          closingPackageId: pkg.id,
          accountId,
        },
        createdAt: now,
      });
      await queueApplicationStatusNotifications(tx, bankId, applicationId, updated.revision, now);
      return view(tx, actor, updated, access);
    });
  }
  async function listAccounts(actor: Actor, bankId: string) {
    return db.transaction(async (tx) => {
      if (actor.kind !== "user" || (actor.demoBankId && actor.demoBankId !== bankId)) return deny();
      const [bank] = await tx.select().from(banks).where(eq(banks.id, bankId));
      const [user] = await tx.select().from(users).where(eq(users.id, actor.userId));
      if (!bank?.synthetic || !user?.synthetic) return deny();
      const [staff] = await tx
        .select()
        .from(bankMemberships)
        .where(
          and(
            eq(bankMemberships.bankId, bankId),
            eq(bankMemberships.userId, actor.userId),
            isNull(bankMemberships.revokedAt),
          ),
        )
        .for("share");
      const rows = await tx
        .selectDistinct({ account: loanAccounts, funding: fundingRecords })
        .from(loanAccounts)
        .innerJoin(fundingRecords, eq(fundingRecords.id, loanAccounts.fundingRecordId))
        .leftJoin(
          applicationParticipants,
          and(
            eq(applicationParticipants.applicationId, loanAccounts.applicationId),
            eq(applicationParticipants.bankId, bankId),
            eq(applicationParticipants.userId, actor.userId),
            isNull(applicationParticipants.revokedAt),
            eq(applicationParticipants.role, "applicant_admin"),
            eq(applicationParticipants.scope, "full"),
          ),
        )
        .where(
          and(
            eq(loanAccounts.bankId, bankId),
            staff ? undefined : eq(applicationParticipants.userId, actor.userId),
          ),
        )
        .orderBy(desc(loanAccounts.createdAt));
      return fundedAccountsViewSchema.parse({
        simulated: true,
        accounts: rows.map(accountSummary),
      });
    });
  }
  return {
    read,
    listAccounts,
    startClosing: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("start", a, b, c, d, e),
    recordFunding: (a: Actor, b: string, c: string, d: unknown, e: string) =>
      mutate("fund", a, b, c, d, e),
  };
}
export type ClosingService = ReturnType<typeof createClosingService>;
