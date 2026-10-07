import { randomUUID } from "node:crypto";
import {
  accessDeliveryRequests,
  applicantContacts,
  applications,
  auditEvents,
  bankMemberships,
  banks,
  loginTokens,
  sessions,
  users,
} from "@keycade/db";
import { seedDatabase, seedIds } from "@keycade/db/seed";
import { createTestDatabase } from "@keycade/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIdentityService,
  hashIdentityCredential,
  type IdentityPortal,
  type IdentityService,
  normalizeIdentityEmail,
  normalizeIdentityReturnPath,
  readApplication,
  readStaffApplication,
} from "../src/index.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const origin = "http://localhost:3001";
const staffOrigin = "http://localhost:3002";
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
});

function harness() {
  let now = new Date("2026-10-06T12:00:00.000Z");
  const service = createIdentityService(database.db, { clock: () => now });
  return {
    service,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}
async function request(
  service: IdentityService,
  options: {
    email?: string;
    portal?: IdentityPortal;
    returnPath?: string;
    bankSlug?: string;
    rateLimitKey?: string;
    origin?: string;
  } = {},
) {
  const requestId = randomUUID();
  const portal = options.portal ?? "borrower";
  const response = await service.requestAccessLink({
    email: options.email ?? `${randomUUID()}@example.test`,
    bankSlug: options.bankSlug ?? "bank-a",
    portal,
    returnPath: options.returnPath ?? "/",
    origin: options.origin ?? (portal === "staff" ? staffOrigin : origin),
    requestId,
    rateLimitKey: options.rateLimitKey ?? randomUUID(),
  });
  const [delivery] = await database.db
    .select()
    .from(accessDeliveryRequests)
    .where(eq(accessDeliveryRequests.requestId, requestId));
  return { response, delivery };
}
async function prepared(service: IdentityService, options: Parameters<typeof request>[1] = {}) {
  const result = await request(service, options);
  if (!result.delivery) throw new Error("Expected synthetic delivery request.");
  const delivery = await service.prepareDelivery(result.delivery.id);
  if (!delivery) throw new Error("Expected synthetic prepared email.");
  return {
    ...result,
    delivery,
    token: new URLSearchParams(new URL(delivery.confirmUrl).hash.slice(1)).get("token") ?? "",
  };
}
function consume(
  service: IdentityService,
  token: string,
  targetOrigin = origin,
  rateLimitKey: string = randomUUID(),
) {
  return service.consumeAccessLink({
    token,
    origin: targetOrigin,
    requestId: randomUUID(),
    rateLimitKey,
  });
}
const linkError = { code: "INVALID_ACCESS_LINK", statusCode: 400 };

describe("real PostgreSQL passwordless identity", () => {
  it("queues pending contacts transactionally without identity, grants, or application creation", async () => {
    const { service } = harness();
    const before = await database.db.select({ id: applications.id }).from(applications);
    const email = `Pending.${randomUUID()}+Exact@Example.Test`;
    const { response, delivery } = await request(service, { email });
    expect(response).toEqual({ status: "accepted" });
    expect(delivery).toMatchObject({ status: "queued", attempts: 0, consumedAt: null });
    const [contact] = await database.db
      .select()
      .from(applicantContacts)
      .where(eq(applicantContacts.id, delivery?.contactId ?? ""));
    expect(contact).toMatchObject({ email: email.toLowerCase(), userId: null });
    expect(
      await database.db.select().from(users).where(eq(users.email, email.toLowerCase())),
    ).toHaveLength(0);
    expect(await database.db.select({ id: applications.id }).from(applications)).toEqual(before);
    expect(
      await database.db
        .select()
        .from(loginTokens)
        .where(eq(loginTokens.deliveryRequestId, delivery?.id ?? "")),
    ).toHaveLength(0);
  });

  it("persists only hashed credentials and binds the normalized email only after consumption", async () => {
    const { service } = harness();
    const email = `Identity.${randomUUID()}+Exact@Example.Test`;
    const item = await prepared(service, { email, returnPath: "/applications" });
    const [stored] = await database.db
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.deliveryRequestId, item.delivery.requestId));
    expect(stored?.tokenHash === hashIdentityCredential(item.token)).toBe(true);
    expect(stored?.tokenHash === item.token).toBe(false);
    const result = await consume(service, item.token);
    expect(result.returnPath).toBe("/");
    expect(result.session.user.email).toBe(email.toLowerCase());
    expect(result.session.staffRole).toBeNull();
    const [session] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.session.id));
    expect(session?.tokenHash === hashIdentityCredential(result.sessionToken)).toBe(true);
    const saved = JSON.stringify({
      stored,
      session,
      delivery: item.delivery.requestId,
      audit: await database.db.select().from(auditEvents),
    });
    expect(saved.includes(item.token)).toBe(false);
    expect(saved.includes(result.sessionToken)).toBe(false);
    expect(saved.includes(result.csrfToken)).toBe(false);
    expect(await service.resolveSession(result.sessionToken, origin)).toEqual(result.session);
    await expect(
      readApplication(database.db, result.session.actor, seedIds.bankA, seedIds.applicationSmall),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      readStaffApplication(
        database.db,
        result.session.actor,
        seedIds.bankA,
        seedIds.applicationSmall,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resumes the same existing identity without duplicate users or losing granted access", async () => {
    const { service } = harness();
    const item = await prepared(service, { email: " BORROWER@example.test " });
    const result = await consume(service, item.token);
    expect(result.session.user.id).toBe(seedIds.borrower);
    expect(
      (
        await readApplication(
          database.db,
          result.session.actor,
          seedIds.bankA,
          seedIds.applicationSmall,
        )
      ).id,
    ).toBe(seedIds.applicationSmall);
    expect(
      await database.db.select().from(users).where(eq(users.email, "borrower@example.test")),
    ).toHaveLength(1);
  });

  it("atomically consumes one request across simultaneous uses and SMTP retry siblings", async () => {
    const { service, advance } = harness();
    const first = await prepared(service);
    expect(await service.prepareDelivery(first.delivery.requestId)).toBeNull();
    advance(60_001); // Worker crashed after SMTP accepted the first message.
    const second = await service.prepareDelivery(first.delivery.requestId);
    if (!second) throw new Error("Expected recovered delivery.");
    const sibling =
      new URLSearchParams(new URL(second.confirmUrl).hash.slice(1)).get("token") ?? "";
    const results = await Promise.allSettled([
      consume(service, first.token),
      consume(service, sibling),
      consume(service, first.token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    for (const result of results)
      if (result.status === "rejected") expect(result.reason).toMatchObject(linkError);
    await expect(consume(service, sibling)).rejects.toMatchObject(linkError);
    expect(await service.prepareDelivery(first.delivery.requestId)).toBeNull();
    const tokens = await database.db
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.deliveryRequestId, first.delivery.requestId));
    expect(tokens).toHaveLength(2);
  });

  it("rejects expired and tampered tokens, then allows a freshly requested link", async () => {
    const { service, advance } = harness();
    const email = `${randomUUID()}@example.test`;
    const item = await prepared(service, { email });
    await expect(consume(service, "0".repeat(64))).rejects.toMatchObject(linkError);
    await expect(consume(service, "malformed")).rejects.toMatchObject(linkError);
    advance(15 * 60_000);
    await expect(consume(service, item.token)).rejects.toMatchObject(linkError);
    const fresh = await prepared(service, { email });
    expect((await consume(service, fresh.token)).session.user.email).toBe(email);
  });

  it("bounds stalled delivery requests and rejects revoked requests", async () => {
    const { service, advance } = harness();
    const stalled = await request(service);
    if (!stalled.delivery) throw new Error("Expected delivery.");
    advance(60 * 60_000);
    expect(await service.prepareDelivery(stalled.delivery.id)).toBeNull();
    const [expired] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.id, stalled.delivery.id));
    expect(expired).toMatchObject({ status: "failed", lastErrorCode: "DELIVERY_EXPIRED" });
    const item = await prepared(service);
    await database.db
      .update(accessDeliveryRequests)
      .set({ revokedAt: new Date() })
      .where(eq(accessDeliveryRequests.id, item.delivery.requestId));
    await expect(consume(service, item.token)).rejects.toMatchObject(linkError);
    expect(await service.prepareDelivery(item.delivery.requestId)).toBeNull();
  });

  it("expires sessions and revokes them immediately without cached authorization", async () => {
    const { service, advance } = harness();
    const first = await prepared(service);
    const signedIn = await consume(service, first.token);
    await service.revokeSession(signedIn.sessionToken);
    expect(await service.resolveSession(signedIn.sessionToken, origin)).toBeNull();
    await service.revokeSession(signedIn.sessionToken);
    const second = await prepared(service);
    const expiring = await consume(service, second.token);
    advance(8 * 60 * 60_000);
    expect(await service.resolveSession(expiring.sessionToken, origin)).toBeNull();
  });

  it("requires explicit current staff membership and never infers it from a staff login request", async () => {
    const { service } = harness();
    const email = `${randomUUID()}@example.test`;
    const nonstaff = await prepared(service, { email, portal: "staff" });
    await expect(consume(service, nonstaff.token, staffOrigin)).rejects.toMatchObject(linkError);
    expect(await database.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    const officer = await prepared(service, { email: "officer-a@example.test", portal: "staff" });
    const result = await consume(service, officer.token, staffOrigin);
    expect(result.session.staffRole).toBe("admin");
    await database.db
      .update(bankMemberships)
      .set({ revokedAt: new Date() })
      .where(eq(bankMemberships.userId, seedIds.officerA));
    try {
      expect(await service.resolveSession(result.sessionToken, staffOrigin)).toBeNull();
      await expect(
        readStaffApplication(
          database.db,
          result.session.actor,
          seedIds.bankA,
          seedIds.applicationSmall,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await database.db
        .update(bankMemberships)
        .set({ revokedAt: null })
        .where(eq(bankMemberships.userId, seedIds.officerA));
    }
  });

  it("binds links and sessions to their requesting portal origin", async () => {
    const { service } = harness();
    const item = await prepared(service);
    await expect(consume(service, item.token, staffOrigin)).rejects.toMatchObject(linkError);
    const result = await consume(service, item.token);
    expect(await service.resolveSession(result.sessionToken, staffOrigin)).toBeNull();
    expect(await service.resolveSession(result.sessionToken, origin)).not.toBeNull();
  });

  it("keeps account existence and send throttling responses identical across processes", async () => {
    const { service } = harness();
    const email = `${randomUUID()}@example.test`;
    const rateLimitKey = randomUUID();
    const results = [];
    for (let i = 0; i < 7; i++)
      results.push(
        await request(
          i % 2
            ? createIdentityService(database.db, {
                clock: () => new Date("2026-10-06T12:00:00.000Z"),
              })
            : service,
          { email, rateLimitKey },
        ),
      );
    expect(results.every((r) => r.response.status === "accepted")).toBe(true);
    expect(results.filter((r) => r.delivery)).toHaveLength(5);
    expect((await request(service, { bankSlug: "missing-bank" })).response).toEqual({
      status: "accepted",
    });
    expect((await request(service, { email: "borrower@example.test" })).response).toEqual({
      status: "accepted",
    });
  });

  it("counts failed consume attempts durably and resets the login throttle with injected time", async () => {
    const { service, advance } = harness();
    const rateLimitKey = randomUUID();
    for (let i = 0; i < 30; i++)
      await expect(consume(service, "bad", origin, rateLimitKey)).rejects.toMatchObject(linkError);
    await expect(consume(service, "bad", origin, rateLimitKey)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      statusCode: 429,
    });
    advance(15 * 60_000);
    await expect(consume(service, "bad", origin, rateLimitKey)).rejects.toMatchObject(linkError);
  });

  it("retries safely and ignores stale worker completion without storing SMTP error content", async () => {
    const { service, advance } = harness();
    const first = await prepared(service);
    await service.failDelivery(
      first.delivery.requestId,
      first.delivery.claimToken,
      `SMTP rejected ${first.token}`,
    );
    expect(await service.prepareDelivery(first.delivery.requestId)).toBeNull();
    advance(1000);
    const retry = await service.prepareDelivery(first.delivery.requestId);
    if (!retry) throw new Error("Expected retry.");
    await service.completeDelivery(first.delivery.requestId, first.delivery.claimToken);
    const [inFlight] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.id, first.delivery.requestId));
    expect(inFlight?.claimToken).toBe(retry.claimToken);
    expect(inFlight?.status).toBe("sending");
    expect(JSON.stringify(inFlight).includes(first.token)).toBe(false);
    await service.completeDelivery(retry.requestId, retry.claimToken);
    expect(await service.prepareDelivery(retry.requestId)).toBeNull();
    // The earlier SMTP attempt may have been accepted despite an ambiguous reported error.
    expect((await consume(service, first.token)).session).toBeTruthy();
  });

  it("stops after three failed deliveries and leaves a safe terminal status", async () => {
    const { service, advance } = harness();
    const item = await prepared(service);
    let current = item.delivery;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await service.failDelivery(current.requestId, current.claimToken);
      advance(5000);
      const next = await service.prepareDelivery(current.requestId);
      if (attempt === 3) expect(next).toBeNull();
      else {
        if (!next) throw new Error("Expected retry.");
        current = next;
      }
    }
    const [failed] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.id, item.delivery.requestId));
    expect(failed).toMatchObject({
      status: "failed",
      attempts: 3,
      lastErrorCode: "LOCAL_EMAIL_DELIVERY_FAILED",
    });
  });

  it("rolls back request persistence if its audit write fails", async () => {
    const { service } = harness();
    const email = `${randomUUID()}@example.test`;
    await database.db.execute(
      sql`CREATE FUNCTION identity_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER identity_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION identity_reject_audit()`,
    );
    try {
      await expect(request(service, { email })).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER identity_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION identity_reject_audit()`);
    }
    expect(
      await database.db.select().from(applicantContacts).where(eq(applicantContacts.email, email)),
    ).toHaveLength(0);
  });

  it("rolls back consumption and identity binding when its session audit fails", async () => {
    const { service } = harness();
    const email = `${randomUUID()}@example.test`;
    const item = await prepared(service, { email });
    await database.db.execute(
      sql`CREATE FUNCTION identity_reject_session_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER identity_session_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION identity_reject_session_audit()`,
    );
    try {
      await expect(consume(service, item.token)).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER identity_session_audit_failure ON audit_events`);
      await database.db.execute(sql`DROP FUNCTION identity_reject_session_audit()`);
    }
    const [delivery] = await database.db
      .select()
      .from(accessDeliveryRequests)
      .where(eq(accessDeliveryRequests.id, item.delivery.requestId));
    expect(delivery?.consumedAt).toBeNull();
    expect(await database.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    expect((await consume(service, item.token)).session.user.email).toBe(email);
  });

  it("enforces the bank/contact boundary in PostgreSQL itself", async () => {
    await expect(
      database.db.insert(accessDeliveryRequests).values({
        bankId: seedIds.bankB,
        contactId: seedIds.contactA,
        portal: "borrower",
        origin,
        returnPath: "/",
        expiresAt: new Date("2026-10-06T13:00:00.000Z"),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it("does not resolve a session if its user's verified binding is removed", async () => {
    const { service } = harness();
    const item = await prepared(service);
    const result = await consume(service, item.token);
    await database.db
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, result.session.user.id));
    expect(await service.resolveSession(result.sessionToken, origin)).toBeNull();
  });
});

describe("identity input normalization", () => {
  it("preserves exact plus and dot address semantics", () => {
    expect(normalizeIdentityEmail("  First.Last+tag@Example.Test  ")).toBe(
      "first.last+tag@example.test",
    );
  });
  it("allowlists destinations exactly and refuses external, encoded, or backslash redirects", () => {
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/%2f%2fevil.test",
      "/applications?next=https://evil.test",
      " /applications",
      "/auth/confirm",
    ])
      expect(normalizeIdentityReturnPath(path)).toBe("/");
    expect(normalizeIdentityReturnPath("/applications")).toBe("/");
  });
});

describe("synthetic demo sign-in", () => {
  const input = (overrides: Partial<Parameters<IdentityService["signInDemo"]>[0]> = {}) => ({
    email: `${randomUUID()}@example.test`,
    bankSlug: "bank-a",
    portal: "borrower" as const,
    origin,
    returnPath: "/",
    requestId: randomUUID(),
    rateLimitKey: randomUUID(),
    ...overrides,
  });

  it("creates an explicitly simulated session without email verification, email work, or application grants", async () => {
    const { service } = harness();
    const before = await database.pool.query<{
      deliveries: string;
      tokens: string;
      applications: string;
    }>(
      "SELECT (SELECT count(*) FROM access_delivery_requests) AS deliveries, (SELECT count(*) FROM login_tokens) AS tokens, (SELECT count(*) FROM applications) AS applications",
    );
    const details = input();
    const result = await service.signInDemo(details);
    expect(result.session.authenticationMethod).toBe("demo");
    expect(result.session.actor.demoBankId).toBe(seedIds.bankA);
    expect(result.returnPath).toBe("/");
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, result.session.user.id));
    expect(user).toMatchObject({ synthetic: true, emailVerifiedAt: null });
    const [contact] = await database.db
      .select()
      .from(applicantContacts)
      .where(eq(applicantContacts.email, details.email));
    expect(contact?.userId).toBe(user?.id);
    const after = await database.pool.query<{
      deliveries: string;
      tokens: string;
      applications: string;
    }>(
      "SELECT (SELECT count(*) FROM access_delivery_requests) AS deliveries, (SELECT count(*) FROM login_tokens) AS tokens, (SELECT count(*) FROM applications) AS applications",
    );
    expect(after.rows).toEqual(before.rows);
    const [audit] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, details.requestId));
    expect(audit).toMatchObject({
      action: "identity.demo_session_created",
      metadata: { simulated: true, authenticationMethod: "demo" },
    });
    expect(JSON.stringify(audit).includes(result.sessionToken)).toBe(false);
    expect(await service.resolveSession(result.sessionToken, origin)).toEqual(result.session);
    expect(await service.resolveSession(result.sessionToken, staffOrigin)).toBeNull();
    await expect(
      readApplication(database.db, result.session.actor, seedIds.bankA, seedIds.applicationSmall),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.revokeSession(result.sessionToken);
    expect(await service.resolveSession(result.sessionToken, origin)).toBeNull();
  });

  it("requires synthetic users and banks and never converts existing data to synthetic", async () => {
    const { service } = harness();
    const email = `${randomUUID()}@example.test`;
    const [realUser] = await database.db
      .insert(users)
      .values({ email, displayName: "Non-demo identity", synthetic: false })
      .returning();
    await expect(service.signInDemo(input({ email }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, realUser?.id ?? ""));
    expect(user).toMatchObject({ synthetic: false, emailVerifiedAt: null });
    const slug = `not-demo-${randomUUID()}`;
    await database.db.insert(banks).values({ slug, name: "Not a demo", synthetic: false });
    const details = input({ bankSlug: slug });
    await expect(service.signInDemo(details)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await database.db.select().from(users).where(eq(users.email, details.email)),
    ).toHaveLength(0);
  });

  it("allows only explicitly provisioned staff and scopes demo actors to their selected bank", async () => {
    const { service } = harness();
    const unknownStaff = input({ portal: "staff", origin: staffOrigin });
    await expect(service.signInDemo(unknownStaff)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await database.db.select().from(users).where(eq(users.email, unknownStaff.email)),
    ).toHaveLength(0);
    const staff = await service.signInDemo(
      input({ email: "officer-a@example.test", portal: "staff", origin: staffOrigin }),
    );
    expect(staff.session.staffRole).toBe("admin");
    expect(
      (
        await readStaffApplication(
          database.db,
          staff.session.actor,
          seedIds.bankA,
          seedIds.applicationSmall,
        )
      ).id,
    ).toBe(seedIds.applicationSmall);
    // This user has explicit seed access to bank B, but entered the bank A demo.
    const otherOfficer = await service.signInDemo(input({ email: "officer-b@example.test" }));
    await expect(
      readStaffApplication(
        database.db,
        otherOfficer.session.actor,
        seedIds.bankB,
        seedIds.applicationOtherBank,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      readApplication(
        database.db,
        otherOfficer.session.actor,
        seedIds.bankB,
        seedIds.applicationOtherBank,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retains an existing seed verification and never treats a demo as email-link authentication", async () => {
    const { service } = harness();
    const [before] = await database.db.select().from(users).where(eq(users.id, seedIds.borrower));
    const result = await service.signInDemo(input({ email: " BORROWER@example.test " }));
    const [after] = await database.db.select().from(users).where(eq(users.id, seedIds.borrower));
    expect(after?.emailVerifiedAt).toEqual(before?.emailVerifiedAt);
    expect(result.session.user.id).toBe(seedIds.borrower);
    expect(result.session.authenticationMethod).toBe("demo");
    const [stored] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.session.id));
    expect(stored?.authenticationMethod).toBe("demo");
    expect(stored?.tokenHash === hashIdentityCredential(result.sessionToken)).toBe(true);
  });

  it("rejects existing demo sessions when their identity ceases to be synthetic", async () => {
    const { service } = harness();
    const result = await service.signInDemo(input());
    await database.db
      .update(users)
      .set({ synthetic: false })
      .where(eq(users.id, result.session.user.id));
    expect(await service.resolveSession(result.sessionToken, origin)).toBeNull();
  });

  it("throttles denied demo attempts with the same persistent login limit", async () => {
    const { service } = harness();
    const details = input({ portal: "staff", origin: staffOrigin });
    for (let attempt = 0; attempt < 30; attempt++)
      await expect(service.signInDemo(details)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.signInDemo(details)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(consume(service, "bad", origin, details.rateLimitKey)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
