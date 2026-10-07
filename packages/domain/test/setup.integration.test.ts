import { randomBytes, randomUUID } from "node:crypto";
import {
  accessDeliveryRequests,
  applicantContacts,
  applicationParticipants,
  applicationSetups,
  applications,
  auditEvents,
  loanProducts,
  users,
} from "@keycade/db";
import { seedIds as ids, seedDatabase } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  createApplicationService,
  createIdentityService,
  readPublicIntake,
  readStaffApplication,
  requireApplicantPortalAccess,
  requireTaskAccess,
  updateApplicationPurpose,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const origin = "http://localhost:3001";
const officer: Actor = { kind: "user", userId: ids.officerA };
const clock = () => new Date("2026-10-07T12:00:00.000Z");
const accepted = {
  message: "If the request is eligible, a continuation link will be sent.",
};
const notFound = { code: "NOT_FOUND", statusCode: 404 };

beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
});

function service() {
  return createApplicationService(database.db, { clock });
}
async function verifiedApplicant() {
  const email = `${randomUUID()}@example.test`;
  const [user] = await database.db
    .insert(users)
    .values({
      email,
      displayName: "Synthetic applicant",
      emailVerifiedAt: clock(),
      synthetic: true,
    })
    .returning();
  if (!user) throw new Error("Expected synthetic applicant.");
  return { actor: { kind: "user", userId: user.id } as Actor, email };
}
function publicInput(email = `${randomUUID()}@example.test`) {
  return { email, bankSlug: "bank-a", idempotencyKey: randomBytes(32).toString("hex") };
}
function publicContext() {
  return { origin, requestId: randomUUID(), rateLimitKey: randomUUID() };
}
async function start(email = `${randomUUID()}@example.test`) {
  const input = publicInput(email);
  const context = publicContext();
  const response = await service().publicStart(input, context);
  const [delivery] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.requestId, context.requestId));
  if (!delivery?.applicationId) throw new Error("Expected application continuation delivery.");
  return { input, context, response, delivery, applicationId: delivery.applicationId };
}
async function consumeDelivery(deliveryId: string) {
  const identity = createIdentityService(database.db, { clock });
  const delivery = await identity.prepareDelivery(deliveryId);
  if (!delivery) throw new Error("Expected prepared synthetic continuation email.");
  const token = new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token");
  if (!token) throw new Error("Expected synthetic email token.");
  return identity.consumeAccessLink({
    token,
    origin,
    requestId: randomUUID(),
    rateLimitKey: randomUUID(),
  });
}
async function freshSession(email: string) {
  const identity = createIdentityService(database.db, { clock });
  const requestId = randomUUID();
  await identity.requestAccessLink({
    email,
    bankSlug: "bank-a",
    portal: "borrower",
    origin,
    returnPath: "/",
    requestId,
    rateLimitKey: randomUUID(),
  });
  const [delivery] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.requestId, requestId));
  if (!delivery) throw new Error("Expected fresh generic resume delivery.");
  return consumeDelivery(delivery.id);
}
async function create(actor: Actor, input: { productId?: string } = {}) {
  return service().create(
    actor,
    ids.bankA,
    { ...input, idempotencyKey: randomUUID() },
    randomUUID(),
  );
}
async function ready(actor: Actor, applicationId: string, revision: number) {
  const commands = [
    {
      step: "business_name",
      answers: { businessName: "Synthetic Workshop" },
      currentStep: "product",
    },
    { step: "product", answers: { productId: ids.productA }, currentStep: "amount" },
    { step: "amount", answers: { requestedAmount: "5000000.00" }, currentStep: "purpose" },
    {
      step: "purpose",
      answers: { purpose: "Synthetic equipment acquisition" },
      currentStep: "industry",
    },
    { step: "industry", answers: {}, skip: true, currentStep: "review" },
  ] as const;
  let view = await service().readSetup(actor, ids.bankA, applicationId);
  for (const command of commands) {
    view = await service().saveSetup(
      actor,
      ids.bankA,
      applicationId,
      { ...command, expectedRevision: revision },
      randomUUID(),
    );
    revision = view.revision;
  }
  return view;
}
async function audits(applicationId: string) {
  return database.db.select().from(auditEvents).where(eq(auditEvents.applicationId, applicationId));
}

describe("real PostgreSQL email-first application creation and resume", () => {
  it("creates a pending draft, setup, and delivery atomically before granting any identity access", async () => {
    const email = `Pending.${randomUUID()}+Exact@Example.Test`;
    const item = await start(email);
    expect(item.response).toEqual(accepted);
    expect(JSON.stringify(item.response)).not.toContain(item.applicationId);
    const [contact] = await database.db
      .select()
      .from(applicantContacts)
      .where(eq(applicantContacts.id, item.delivery.contactId));
    const [application] = await database.db
      .select()
      .from(applications)
      .where(eq(applications.id, item.applicationId));
    const [setup] = await database.db
      .select()
      .from(applicationSetups)
      .where(eq(applicationSetups.applicationId, item.applicationId));
    expect(contact).toMatchObject({ email: email.toLowerCase(), userId: null });
    expect(application).toMatchObject({
      bankId: ids.bankA,
      contactId: contact?.id,
      source: "borrower",
      status: "draft",
      createdByUserId: null,
      requestedAmount: null,
    });
    expect(setup).toMatchObject({
      definitionVersion: 1,
      currentStep: "business_name",
      completedSteps: [],
      skippedSteps: [],
      completedAt: null,
    });
    expect(
      await database.db.select().from(users).where(eq(users.email, email.toLowerCase())),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(applicationParticipants)
        .where(eq(applicationParticipants.applicationId, item.applicationId)),
    ).toHaveLength(0);
    await expect(
      service().readSetup({ kind: "anonymous" }, ids.bankA, item.applicationId),
    ).rejects.toMatchObject(notFound);
    expect(JSON.stringify(await audits(item.applicationId))).not.toContain(email.toLowerCase());
  });

  it("uses one logical public application for concurrent retries and detects payload conflicts", async () => {
    const input = publicInput();
    const context = publicContext();
    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () => service().publicStart(input, context)),
    );
    expect(outcomes).toEqual([accepted, accepted, accepted]);
    const deliveries = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.requestId, context.requestId));
    expect(deliveries).toHaveLength(1);
    await expect(
      service().publicStart({ ...input, productSlug: "business-credit" }, context),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
    const intentional = await start(input.email);
    expect(intentional.applicationId).not.toBe(deliveries[0]?.applicationId);
  });

  it("returns the same acknowledgement for unknown bank/product and throttled requests without creating drafts", async () => {
    const input = publicInput();
    for (const invalid of [
      { ...input, bankSlug: "missing-bank" },
      { ...input, productSlug: "missing-product" },
    ]) {
      const context = publicContext();
      expect(await service().publicStart(invalid, context)).toEqual(accepted);
      expect(
        await database.db
          .select()
          .from(accessDeliveryRequests)
          .where(eq(accessDeliveryRequests.requestId, context.requestId)),
      ).toHaveLength(0);
    }
    const context = publicContext();
    for (let index = 0; index < 5; index++)
      expect(
        await service().publicStart(publicInput(input.email), {
          ...context,
          requestId: randomUUID(),
        }),
      ).toEqual(accepted);
    const blocked = publicContext();
    expect(await service().publicStart(publicInput(input.email), blocked)).toEqual(accepted);
    expect(
      await database.db
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.requestId, blocked.requestId)),
    ).toHaveLength(0);
  });

  it("rolls back pending contact, draft, and delivery when the creation audit cannot be persisted", async () => {
    const input = publicInput();
    const context = publicContext();
    await database.db.execute(
      sql`CREATE FUNCTION setup_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER setup_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION setup_reject_audit()`,
    );
    try {
      await expect(service().publicStart(input, context)).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER setup_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION setup_reject_audit()`);
    }
    expect(
      await database.db
        .select()
        .from(applicantContacts)
        .where(eq(applicantContacts.email, input.email)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(accessDeliveryRequests)
        .where(eq(accessDeliveryRequests.requestId, context.requestId)),
    ).toHaveLength(0);
    expect(await service().publicStart(input, context)).toEqual(accepted);
  });

  it("binds only the explicitly targeted continuation draft when email verification succeeds", async () => {
    const first = await start();
    const second = await start(first.input.email);
    const verified = await consumeDelivery(first.delivery.id);
    expect(
      (await service().readSetup(verified.session.actor, ids.bankA, first.applicationId)).id,
    ).toBe(first.applicationId);
    await expect(
      service().readSetup(verified.session.actor, ids.bankA, second.applicationId),
    ).rejects.toMatchObject(notFound);
    const grants = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.userId, verified.session.user.id));
    expect(grants.map((grant) => grant.applicationId)).toEqual([first.applicationId]);
  });

  it("serializes an explicit claim racing targeted email consumption without a contact/application deadlock", async () => {
    const applicant = await verifiedApplicant();
    const pending = await start(applicant.email);
    const identity = createIdentityService(database.db, { clock });
    const delivery = await identity.prepareDelivery(pending.delivery.id);
    if (!delivery) throw new Error("Expected prepared synthetic email.");
    const token = new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token");
    if (!token) throw new Error("Expected synthetic email token.");
    const blocker = await database.pool.connect();
    const operations: Promise<unknown>[] = [];
    async function waitForBlockedTransactions(count: number) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await database.pool.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if ((result.rows[0]?.count ?? 0) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Concurrent claim operations did not reach the expected lock barrier.");
    }
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM applicant_contacts WHERE id = $1 FOR UPDATE", [
        pending.delivery.contactId,
      ]);
      // Holding the contact makes the previously reversed lock order reproducible:
      // consume reached contact before application, while explicit claim did the reverse.
      operations.push(
        identity.consumeAccessLink({
          token,
          origin,
          requestId: randomUUID(),
          rateLimitKey: randomUUID(),
        }),
      );
      await waitForBlockedTransactions(1);
      operations.push(
        service().claim(applicant.actor, ids.bankA, pending.applicationId, randomUUID()),
      );
      await waitForBlockedTransactions(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const results = await Promise.allSettled(operations);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const grants = await database.db
      .select()
      .from(applicationParticipants)
      .where(eq(applicationParticipants.applicationId, pending.applicationId));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      userId: applicant.actor.kind === "user" ? applicant.actor.userId : "",
      role: "applicant_admin",
      scope: "full",
    });
    expect(
      (await audits(pending.applicationId)).filter(
        (event) => event.action === "application.claimed",
      ),
    ).toHaveLength(1);
  });

  it("restores pending choices through a fresh generic link after original expiry and claims only the selected draft", async () => {
    const first = await start();
    const second = await start(first.input.email);
    await database.db
      .update(accessDeliveryRequests)
      .set({ expiresAt: new Date("2026-10-06T00:00:00.000Z") })
      .where(eq(accessDeliveryRequests.id, first.delivery.id));
    const session = await freshSession(first.input.email);
    const actor = session.session.actor;
    expect(
      await database.db
        .select()
        .from(applicationParticipants)
        .where(eq(applicationParticipants.userId, session.session.user.id)),
    ).toHaveLength(0);
    const beforeCount = await database.db.select({ id: applications.id }).from(applications);
    const pending = await service().list(actor, ids.bankA, {});
    expect(pending.items.map((item) => item.id).sort()).toEqual(
      [first.applicationId, second.applicationId].sort(),
    );
    for (const item of pending.items) {
      expect(item.claimRequired).toBe(true);
      expect(item).not.toHaveProperty("purpose");
      expect(item).not.toHaveProperty("industryCode");
      expect(item).not.toHaveProperty("contactId");
    }
    const claimed = await service().claim(actor, ids.bankA, second.applicationId, randomUUID());
    expect(claimed.claimRequired).toBe(false);
    expect((await service().claim(actor, ids.bankA, second.applicationId, randomUUID())).id).toBe(
      second.applicationId,
    );
    await expect(service().readSetup(actor, ids.bankA, first.applicationId)).rejects.toMatchObject(
      notFound,
    );
    const saved = await service().saveSetup(
      actor,
      ids.bankA,
      second.applicationId,
      {
        expectedRevision: claimed.revision,
        answers: { businessName: "Synthetic saved from an earlier device" },
        step: "business_name",
        currentStep: "product",
      },
      randomUUID(),
    );
    const resumed = await freshSession(first.input.email);
    expect(
      await service().readSetup(resumed.session.actor, ids.bankA, second.applicationId),
    ).toEqual(saved);
    expect(await database.db.select({ id: applications.id }).from(applications)).toEqual(
      beforeCount,
    );
    const stranger = await verifiedApplicant();
    await expect(
      service().claim(stranger.actor, ids.bankA, first.applicationId, randomUUID()),
    ).rejects.toMatchObject(notFound);
    await expect(
      service().claim(actor, ids.bankB, first.applicationId, randomUUID()),
    ).rejects.toMatchObject(notFound);
  });

  it("never reclaims a revoked participant or upgrades an assigned collaborator through email resume", async () => {
    const applicant = await verifiedApplicant();
    if (applicant.actor.kind !== "user") throw new Error("Expected synthetic user.");
    const owned = await create(applicant.actor);
    await database.db
      .update(applicationParticipants)
      .set({ revokedAt: clock() })
      .where(eq(applicationParticipants.applicationId, owned.id));
    await expect(
      service().claim(applicant.actor, ids.bankA, owned.id, randomUUID()),
    ).rejects.toMatchObject(notFound);
    const pending = await start(applicant.email);
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: pending.applicationId,
      userId: applicant.actor.userId,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    });
    const resumed = await freshSession(applicant.email);
    const selected = await service().list(resumed.session.actor, ids.bankA, {});
    expect(selected.items).toHaveLength(1);
    expect(selected.items[0]).toMatchObject({
      id: pending.applicationId,
      claimRequired: false,
      nextDestination: "assigned",
    });
    await expect(
      service().claim(resumed.session.actor, ids.bankA, pending.applicationId, randomUUID()),
    ).rejects.toMatchObject(notFound);
    await expect(
      service().readSetup(resumed.session.actor, ids.bankA, pending.applicationId),
    ).rejects.toMatchObject(notFound);
    await expect(
      requireApplicantPortalAccess(
        database.db,
        resumed.session.actor,
        ids.bankA,
        pending.applicationId,
      ),
    ).resolves.toMatchObject({ kind: "participant", role: "adviser", scope: "assigned" });
    await expect(
      requireTaskAccess(database.db, resumed.session.actor, {
        bankId: ids.bankA,
        applicationId: pending.applicationId,
        resourceId: randomUUID(),
      }),
    ).rejects.toMatchObject(notFound);
  });
});

describe("real PostgreSQL authenticated creation and setup", () => {
  it("records borrower/staff provenance and keeps staff-prefilled drafts incomplete", async () => {
    const applicant = await verifiedApplicant();
    const borrowerDraft = await create(applicant.actor);
    const staffDraft = await service().create(
      officer,
      ids.bankA,
      {
        email: applicant.email,
        productId: ids.productA,
        businessId: ids.businessA,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const filled = await ready(officer, staffDraft.id, staffDraft.revision);
    expect(filled).toMatchObject({
      status: "draft",
      setupStatus: "in_progress",
      completedAt: null,
    });
    await expect(
      service().finishSetup(
        officer,
        ids.bankA,
        staffDraft.id,
        {
          expectedRevision: filled.revision,
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    for (const [id, source, actorUserId] of [
      [borrowerDraft.id, "borrower", applicant.actor.kind === "user" ? applicant.actor.userId : ""],
      [staffDraft.id, "staff", ids.officerA],
    ]) {
      const [application] = await database.db
        .select()
        .from(applications)
        .where(eq(applications.id, id ?? ""));
      expect(application).toMatchObject({ source, createdByUserId: actorUserId, status: "draft" });
      expect(await audits(id ?? "")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actorUserId, metadata: expect.objectContaining({ source }) }),
        ]),
      );
    }
    await expect(
      service().create(
        applicant.actor,
        ids.bankA,
        { email: "somebody-else@example.test", idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    await expect(
      service().create(
        applicant.actor,
        ids.bankA,
        { businessId: ids.businessA, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    await expect(
      service().create(
        officer,
        ids.bankA,
        { email: applicant.email, businessId: ids.businessOtherBank, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
    await expect(
      service().create(
        officer,
        ids.bankB,
        { email: applicant.email, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject(notFound);
  });

  it("serializes authenticated creation retries and permits a deliberate second request with a fresh key", async () => {
    const { actor } = await verifiedApplicant();
    const input = { productId: ids.productA, idempotencyKey: randomUUID() };
    const results = await Promise.all(
      Array.from({ length: 3 }, () => service().create(actor, ids.bankA, input, randomUUID())),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect((await service().list(actor, ids.bankA, {})).items).toHaveLength(1);
    await expect(
      service().create(actor, ids.bankA, { idempotencyKey: input.idempotencyKey }, randomUUID()),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await create(actor, { productId: ids.productA })).id).not.toBe(results[0]?.id);
  });

  it("returns the selected product version after authorization when the catalog advances or retires it", async () => {
    const { actor } = await verifiedApplicant();
    const { actor: stranger } = await verifiedApplicant();
    expect((await create(actor)).selectedProduct).toBeNull();
    const slug = `versioned-${randomUUID()}`;
    const [original] = await database.db
      .insert(loanProducts)
      .values({
        bankId: ids.bankA,
        slug,
        name: "Synthetic original financing",
        version: 1,
        minimumAmount: "10000.00",
        maximumAmount: "7500000.00",
        synthetic: true,
      })
      .returning();
    if (!original) throw new Error("Expected original synthetic product.");
    const draft = await create(actor, { productId: original.id });
    const descriptor = {
      id: original.id,
      slug,
      name: original.name,
      version: 1,
      minimumAmount: "10000.00",
      maximumAmount: "7500000.00",
      currency: "USD",
      active: true,
    };
    expect(draft.selectedProduct).toEqual(descriptor);
    const [replacement] = await database.db
      .insert(loanProducts)
      .values({
        bankId: ids.bankA,
        slug,
        name: "Synthetic revised financing",
        version: 2,
        minimumAmount: "50000.00",
        maximumAmount: "5000000.00",
        synthetic: true,
      })
      .returning();
    if (!replacement) throw new Error("Expected replacement synthetic product.");
    const catalog = await readPublicIntake(database.db, { bankSlug: "bank-a" });
    expect(catalog.products.filter((item) => item.slug === slug).map((item) => item.id)).toEqual([
      replacement.id,
    ]);
    expect((await service().readSetup(actor, ids.bankA, draft.id)).selectedProduct).toEqual(
      descriptor,
    );
    const saved = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: draft.revision,
        answers: { requestedAmount: "7500000.00" },
        step: "amount",
        currentStep: "purpose",
      },
      randomUUID(),
    );
    expect(saved.selectedProduct).toEqual(descriptor);
    await database.db
      .update(loanProducts)
      .set({ active: false })
      .where(eq(loanProducts.id, original.id));
    expect((await service().readSetup(actor, ids.bankA, draft.id)).selectedProduct).toEqual({
      ...descriptor,
      active: false,
    });
    await expect(service().readSetup(stranger, ids.bankA, draft.id)).rejects.toMatchObject(
      notFound,
    );
    await expect(service().readSetup(actor, ids.bankB, draft.id)).rejects.toMatchObject(notFound);
  });

  it("stores exact decimal-string amounts using product configuration and rejects malformed or out-of-range amounts", async () => {
    const { actor } = await verifiedApplicant();
    for (const amount of ["10000.00", "5000000.00", "7500000.00"]) {
      const draft = await create(actor, { productId: ids.productA });
      const saved = await service().saveSetup(
        actor,
        ids.bankA,
        draft.id,
        {
          expectedRevision: draft.revision,
          answers: { requestedAmount: amount },
          step: "amount",
          currentStep: "purpose",
        },
        randomUUID(),
      );
      expect(saved.requestedAmount).toBe(amount);
    }
    const draft = await create(actor, { productId: ids.productA });
    for (const amount of ["9999.99", "7500000.01", "1e6", "10000.001", "NaN", "-10000"]) {
      await expect(
        service().saveSetup(
          actor,
          ids.bankA,
          draft.id,
          {
            expectedRevision: draft.revision,
            answers: { requestedAmount: amount },
            step: "amount",
            currentStep: "purpose",
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(draft);
    }
  });

  it("lets a retired product return to selection without allowing answer changes or completion until revalidated", async () => {
    const { actor } = await verifiedApplicant();
    const slug = `retired-${randomUUID()}`;
    const [original, replacement] = await database.db
      .insert(loanProducts)
      .values([
        {
          bankId: ids.bankA,
          slug,
          name: "Synthetic retired financing",
          version: 1,
          minimumAmount: "10000.00",
          maximumAmount: "7500000.00",
          synthetic: true,
        },
        {
          bankId: ids.bankA,
          slug,
          name: "Synthetic replacement financing",
          version: 2,
          minimumAmount: "10000.00",
          maximumAmount: "1000000.00",
          synthetic: true,
        },
      ])
      .returning();
    if (!original || !replacement) throw new Error("Expected synthetic product versions.");
    const draft = await create(actor, { productId: original.id });
    const reviewed = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: draft.revision,
        answers: {
          businessName: "Synthetic recovery workshop",
          requestedAmount: "5000000.00",
          purpose: "Synthetic expansion",
        },
        step: "amount",
        currentStep: "review",
      },
      randomUUID(),
    );
    await database.db
      .update(loanProducts)
      .set({ active: false })
      .where(eq(loanProducts.id, original.id));
    const navigate = {
      expectedRevision: reviewed.revision,
      answers: {},
      currentStep: "product",
    };
    for (const invalid of [
      { ...navigate, answers: { businessName: "Unconfirmed edit" } },
      { ...navigate, step: "product" },
      { ...navigate, skip: false },
    ])
      await expect(
        service().saveSetup(actor, ids.bankA, draft.id, invalid, randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        draft.id,
        { expectedRevision: reviewed.revision, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const selecting = await service().saveSetup(actor, ids.bankA, draft.id, navigate, randomUUID());
    expect(selecting).toMatchObject({
      currentStep: "product",
      revision: reviewed.revision + 1,
      requestedAmount: "5000000.00",
      productId: original.id,
      businessName: reviewed.businessName,
      purpose: reviewed.purpose,
      completedSteps: reviewed.completedSteps,
      selectedProduct: { active: false },
    });
    const changed = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: selecting.revision,
        answers: { productId: replacement.id },
        step: "product",
        currentStep: "review",
      },
      randomUUID(),
    );
    expect(changed).toMatchObject({ currentStep: "amount", requestedAmount: "5000000.00" });
    expect(changed.completedSteps).not.toContain("amount");
    const amount = {
      expectedRevision: changed.revision,
      answers: { requestedAmount: "5000000.00" },
      step: "amount",
      currentStep: "review",
    };
    await expect(
      service().saveSetup(actor, ids.bankA, draft.id, amount, randomUUID()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        draft.id,
        { expectedRevision: changed.revision, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const corrected = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      { ...amount, answers: { requestedAmount: "1000000.00" } },
      randomUUID(),
    );
    const finished = await service().finishSetup(
      actor,
      ids.bankA,
      draft.id,
      { expectedRevision: corrected.revision, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(finished).toMatchObject({ nextDestination: "portal", requestedAmount: "1000000.00" });
  });

  it("invalidates amount validation when the product changes and keeps answer/progress updates atomic", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    const filled = await ready(actor, draft.id, draft.revision);
    const [product] = await database.db
      .insert(loanProducts)
      .values({
        bankId: ids.bankA,
        slug: `lower-limit-${randomUUID()}`,
        name: "Synthetic lower limit",
        minimumAmount: "10000",
        maximumAmount: "1000000",
        synthetic: true,
      })
      .returning();
    if (!product) throw new Error("Expected configured synthetic product.");
    const changed = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: filled.revision,
        answers: { productId: product.id },
        step: "product",
        currentStep: "amount",
      },
      randomUUID(),
    );
    expect(changed.completedSteps).not.toContain("amount");
    expect(changed.currentStep).toBe("amount");
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        draft.id,
        {
          expectedRevision: changed.revision,
          idempotencyKey: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(changed);
  });

  it("persists explicit optional skips, rejects required skips, and rejects raw identifiers and client completion state", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    for (const extra of [
      { ein: "00-0000000" },
      { ssn: "000-00-0000" },
      { completedAt: clock().toISOString() },
      { setupStatus: "completed" },
      { completedSteps: ["business_name"] },
    ]) {
      const invalid = {
        expectedRevision: draft.revision,
        answers: {},
        currentStep: "review" as const,
        ...extra,
      };
      await expect(
        service().saveSetup(actor, ids.bankA, draft.id, invalid, randomUUID()),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    for (const answers of [{ ein: "00-0000000" }, { ssn: "000-00-0000" }]) {
      await expect(
        service().saveSetup(
          actor,
          ids.bankA,
          draft.id,
          {
            expectedRevision: draft.revision,
            answers,
            currentStep: "business_name",
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(
      service().saveSetup(
        actor,
        ids.bankA,
        draft.id,
        {
          expectedRevision: draft.revision,
          answers: {},
          step: "business_name",
          skip: true,
          currentStep: "product",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(draft);
    const skipped = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: draft.revision,
        answers: {},
        step: "industry",
        skip: true,
        currentStep: "review",
      },
      randomUUID(),
    );
    expect(skipped.skippedSteps).toContain("industry");
    expect(skipped.industryCode).toBeNull();
    const answered = await service().saveSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: skipped.revision,
        answers: { industryCode: "541511", industryTaxonomyVersion: "2022" },
        step: "industry",
        currentStep: "review",
      },
      randomUUID(),
    );
    expect(answered.skippedSteps).not.toContain("industry");
    expect(answered.completedSteps).toContain("industry");
    expect(answered.industryTaxonomyVersion).toBe("2022");
  });

  it("denies strangers, collaborators, and cross-bank edits without leaking setup answers", async () => {
    const { actor } = await verifiedApplicant();
    const stranger = await verifiedApplicant();
    const draft = await create(actor);
    if (stranger.actor.kind !== "user") throw new Error("Expected synthetic user.");
    await database.db.insert(applicationParticipants).values({
      bankId: ids.bankA,
      applicationId: draft.id,
      userId: stranger.actor.userId,
      role: "adviser",
      scope: "assigned",
      synthetic: true,
    });
    const denied: [Actor, string][] = [
      [stranger.actor, ids.bankA],
      [{ kind: "anonymous" }, ids.bankA],
      [actor, ids.bankB],
    ];
    for (const [reader, bankId] of denied) {
      await expect(service().readSetup(reader, bankId, draft.id)).rejects.toMatchObject(notFound);
      await expect(
        service().saveSetup(
          reader,
          bankId,
          draft.id,
          {
            expectedRevision: draft.revision,
            answers: { purpose: "Unauthorized" },
            currentStep: "purpose",
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject(notFound);
    }
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(draft);
  });

  it("allows one concurrent save per revision, with one audit and no lost updates", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    const beforeAudit = await audits(draft.id);
    const outcomes = await Promise.allSettled(
      ["Synthetic A", "Synthetic B"].map((businessName) =>
        service().saveSetup(
          actor,
          ids.bankA,
          draft.id,
          {
            expectedRevision: draft.revision,
            answers: { businessName },
            step: "business_name",
            currentStep: "product",
          },
          randomUUID(),
        ),
      ),
    );
    const successful = outcomes.filter((item) => item.status === "fulfilled");
    const failed = outcomes.filter((item) => item.status === "rejected");
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(successful[0]?.value);
    expect(await audits(draft.id)).toHaveLength(beforeAudit.length + 1);
  });

  it("keeps the earlier staff purpose command consistent with setup revisions and dependent progress", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    const filled = await ready(actor, draft.id, draft.revision);
    await expect(
      updateApplicationPurpose(
        database.db,
        actor,
        ids.bankA,
        draft.id,
        {
          expectedRevision: filled.revision,
          purpose: "Applicant must use saved setup",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    const updated = await updateApplicationPurpose(
      database.db,
      officer,
      ids.bankA,
      draft.id,
      {
        expectedRevision: filled.revision,
        purpose: "Synthetic staff-prefilled revision",
      },
      randomUUID(),
    );
    const resumed = await service().readSetup(actor, ids.bankA, draft.id);
    expect(resumed.revision).toBe(updated.revision);
    expect(resumed.purpose).toBe("Synthetic staff-prefilled revision");
    expect(resumed.setupStatus).toBe("in_progress");
    expect(resumed.completedSteps).not.toContain("purpose");
    const [setup] = await database.db
      .select()
      .from(applicationSetups)
      .where(eq(applicationSetups.applicationId, draft.id));
    expect(setup?.revision).toBe(updated.revision);
    await expect(
      service().saveSetup(
        actor,
        ids.bankA,
        draft.id,
        {
          expectedRevision: filled.revision,
          answers: { purpose: "Stale autosave" },
          currentStep: "purpose",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("rolls back both canonical answers and setup progress when the save audit fails", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    const beforeAudit = await audits(draft.id);
    await database.db.execute(
      sql`CREATE FUNCTION setup_save_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER setup_save_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION setup_save_reject_audit()`,
    );
    try {
      await expect(
        service().saveSetup(
          actor,
          ids.bankA,
          draft.id,
          {
            expectedRevision: draft.revision,
            answers: { businessName: "Must roll back" },
            step: "business_name",
            currentStep: "product",
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER setup_save_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION setup_save_reject_audit()`);
    }
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(draft);
    expect(await audits(draft.id)).toEqual(beforeAudit);
  });

  it("requires explicit applicant completion, then unlocks only that application's portal with one transition", async () => {
    const { actor } = await verifiedApplicant();
    const first = await create(actor);
    const other = await create(actor);
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        first.id,
        { expectedRevision: first.revision, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const filled = await ready(actor, first.id, first.revision);
    expect(filled).toMatchObject({
      setupStatus: "in_progress",
      status: "draft",
      nextDestination: "setup",
    });
    await expect(
      requireApplicantPortalAccess(database.db, actor, ids.bankA, first.id),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED", statusCode: 409 });
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        first.id,
        { expectedRevision: first.revision, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const command = { expectedRevision: filled.revision, idempotencyKey: randomUUID() };
    const completed = await service().finishSetup(
      actor,
      ids.bankA,
      first.id,
      command,
      randomUUID(),
    );
    const eventCount = (await audits(first.id)).length;
    expect(completed).toMatchObject({
      setupStatus: "completed",
      status: "collecting_information",
      nextDestination: "portal",
      completedAt: clock().toISOString(),
      revision: filled.revision + 1,
    });
    expect(await service().finishSetup(actor, ids.bankA, first.id, command, randomUUID())).toEqual(
      completed,
    );
    expect(await audits(first.id)).toHaveLength(eventCount);
    await expect(
      requireApplicantPortalAccess(database.db, actor, ids.bankA, first.id),
    ).resolves.toBeDefined();
    await expect(
      requireApplicantPortalAccess(database.db, actor, ids.bankA, other.id),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    expect(await service().readSetup(actor, ids.bankA, other.id)).toEqual(other);
    expect(completed.status).not.toBe("submitted");
    expect(JSON.stringify(await audits(first.id))).not.toContain("Synthetic equipment acquisition");
    const [setup] = await database.db
      .select()
      .from(applicationSetups)
      .where(eq(applicationSetups.applicationId, first.id));
    expect(setup?.completedByUserId).toBe(actor.kind === "user" ? actor.userId : undefined);
  });

  it("deduplicates simultaneous completion retries and rolls a failed completion back completely", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    const filled = await ready(actor, draft.id, draft.revision);
    const command = { expectedRevision: filled.revision, idempotencyKey: randomUUID() };
    const beforeAudit = await audits(draft.id);
    await database.db.execute(
      sql`CREATE FUNCTION setup_finish_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER setup_finish_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION setup_finish_reject_audit()`,
    );
    try {
      await expect(
        service().finishSetup(actor, ids.bankA, draft.id, command, randomUUID()),
      ).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER setup_finish_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION setup_finish_reject_audit()`);
    }
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(filled);
    expect(await audits(draft.id)).toEqual(beforeAudit);
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        service().finishSetup(actor, ids.bankA, draft.id, command, randomUUID()),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0]?.revision).toBe(filled.revision + 1);
    expect(await audits(draft.id)).toHaveLength(beforeAudit.length + 1);
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        draft.id,
        { ...command, idempotencyKey: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("records idempotency for a new-key completion that finds setup already complete", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    const filled = await ready(actor, draft.id, draft.revision);
    const completed = await service().finishSetup(
      actor,
      ids.bankA,
      draft.id,
      {
        expectedRevision: filled.revision,
        idempotencyKey: randomUUID(),
      },
      randomUUID(),
    );
    const eventCount = (await audits(draft.id)).length;
    const newCommand = { expectedRevision: completed.revision, idempotencyKey: randomUUID() };
    expect(
      await service().finishSetup(actor, ids.bankA, draft.id, newCommand, randomUUID()),
    ).toEqual(completed);
    expect(
      await service().finishSetup(actor, ids.bankA, draft.id, newCommand, randomUUID()),
    ).toEqual(completed);
    await expect(
      service().finishSetup(
        actor,
        ids.bankA,
        draft.id,
        {
          ...newCommand,
          expectedRevision: completed.revision + 1,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
    expect(await service().readSetup(actor, ids.bankA, draft.id)).toEqual(completed);
    expect(await audits(draft.id)).toHaveLength(eventCount);
  });

  it("paginates equal creation timestamps stably without duplicating or revealing another applicant's drafts", async () => {
    const { actor } = await verifiedApplicant();
    const expected = [];
    for (let index = 0; index < 5; index++) expected.push((await create(actor)).id);
    const observed: string[] = [];
    let after: string | undefined;
    do {
      const page = await service().list(actor, ids.bankA, {
        limit: 2,
        ...(after ? { after } : {}),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      observed.push(...page.items.map((item) => item.id));
      after = page.nextCursor ?? undefined;
      if (observed.length > 5)
        throw new Error("Pagination repeated previously returned applications.");
    } while (after);
    expect(observed.sort()).toEqual(expected.sort());
    expect(new Set(observed).size).toBe(5);
  });

  it("returns a closed destination and denies further setup mutations after withdrawal", async () => {
    const { actor } = await verifiedApplicant();
    const draft = await create(actor);
    await database.db
      .update(applications)
      .set({ status: "withdrawn" })
      .where(eq(applications.id, draft.id));
    expect(await service().destination(actor, ids.bankA, draft.id)).toMatchObject({
      nextDestination: "closed",
    });
    await expect(
      requireApplicantPortalAccess(database.db, actor, ids.bankA, draft.id),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      service().saveSetup(
        actor,
        ids.bankA,
        draft.id,
        {
          expectedRevision: draft.revision,
          answers: { purpose: "Cannot revive" },
          currentStep: "purpose",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("synthetic demo application setup boundaries", () => {
  it("creates, saves, resumes, and completes synthetic setup without stamping mailbox verification", async () => {
    const identity = createIdentityService(database.db, { clock });
    const email = `${randomUUID()}@example.test`;
    const input = {
      email,
      bankSlug: "bank-a",
      portal: "borrower" as const,
      origin,
      returnPath: "/",
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    };
    const signedIn = await identity.signInDemo(input);
    const draft = await create(signedIn.session.actor);
    expect(draft.synthetic).toBe(true);
    const filled = await ready(signedIn.session.actor, draft.id, draft.revision);
    const resumed = await identity.signInDemo({ ...input, requestId: randomUUID() });
    expect(await service().readSetup(resumed.session.actor, ids.bankA, draft.id)).toEqual(filled);
    const completed = await service().finishSetup(
      resumed.session.actor,
      ids.bankA,
      draft.id,
      { expectedRevision: filled.revision, idempotencyKey: randomUUID() },
      randomUUID(),
    );
    expect(completed.setupStatus).toBe("completed");
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, signedIn.session.user.id));
    expect(user?.emailVerifiedAt).toBeNull();
    expect(await audits(draft.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadata: expect.objectContaining({ simulated: true }) }),
      ]),
    );
  });

  it("cannot create in another bank or claim/read a non-synthetic draft", async () => {
    const identity = createIdentityService(database.db, { clock });
    const email = `${randomUUID()}@example.test`;
    const signedIn = await identity.signInDemo({
      email,
      bankSlug: "bank-a",
      portal: "borrower",
      origin,
      returnPath: "/",
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    });
    const actor = signedIn.session.actor;
    await expect(
      service().create(actor, ids.bankB, { idempotencyKey: randomUUID() }, randomUUID()),
    ).rejects.toMatchObject(notFound);
    const pending = await start(email);
    await database.db
      .update(applications)
      .set({ synthetic: false })
      .where(eq(applications.id, pending.applicationId));
    await expect(
      service().claim(actor, ids.bankA, pending.applicationId, randomUUID()),
    ).rejects.toMatchObject(notFound);
    expect((await service().list(actor, ids.bankA, {})).items).toHaveLength(0);
    const own = await create(actor);
    await database.db
      .update(applications)
      .set({ synthetic: false })
      .where(eq(applications.id, own.id));
    await expect(service().readSetup(actor, ids.bankA, own.id)).rejects.toMatchObject(notFound);
    expect(
      await database.db
        .select()
        .from(applicationParticipants)
        .where(
          and(
            eq(applicationParticipants.applicationId, pending.applicationId),
            eq(applicationParticipants.userId, signedIn.session.user.id),
          ),
        ),
    ).toHaveLength(0);
  });

  it("denies the existing staff detail service access to non-synthetic applications during a demo session", async () => {
    const identity = createIdentityService(database.db, { clock });
    const signedIn = await identity.signInDemo({
      email: "officer-a@example.test",
      bankSlug: "bank-a",
      portal: "staff",
      origin: "http://localhost:3002",
      returnPath: "/",
      requestId: randomUUID(),
      rateLimitKey: randomUUID(),
    });
    const applicant = await verifiedApplicant();
    const draft = await create(applicant.actor);
    await database.db
      .update(applications)
      .set({ synthetic: false })
      .where(eq(applications.id, draft.id));
    await expect(
      readStaffApplication(database.db, signedIn.session.actor, ids.bankA, draft.id),
    ).rejects.toMatchObject(notFound);
  });
});
