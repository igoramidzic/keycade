import { createHash, randomUUID } from "node:crypto";
import {
  applicationPageSchema,
  applicationPortalSchema,
  applicationSelectionSchema,
  applicationSetupDefinitionVersion,
  applicationSetupSchema,
  type BusinessAddress,
  createDraftSchema,
  finishApplicationSetupSchema,
  fundingPurposeCatalogVersion,
  pageQuerySchema,
  publicStartApplicationSchema,
  saveApplicationSetupSchema,
  type TaskProgress,
} from "@keycade/contracts";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationParticipants,
  applicationRequests,
  applicationReviewEvents,
  applicationSetups,
  applications,
  auditEvents,
  bankMemberships,
  banks,
  businesses,
  closingCommands,
  type Database,
  type DatabaseTransaction,
  identityRateLimits,
  loanAccounts,
  loanProducts,
  users,
} from "@keycade/db";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { claimApplicationInTransaction } from "./application-claims.js";
import {
  type Actor,
  type ApplicationAccess,
  requireApplicantPortalAccess,
  requireApplicationAccess,
} from "./authorization.js";
import { reconcileFootprint } from "./checks.js";
import { readSetupBusinessEin } from "./enrichment.js";
import { DomainError, deny } from "./errors.js";
import { recordApplicantActivity } from "./notification-intents.js";
import { readTaskProgress, reconcileTasks } from "./tasks.js";

const accepted = { message: "If the request is eligible, a continuation link will be sent." };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function invalid(message = "Invalid request."): never {
  throw new DomainError("INVALID_INPUT", 400, message);
}
function conflict(): never {
  throw new DomainError("REVISION_CONFLICT", 409, "The application changed. Reload and try again.");
}
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, JSON.parse(canonical(v))]),
      ),
    );
  return JSON.stringify(value);
}
function parse<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid();
  return parsed.data;
}
const cents = (amount: string) => BigInt(amount.replace(".", ""));
type Tx = DatabaseTransaction;
type Row = typeof applications.$inferSelect;
type Setup = typeof applicationSetups.$inferSelect;
type Access = ApplicationAccess;

function selection(
  row: Row,
  setup: Setup,
  access: Access | null,
  claimRequired = false,
  productName: string | null = null,
  taskProgress: TaskProgress | null = null,
) {
  const accessScope = access?.kind === "participant" ? access.scope : "full";
  const closed = ["withdrawn", "declined", "funded"].includes(row.status);
  return applicationSelectionSchema.parse({
    id: row.id,
    bankId: row.bankId,
    businessId: row.businessId,
    businessName: row.businessName,
    productName,
    updatedAt: row.updatedAt.toISOString(),
    accessScope,
    productId: row.productId,
    requestedAmount: accessScope === "assigned" ? null : row.requestedAmount,
    status: row.status,
    revision: row.revision,
    synthetic: row.synthetic,
    setupStatus: setup.completedAt ? "completed" : "in_progress",
    currentStep: setup.currentStep === "product" ? "amount" : setup.currentStep,
    claimRequired,
    taskProgress,
    nextDestination: closed
      ? "closed"
      : access?.kind === "participant" && access.role !== "applicant_admin"
        ? "assigned"
        : setup.completedAt
          ? "portal"
          : "setup",
  });
}
async function view(tx: Tx, row: Row, setup: Setup, access: Access) {
  // Resolve only after application authorization. Existing drafts retain their selected
  // version even when the public catalog advertises a newer version or it is retired.
  const [selectedProduct] = row.productId
    ? await tx
        .select({
          id: loanProducts.id,
          slug: loanProducts.slug,
          name: loanProducts.name,
          version: loanProducts.version,
          minimumAmount: loanProducts.minimumAmount,
          maximumAmount: loanProducts.maximumAmount,
          currency: loanProducts.currency,
          active: loanProducts.active,
        })
        .from(loanProducts)
        .where(and(eq(loanProducts.id, row.productId), eq(loanProducts.bankId, row.bankId)))
        .limit(1)
    : [];
  return applicationSetupSchema.parse({
    ...selection(row, setup, access, false, selectedProduct?.name ?? null),
    selectedProduct: selectedProduct ?? null,
    purpose: row.purpose,
    businessAddress: row.businessAddress,
    businessAddressRevision: row.businessAddressRevision,
    website: row.website,
    fundingPurposes: row.fundingPurposes,
    purposeCatalogVersion: row.purposeCatalogVersion,
    otherPurposeDetail: row.otherPurposeDetail,
    businessEin: await readSetupBusinessEin(tx, row.bankId, row.id),
    industryCode: row.industryCode,
    industryTaxonomyVersion: row.industryTaxonomyVersion,
    definitionVersion: setup.definitionVersion,
    completedSteps: setup.completedSteps,
    skippedSteps: setup.skippedSteps,
    completedAt: setup.completedAt?.toISOString() ?? null,
  });
}
async function summary(tx: Tx, actor: Actor, row: Row, setup: Setup, access: Access) {
  const [product] = row.productId
    ? await tx
        .select({ name: loanProducts.name })
        .from(loanProducts)
        .where(and(eq(loanProducts.id, row.productId), eq(loanProducts.bankId, row.bankId)))
    : [];
  const taskProgress =
    access.kind === "participant" && access.role === "applicant_admin" && !setup.completedAt
      ? null
      : await readTaskProgress(tx, actor, access, row.bankId, row.id);
  return selection(row, setup, access, false, product?.name ?? null, taskProgress);
}
async function records(tx: Tx, bankId: string, applicationId: string) {
  const [result] = await tx
    .select({ row: applications, setup: applicationSetups })
    .from(applications)
    .innerJoin(
      applicationSetups,
      and(
        eq(applicationSetups.applicationId, applications.id),
        eq(applicationSetups.bankId, applications.bankId),
      ),
    )
    .where(and(eq(applications.id, applicationId), eq(applications.bankId, bankId)))
    .for("update");
  return result ?? deny();
}
async function identity(tx: Tx, actor: Actor, bankId: string) {
  if (actor.kind !== "user" || (actor.demoBankId && actor.demoBankId !== bankId)) return deny();
  const [bank] = await tx.select().from(banks).where(eq(banks.id, bankId));
  const [user] = await tx.select().from(users).where(eq(users.id, actor.userId));
  if (
    !bank ||
    !user ||
    (actor.demoBankId ? !bank.synthetic || !user.synthetic : !user.emailVerifiedAt)
  )
    return deny();
  const [membership] = await tx
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
  return { bank, user, membership };
}
function editor(access: Access) {
  if (
    access.kind !== "staff" &&
    !(access.kind === "participant" && access.role === "applicant_admin" && access.scope === "full")
  )
    return deny();
}
async function requestRecord(
  tx: Tx,
  bankId: string,
  scope: string,
  operation: string,
  key: string,
  payload: unknown,
) {
  const keyHash = hash(key);
  // Serialize an operation before any domain writes; a failed transaction releases the key.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${bankId}:${scope}:${operation}:${keyHash}`}, 0))`,
  );
  const payloadHash = hash(canonical(payload));
  const [existing] = await tx
    .select()
    .from(applicationRequests)
    .where(
      and(
        eq(applicationRequests.bankId, bankId),
        eq(applicationRequests.scope, scope),
        eq(applicationRequests.operation, operation),
        eq(applicationRequests.keyHash, keyHash),
      ),
    );
  if (existing && existing.payloadHash !== payloadHash)
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "This request key was already used with different input.",
    );
  return { existing, values: { bankId, scope, operation, keyHash, payloadHash } };
}
async function audit(
  tx: Tx,
  row: Row,
  actor: Actor,
  action: string,
  fields: string[],
  requestId: string,
  now: Date,
) {
  if (
    actor.kind === "user" &&
    ["application.setup_saved", "application.setup_completed"].includes(action)
  )
    await recordApplicantActivity(tx, row.bankId, row.id, actor.userId, now);
  await tx.insert(auditEvents).values({
    bankId: row.bankId,
    applicationId: row.id,
    actorType: actor.kind === "user" ? "user" : "system",
    actorUserId: actor.kind === "user" ? actor.userId : null,
    action,
    targetType: "application",
    targetId: row.id,
    changedFields: fields,
    requestId,
    metadata: {
      source: row.source,
      simulated: row.synthetic,
      authenticationMethod:
        actor.kind === "user" && actor.demoBankId
          ? "demo"
          : actor.kind === "user"
            ? "email_link"
            : "public",
    },
    createdAt: now,
  });
}
async function defaultProduct(tx: Tx, bankId: string) {
  const [selected] = await tx
    .select()
    .from(loanProducts)
    .where(
      and(
        eq(loanProducts.bankId, bankId),
        eq(loanProducts.slug, "business-credit"),
        eq(loanProducts.active, true),
        eq(loanProducts.synthetic, true),
      ),
    )
    .orderBy(sql`${loanProducts.version} DESC`)
    .limit(1)
    .for("share");
  return selected;
}
async function product(tx: Tx, bankId: string, productId: string, syntheticOnly = false) {
  const [row] = await tx
    .select()
    .from(loanProducts)
    .where(
      and(
        eq(loanProducts.id, productId),
        eq(loanProducts.bankId, bankId),
        eq(loanProducts.active, true),
      ),
    )
    .for("share");
  if (!row || (syntheticOnly && !row.synthetic)) return invalid("Select an available product.");
  return row;
}
async function validateAmount(
  tx: Tx,
  row: Pick<Row, "bankId" | "productId" | "demoCreated" | "requestedAmount">,
  requireProduct: boolean,
) {
  if (!row.productId) {
    if (requireProduct) invalid("Select a product.");
    return;
  }
  const selected = await product(tx, row.bankId, row.productId, row.demoCreated);
  if (
    row.requestedAmount &&
    (cents(row.requestedAmount) <= 0n ||
      cents(row.requestedAmount) < cents(selected.minimumAmount) ||
      cents(row.requestedAmount) > cents(selected.maximumAmount))
  )
    invalid("The amount is outside this product's limits.");
}
function requireSetupVersion(setup: Setup, version?: number) {
  if (
    setup.definitionVersion !== applicationSetupDefinitionVersion ||
    version !== applicationSetupDefinitionVersion
  )
    throw new DomainError(
      "SETUP_VERSION_UNSUPPORTED",
      409,
      "The setup questions changed. Reload to continue with your saved answers.",
    );
}
function validatePurposes(
  input: Pick<Row, "fundingPurposes" | "purposeCatalogVersion" | "otherPurposeDetail">,
) {
  if (input.fundingPurposes.length && input.purposeCatalogVersion !== fundingPurposeCatalogVersion)
    invalid("Select funding purposes from the current catalog.");
  if (
    input.purposeCatalogVersion !== null &&
    input.purposeCatalogVersion !== fundingPurposeCatalogVersion
  )
    invalid("This funding purpose catalog is not supported.");
  if (input.otherPurposeDetail && !input.fundingPurposes.includes("other"))
    invalid("Select Other before providing its optional details.");
}
async function contact(tx: Tx, bankId: string, email: string, synthetic: boolean, now: Date) {
  const [record] = await tx
    .insert(applicantContacts)
    .values({ bankId, email, synthetic, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [applicantContacts.bankId, applicantContacts.email],
      set: { updatedAt: now },
    })
    .returning();
  if (!record) throw new Error("Contact creation failed.");
  return record;
}
async function createApplication(
  tx: Tx,
  input: {
    bankId: string;
    contactId: string;
    productId?: string;
    businessId?: string;
    businessName?: string;
    requestedAmount?: string;
    purpose?: string;
    businessAddress?: BusinessAddress;
    website?: string | null;
    fundingPurposes?: string[];
    purposeCatalogVersion?: string;
    otherPurposeDetail?: string | null;
    prefilledFields?: string[];
    actor: Actor;
    source: "borrower" | "staff";
    synthetic: boolean;
    requestId: string;
    now: Date;
  },
) {
  validatePurposes({
    fundingPurposes: input.fundingPurposes ?? [],
    purposeCatalogVersion: input.purposeCatalogVersion ?? null,
    otherPurposeDetail: input.otherPurposeDetail ?? null,
  });
  await validateAmount(
    tx,
    {
      bankId: input.bankId,
      productId: input.productId ?? null,
      demoCreated: input.actor.kind === "user" && Boolean(input.actor.demoBankId),
      requestedAmount: input.requestedAmount ?? null,
    },
    false,
  );
  const [row] = await tx
    .insert(applications)
    .values({
      bankId: input.bankId,
      contactId: input.contactId,
      productId: input.productId,
      businessId: input.businessId,
      businessName: input.businessName,
      requestedAmount: input.requestedAmount,
      purpose: input.purpose,
      businessAddress: input.businessAddress,
      businessAddressRevision: input.businessAddress ? 1 : 0,
      website: input.website,
      fundingPurposes: input.fundingPurposes,
      purposeCatalogVersion: input.purposeCatalogVersion,
      otherPurposeDetail: input.otherPurposeDetail,
      source: input.source,
      synthetic: input.synthetic,
      demoCreated: input.actor.kind === "user" && Boolean(input.actor.demoBankId),
      createdByUserId: input.actor.kind === "user" ? input.actor.userId : null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  if (!row) throw new Error("Application creation failed.");
  const [setup] = await tx
    .insert(applicationSetups)
    .values({ bankId: row.bankId, applicationId: row.id })
    .returning();
  if (!setup) throw new Error("Setup creation failed.");
  await reconcileFootprint(tx, row, input.requestId, input.now);
  await audit(
    tx,
    row,
    input.actor,
    "application.created",
    input.prefilledFields ?? [],
    input.requestId,
    input.now,
  );
  return { row, setup };
}

export function createApplicationService(
  db: Database,
  options: {
    clock?: () => Date;
    staffContinuationOrigin?: string;
    requireStaffContinuation?: boolean;
  } = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function publicStart(
    input: unknown,
    context: { origin: string; requestId: string; rateLimitKey: string },
  ) {
    const parsed = parse(publicStartApplicationSchema, input);
    const email = parsed.email.trim().toLowerCase();
    let origin: URL;
    try {
      origin = new URL(context.origin);
    } catch {
      return invalid();
    }
    if (
      origin.origin !== context.origin ||
      origin.username ||
      origin.password ||
      !context.rateLimitKey ||
      !(
        origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
      )
    )
      return invalid();
    return db.transaction(async (tx) => {
      const now = clock();
      const [bank] = await tx.select().from(banks).where(eq(banks.slug, parsed.bankSlug));
      // A 256-bit random key identifies this public request only; it grants no record access.
      const request = bank
        ? await requestRecord(tx, bank.id, "public-start", "create", parsed.idempotencyKey, {
            ...parsed,
            email,
            origin: context.origin,
          })
        : null;
      if (request?.existing) return accepted;
      let allowed = true;
      const keys = [
        { key: `start-email:${parsed.bankSlug}:${email}`, limit: 5 },
        { key: `start-ip:${context.rateLimitKey}`, limit: 20 },
      ];
      for (const item of keys.sort((a, b) => a.key.localeCompare(b.key))) {
        const resetAt = new Date(now.getTime() + 15 * 60_000);
        const [counter] = await tx
          .insert(identityRateLimits)
          .values({ keyHash: hash(item.key), count: 1, resetAt })
          .onConflictDoUpdate({
            target: identityRateLimits.keyHash,
            set: {
              count: sql`CASE WHEN ${identityRateLimits.resetAt} <= ${now} THEN 1 ELSE ${identityRateLimits.count} + 1 END`,
              resetAt: sql`CASE WHEN ${identityRateLimits.resetAt} <= ${now} THEN ${resetAt} ELSE ${identityRateLimits.resetAt} END`,
            },
          })
          .returning();
        if (!counter || counter.count > item.limit) allowed = false;
      }
      if (!allowed || !bank || !request) return accepted;
      if (parsed.productSlug && parsed.productSlug !== "business-credit") return accepted;
      const selected = await defaultProduct(tx, bank.id);
      if (!selected) return accepted;
      const productId = selected.id;
      const pending = await contact(tx, bank.id, email, bank.synthetic, now);
      const { row } = await createApplication(tx, {
        bankId: bank.id,
        contactId: pending.id,
        productId,
        actor: { kind: "anonymous" },
        source: "borrower",
        synthetic: bank.synthetic,
        requestId: context.requestId,
        now,
      });
      await tx.insert(accessDeliveryRequests).values({
        bankId: bank.id,
        contactId: pending.id,
        applicationId: row.id,
        portal: "borrower",
        origin: context.origin,
        returnPath: "/",
        expiresAt: new Date(now.getTime() + 60 * 60_000),
        requestId: context.requestId,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .insert(applicationRequests)
        .values({ ...request.values, applicationId: row.id, createdAt: now });
      return accepted;
    });
  }
  async function create(actor: Actor, bankId: string, input: unknown, requestId: string) {
    const parsed = parse(createDraftSchema, input);
    return db.transaction(async (tx) => {
      const now = clock();
      const { bank, user, membership } = await identity(tx, actor, bankId);
      const email = parsed.email?.trim().toLowerCase() ?? user.email;
      if (membership ? !parsed.email : email !== user.email || parsed.businessId) return deny();
      if (parsed.answers && !membership) return deny();
      if (membership && options.requireStaffContinuation && !options.staffContinuationOrigin)
        throw new DomainError(
          "AUTH_DELIVERY_UNAVAILABLE",
          503,
          "Application continuation email is unavailable in this environment.",
        );
      const request = await requestRecord(
        tx,
        bankId,
        `user:${user.id}`,
        "create",
        parsed.idempotencyKey,
        { ...parsed, email },
      );
      if (request.existing) {
        const { row, setup } = await records(tx, bankId, request.existing.applicationId);
        const access = await requireApplicationAccess(tx, actor, bankId, row.id);
        editor(access);
        return view(tx, row, setup, access);
      }
      const selected = await defaultProduct(tx, bankId);
      if (!selected) return invalid("Synthetic Business Credit is currently unavailable.");
      if (parsed.productId && parsed.productId !== selected.id)
        return invalid(
          "Applications use Synthetic Business Credit. The product cannot be selected.",
        );
      let businessName: string | undefined;
      if (parsed.businessId) {
        const [business] = await tx
          .select()
          .from(businesses)
          .where(and(eq(businesses.id, parsed.businessId), eq(businesses.bankId, bankId)))
          .for("share");
        if (!business || (actor.kind === "user" && actor.demoBankId && !business.synthetic))
          return deny();
        businessName = business.legalName;
      }
      const pending = await contact(tx, bankId, email, bank.synthetic, now);
      if (actor.kind === "user" && actor.demoBankId && !pending.synthetic) return deny();
      const { row, setup } = await createApplication(tx, {
        bankId,
        contactId: pending.id,
        productId: selected.id,
        businessId: parsed.businessId,
        businessName: parsed.answers?.businessName ?? businessName,
        requestedAmount: parsed.answers?.requestedAmount,
        purpose: parsed.answers?.purpose,
        businessAddress: parsed.answers?.businessAddress,
        website: parsed.answers?.website,
        fundingPurposes: parsed.answers?.fundingPurposes,
        purposeCatalogVersion: parsed.answers?.purposeCatalogVersion,
        otherPurposeDetail: parsed.answers?.otherPurposeDetail,
        prefilledFields: Object.keys(parsed.answers ?? {}),
        actor,
        source: membership ? "staff" : "borrower",
        synthetic: bank.synthetic,
        requestId,
        now,
      });
      if (!membership)
        await claimApplicationInTransaction(tx, actor, bankId, row.id, requestId, now);
      if (membership && options.staffContinuationOrigin) {
        const origin = new URL(options.staffContinuationOrigin);
        if (
          origin.origin !== options.staffContinuationOrigin ||
          origin.username ||
          origin.password ||
          !(
            origin.protocol === "https:" ||
            (origin.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
          )
        )
          return invalid("Invalid borrower continuation origin.");
        await tx.insert(accessDeliveryRequests).values({
          bankId,
          contactId: pending.id,
          applicationId: row.id,
          portal: "borrower",
          origin: options.staffContinuationOrigin,
          returnPath: "/",
          requestId,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx
        .insert(applicationRequests)
        .values({ ...request.values, applicationId: row.id, createdAt: now });
      return view(
        tx,
        row,
        setup,
        membership
          ? { kind: "staff", role: membership.role }
          : { kind: "participant", role: "applicant_admin", scope: "full" },
      );
    });
  }
  async function readSetup(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const { row, setup } = await records(tx, bankId, applicationId);
      const access = await requireApplicationAccess(tx, actor, bankId, applicationId);
      editor(access);
      return view(tx, row, setup, access);
    });
  }
  async function destination(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const { row, setup } = await records(tx, bankId, applicationId);
      const access = await requireApplicationAccess(tx, actor, bankId, applicationId);
      await reconcileTasks(tx, bankId, applicationId, randomUUID(), clock());
      return summary(tx, actor, row, setup, access);
    });
  }
  async function portal(actor: Actor, bankId: string, applicationId: string) {
    return db.transaction(async (tx) => {
      const { row, setup } = await records(tx, bankId, applicationId);
      const access = await requireApplicantPortalAccess(tx, actor, bankId, applicationId);
      await reconcileTasks(tx, bankId, applicationId, randomUUID(), clock());
      const selected = await summary(tx, actor, row, setup, access);
      // Project only general milestones. Reasons, private notes, task IDs, account
      // terms and participant identities never enter the borrower timeline.
      const reviewEvents = await tx
        .select({
          id: applicationReviewEvents.id,
          action: applicationReviewEvents.action,
          revision: applicationReviewEvents.applicationRevision,
          createdAt: applicationReviewEvents.createdAt,
        })
        .from(applicationReviewEvents)
        .where(
          and(
            eq(applicationReviewEvents.bankId, bankId),
            eq(applicationReviewEvents.applicationId, applicationId),
          ),
        );
      const closingEvents = await tx
        .select({
          id: closingCommands.id,
          action: closingCommands.action,
          revision: closingCommands.applicationRevision,
          createdAt: closingCommands.createdAt,
        })
        .from(closingCommands)
        .where(
          and(eq(closingCommands.bankId, bankId), eq(closingCommands.applicationId, applicationId)),
        );
      const statusByAction = {
        submit: "submitted",
        start_review: "in_review",
        request_information: "needs_information",
        approve: "approved",
        decline: "declined",
        withdraw: "withdrawn",
        start: "closing",
        fund: "funded",
      } as const;
      const [loanOfficer] = row.assignedStaffId
        ? await tx
            .select({
              displayName: users.displayName,
              email: users.email,
              synthetic: users.synthetic,
            })
            .from(bankMemberships)
            .innerJoin(users, eq(users.id, bankMemberships.userId))
            .where(
              and(
                eq(bankMemberships.bankId, bankId),
                eq(bankMemberships.userId, row.assignedStaffId),
                isNull(bankMemberships.revokedAt),
                eq(users.synthetic, true),
              ),
            )
        : [];
      // Match the funded-account service's authority; full collaborators still
      // do not receive account identities through this more general portal read.
      const accountAllowed =
        access.kind === "staff" ||
        (access.kind === "participant" &&
          access.role === "applicant_admin" &&
          access.scope === "full");
      const [account] =
        accountAllowed && row.status === "funded"
          ? await tx
              .select({ id: loanAccounts.id })
              .from(loanAccounts)
              .where(
                and(eq(loanAccounts.bankId, bankId), eq(loanAccounts.applicationId, applicationId)),
              )
          : [];
      return applicationPortalSchema.parse({
        ...selected,
        timelineEvents: [
          ...(setup.completedAt
            ? [
                {
                  id: applicationId,
                  status: "setup_completed",
                  createdAt: setup.completedAt.toISOString(),
                },
              ]
            : []),
          ...[...reviewEvents, ...closingEvents]
            .sort((left, right) => left.revision - right.revision)
            .map((event) => ({
              id: event.id,
              status: statusByAction[event.action],
              createdAt: event.createdAt.toISOString(),
            })),
        ],
        loanOfficer: loanOfficer ?? null,
        fundedAccountId: account?.id ?? null,
        canReview:
          actor.kind === "user" &&
          row.synthetic &&
          (access.kind === "staff" ||
            (access.kind === "participant" &&
              access.role === "applicant_admin" &&
              access.scope === "full")),
        purpose: selected.accessScope === "assigned" ? null : row.purpose,
        fundingPurposes: selected.accessScope === "assigned" ? [] : row.fundingPurposes,
        purposeCatalogVersion:
          selected.accessScope === "assigned" ? null : row.purposeCatalogVersion,
        otherPurposeDetail: selected.accessScope === "assigned" ? null : row.otherPurposeDetail,
        remainingTasks:
          (selected.taskProgress?.total ?? 0) - (selected.taskProgress?.completed ?? 0),
      });
    });
  }
  async function list(actor: Actor, bankId: string, query: unknown = {}) {
    const parsed = parse(pageQuerySchema, query);
    return db.transaction(async (tx) => {
      const { user, membership } = await identity(tx, actor, bankId);
      const rows = await tx
        .select({
          row: applications,
          setup: applicationSetups,
          participant: applicationParticipants,
          productName: loanProducts.name,
        })
        .from(applications)
        .innerJoin(
          applicationSetups,
          and(
            eq(applicationSetups.applicationId, applications.id),
            eq(applicationSetups.bankId, applications.bankId),
          ),
        )
        .leftJoin(
          loanProducts,
          and(
            eq(loanProducts.id, applications.productId),
            eq(loanProducts.bankId, applications.bankId),
          ),
        )
        .leftJoin(
          applicantContacts,
          and(
            eq(applicantContacts.id, applications.contactId),
            eq(applicantContacts.bankId, applications.bankId),
          ),
        )
        .leftJoin(
          applicationParticipants,
          and(
            eq(applicationParticipants.applicationId, applications.id),
            eq(applicationParticipants.userId, user.id),
          ),
        )
        .where(
          and(
            eq(applications.bankId, bankId),
            parsed.after ? gt(applications.id, parsed.after) : undefined,
            actor.kind === "user" && actor.demoBankId
              ? eq(applications.synthetic, true)
              : undefined,
            membership
              ? undefined
              : or(
                  and(
                    eq(applicationParticipants.userId, user.id),
                    isNull(applicationParticipants.revokedAt),
                  ),
                  and(
                    isNull(applicationParticipants.id),
                    eq(applicantContacts.email, user.email),
                    eq(applications.status, "draft"),
                    or(eq(applications.source, "borrower"), eq(applications.source, "staff")),
                    actor.kind === "user" && actor.demoBankId
                      ? eq(applicantContacts.synthetic, true)
                      : undefined,
                  ),
                ),
          ),
        )
        .orderBy(asc(applications.id))
        .limit(parsed.limit + 1);
      const items = [];
      // Lock in stable application order before current grant checks or reconciliation.
      // A revoked grant from the initial list snapshot must not expose task counts.
      for (const result of rows.slice(0, parsed.limit)) {
        const { participant, productName } = result;
        const { row, setup } = await records(tx, bankId, result.row.id);
        const access =
          membership || participant
            ? await requireApplicationAccess(tx, actor, bankId, row.id)
            : null;
        if (access) await reconcileTasks(tx, bankId, row.id, randomUUID(), clock());
        const taskProgress =
          access &&
          !(
            access.kind === "participant" &&
            access.role === "applicant_admin" &&
            !setup.completedAt
          )
            ? await readTaskProgress(tx, actor, access, bankId, row.id)
            : null;
        items.push(
          selection(row, setup, access, !membership && !participant, productName, taskProgress),
        );
      }
      return applicationPageSchema.parse({
        items,
        nextCursor: rows.length > parsed.limit ? items.at(-1)?.id : null,
      });
    });
  }
  async function claim(actor: Actor, bankId: string, applicationId: string, requestId: string) {
    return db.transaction(async (tx) => {
      await claimApplicationInTransaction(tx, actor, bankId, applicationId, requestId, clock());
      const { row, setup } = await records(tx, bankId, applicationId);
      return view(tx, row, setup, await requireApplicationAccess(tx, actor, bankId, applicationId));
    });
  }
  async function saveSetup(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(saveApplicationSetupSchema, input);
    return db.transaction(async (tx) => {
      const { row, setup } = await records(tx, bankId, applicationId);
      const access = await requireApplicationAccess(tx, actor, bankId, applicationId);
      editor(access);
      let canConfirm = access.kind !== "staff";
      if (access.kind === "staff") {
        const [applicant] =
          actor.kind === "user"
            ? await tx
                .select({ id: applicationParticipants.id })
                .from(applicationParticipants)
                .where(
                  and(
                    eq(applicationParticipants.bankId, bankId),
                    eq(applicationParticipants.applicationId, applicationId),
                    eq(applicationParticipants.userId, actor.userId),
                    eq(applicationParticipants.role, "applicant_admin"),
                    eq(applicationParticipants.scope, "full"),
                    isNull(applicationParticipants.revokedAt),
                  ),
                )
                .for("share")
            : [];
        canConfirm = Boolean(applicant);
        if (parsed.step && !canConfirm)
          invalid("Only the applicant can confirm or skip setup answers.");
      }
      if (row.revision !== parsed.expectedRevision) return conflict();
      if (setup.completedAt || row.status !== "draft")
        throw new DomainError("INVALID_STATE", 409, "Setup is no longer editable.");
      requireSetupVersion(setup, parsed.definitionVersion);
      const candidate = { ...row, ...parsed.answers };
      if (
        parsed.answers.fundingPurposes !== undefined &&
        !candidate.fundingPurposes.includes("other")
      )
        candidate.otherPurposeDetail = null;
      validatePurposes(candidate);
      if (candidate.requestedAmount && cents(candidate.requestedAmount) <= 0n)
        invalid("Enter a positive amount.");
      if ((candidate.industryCode === null) !== (candidate.industryTaxonomyVersion === null))
        invalid("Industry code and taxonomy version must be supplied together.");
      if (parsed.answers.productId !== undefined && parsed.answers.productId !== row.productId)
        return invalid("The financial product is fixed for this application.");
      await validateAmount(tx, candidate, false);
      const completed = new Set(setup.completedSteps);
      const skipped = new Set(setup.skippedSteps);
      const fields: Record<string, string> = {
        businessName: "business_name",
        businessAddress: "business_address",
        website: "website",
        fundingPurposes: "purpose",
        purposeCatalogVersion: "purpose",
        otherPurposeDetail: "other_purpose",
        productId: "product",
        requestedAmount: "amount",
        purpose: "purpose",
        industryCode: "industry",
        industryTaxonomyVersion: "industry",
      };
      for (const key of Object.keys(parsed.answers) as (keyof typeof parsed.answers)[]) {
        if (canonical(candidate[key]) !== canonical(row[key])) {
          completed.delete(fields[key] as string);
          skipped.delete(fields[key] as string);
        }
      }
      if (!candidate.fundingPurposes.includes("other")) {
        completed.delete("other_purpose");
        skipped.delete("other_purpose");
      }
      if (
        parsed.skip &&
        !["industry", "website", "business_ein", "other_purpose"].includes(parsed.step ?? "")
      )
        invalid("Only optional questions can be skipped.");
      if (parsed.step) {
        const step = parsed.step;
        if (parsed.skip) {
          skipped.add(step);
          completed.delete(step);
        } else {
          const satisfied =
            step === "business_name"
              ? candidate.businessName
              : step === "business_address"
                ? candidate.businessAddress
                : step === "product"
                  ? candidate.productId
                  : step === "amount"
                    ? candidate.requestedAmount
                    : step === "purpose"
                      ? candidate.fundingPurposes.length > 0
                      : step === "website"
                        ? candidate.website
                        : step === "other_purpose"
                          ? candidate.fundingPurposes.includes("other") &&
                            candidate.otherPurposeDetail
                          : step === "business_ein"
                            ? (await readSetupBusinessEin(tx, bankId, applicationId)).present
                            : candidate.industryCode && candidate.industryTaxonomyVersion;
          if (!satisfied) invalid("Answer this question before continuing.");
          if (step === "amount") await validateAmount(tx, candidate, true);
          completed.add(step);
          skipped.delete(step);
        }
      }
      const now = clock();
      const [updated] = await tx
        .update(applications)
        .set({
          businessName: candidate.businessName,
          productId: candidate.productId,
          requestedAmount: candidate.requestedAmount,
          purpose: candidate.purpose,
          businessAddress: candidate.businessAddress,
          businessAddressRevision:
            canonical(candidate.businessAddress) !== canonical(row.businessAddress)
              ? row.businessAddressRevision + 1
              : row.businessAddressRevision,
          website: candidate.website,
          fundingPurposes: candidate.fundingPurposes,
          purposeCatalogVersion: candidate.purposeCatalogVersion,
          otherPurposeDetail: candidate.otherPurposeDetail,
          industryCode: candidate.industryCode,
          industryTaxonomyVersion: candidate.industryTaxonomyVersion,
          revision: row.revision + 1,
          updatedAt: now,
        })
        .where(eq(applications.id, row.id))
        .returning();
      const [updatedSetup] = await tx
        .update(applicationSetups)
        .set({
          revision: row.revision + 1,
          // Older clients may still send the removed product question; move to amount.
          currentStep:
            (canConfirm ? parsed.currentStep : setup.currentStep) === "other_purpose" &&
            !candidate.fundingPurposes.includes("other")
              ? "purpose"
              : canConfirm
                ? parsed.currentStep === "product"
                  ? "amount"
                  : parsed.currentStep
                : setup.currentStep,
          completedSteps: [...completed],
          skippedSteps: [...skipped],
        })
        .where(eq(applicationSetups.applicationId, row.id))
        .returning();
      if (!updated || !updatedSetup) throw new Error("Setup save failed.");
      await reconcileTasks(tx, bankId, applicationId, requestId, now);
      await audit(
        tx,
        updated,
        actor,
        "application.setup_saved",
        Object.keys(parsed.answers),
        requestId,
        now,
      );
      return view(tx, updated, updatedSetup, access);
    });
  }
  async function finishSetup(
    actor: Actor,
    bankId: string,
    applicationId: string,
    input: unknown,
    requestId: string,
  ) {
    const parsed = parse(finishApplicationSetupSchema, input);
    if (actor.kind !== "user") return deny();
    return db.transaction(async (tx) => {
      const request = await requestRecord(
        tx,
        bankId,
        `user:${actor.userId}`,
        `finish:${applicationId}`,
        parsed.idempotencyKey,
        parsed,
      );
      const { row, setup } = await records(tx, bankId, applicationId);
      // Staff membership alone never confirms the applicant's initial answers.
      const access = await requireApplicationAccess(tx, actor, bankId, applicationId);
      const [grant] = await tx
        .select()
        .from(applicationParticipants)
        .where(
          and(
            eq(applicationParticipants.applicationId, applicationId),
            eq(applicationParticipants.userId, actor.userId),
            eq(applicationParticipants.role, "applicant_admin"),
            eq(applicationParticipants.scope, "full"),
            isNull(applicationParticipants.revokedAt),
          ),
        )
        .for("share");
      if (!grant) return deny();
      if (request.existing) return view(tx, row, setup, access);
      if (row.revision !== parsed.expectedRevision) return conflict();
      if (setup.completedAt) {
        await tx
          .insert(applicationRequests)
          .values({ ...request.values, applicationId, createdAt: clock() });
        return view(tx, row, setup, access);
      }
      if (row.status !== "draft")
        throw new DomainError("INVALID_STATE", 409, "Setup cannot be completed.");
      requireSetupVersion(setup, parsed.definitionVersion);
      if (
        !row.businessName ||
        !row.productId ||
        !row.requestedAmount ||
        !row.businessAddress ||
        !row.fundingPurposes.length
      )
        invalid("Complete the required initial answers.");
      validatePurposes(row);
      if (
        ["business_name", "business_address", "amount", "purpose"].some(
          (step) => !setup.completedSteps.includes(step),
        )
      )
        invalid("Confirm each required answer before finishing setup.");
      const optional = [
        "business_ein",
        "industry",
        "website",
        ...(row.fundingPurposes.includes("other") ? ["other_purpose"] : []),
      ];
      if (
        optional.some(
          (step) => !setup.completedSteps.includes(step) && !setup.skippedSteps.includes(step),
        )
      )
        invalid("Answer or skip each optional question before finishing setup.");
      await validateAmount(tx, row, true);
      const now = clock();
      let businessId = row.businessId;
      if (!businessId) {
        const [business] = await tx
          .insert(businesses)
          .values({
            bankId,
            legalName: row.businessName,
            industryCode: row.industryCode,
            synthetic: row.synthetic,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!business) throw new Error("Business creation failed.");
        businessId = business.id;
      }
      const [updated] = await tx
        .update(applications)
        .set({
          businessId,
          status: "collecting_information",
          revision: row.revision + 1,
          updatedAt: now,
        })
        .where(eq(applications.id, applicationId))
        .returning();
      const [updatedSetup] = await tx
        .update(applicationSetups)
        .set({
          revision: row.revision + 1,
          currentStep: "review",
          completedSteps: [...new Set([...setup.completedSteps, "review"])],
          completedAt: now,
          completedByUserId: actor.userId,
        })
        .where(eq(applicationSetups.applicationId, applicationId))
        .returning();
      if (!updated || !updatedSetup) throw new Error("Setup completion failed.");
      await reconcileTasks(tx, bankId, applicationId, requestId, now);
      await audit(
        tx,
        updated,
        actor,
        "application.setup_completed",
        ["status", "setup"],
        requestId,
        now,
      );
      await tx
        .insert(applicationRequests)
        .values({ ...request.values, applicationId, createdAt: now });
      return view(tx, updated, updatedSetup, access);
    });
  }
  return {
    publicStart,
    create,
    list,
    readSetup,
    saveSetup,
    finishSetup,
    claim,
    destination,
    portal,
  };
}
