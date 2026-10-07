import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSchemaReady, migrateDatabase } from "./migrate.js";
import { applicationSetups, applications, auditEvents, businesses } from "./schema.js";
import { seedDatabase, seedIds } from "./seed.js";
import { createTestDatabase } from "./testing.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedDatabase(database.connectionString);
}, 30_000);
afterAll(async () => {
  await database?.cleanup();
});

describe("committed migrations and synthetic data on PostgreSQL", () => {
  it("migrates and seeds repeatedly without duplicates or overwriting edits", async () => {
    await database.db
      .update(applications)
      .set({ purpose: "Changed by integration test" })
      .where(eq(applications.id, seedIds.applicationSmall));
    await migrateDatabase(database.connectionString);
    await seedDatabase(database.connectionString);
    await assertSchemaReady(database.connectionString);
    const result = await database.pool.query("SELECT count(*)::int AS count FROM applications");
    expect(result.rows[0].count).toBe(7);
    const [application] = await database.db
      .select()
      .from(applications)
      .where(eq(applications.id, seedIds.applicationSmall));
    expect(application?.purpose).toBe("Changed by integration test");
  });

  it("preserves exact decimal-string amounts and incomplete draft fields", async () => {
    const seeded = await database.db.select().from(applications);
    expect(seeded.map((row) => row.requestedAmount)).toEqual(
      expect.arrayContaining(["10000.00", "5000000.00", "7500000.00"]),
    );
    const empty = seeded.find((row) => row.id === seedIds.applicationEmpty);
    expect(empty).toMatchObject({
      businessId: null,
      requestedAmount: null,
      productId: seedIds.productA,
      purpose: null,
    });
    const [exact] = await database.db
      .insert(applications)
      .values({
        bankId: seedIds.bankA,
        source: "seed",
        requestedAmount: "999999999999999999.99",
      })
      .returning();
    expect(exact?.requestedAmount).toBe("999999999999999999.99");
  });

  it.each(["-1.00", "0.00", "NaN", "Infinity", "1000000000000000000.00"])(
    "rejects invalid SQL money %s",
    async (value) => {
      await expect(
        database.pool.query(
          "INSERT INTO applications (bank_id, source, requested_amount) VALUES ($1, 'seed', $2)",
          [seedIds.bankA, value],
        ),
      ).rejects.toThrow();
    },
  );

  it.each([
    ["business_id", seedIds.businessOtherBank],
    ["contact_id", seedIds.contactA],
    ["product_id", seedIds.productB],
    ["assigned_staff_id", seedIds.officerB],
  ])("rejects cross-bank %s", async (column, targetId) => {
    // Column names come exclusively from this fixed test matrix.
    const bankId = column === "contact_id" ? seedIds.bankB : seedIds.bankA;
    await expect(
      database.pool.query(
        `INSERT INTO applications (bank_id, source, ${column}) VALUES ($1, 'seed', $2)`,
        [bankId, targetId],
      ),
    ).rejects.toThrow();
  });

  it("rejects cross-bank grants and audit links", async () => {
    await expect(
      database.pool.query(
        "INSERT INTO application_participants (bank_id, application_id, user_id, role) VALUES ($1, $2, $3, 'adviser')",
        [seedIds.bankB, seedIds.applicationSmall, seedIds.officerB],
      ),
    ).rejects.toThrow();
    await expect(
      database.db.insert(auditEvents).values({
        bankId: seedIds.bankB,
        applicationId: seedIds.applicationSmall,
        actorType: "system",
        action: "test",
        targetType: "application",
        requestId: "synthetic-test",
      }),
    ).rejects.toThrow();
  });

  it("holds explicit borrower grants without sharing other business applications", async () => {
    const grants = await database.pool.query(
      "SELECT application_id FROM application_participants WHERE user_id = $1 AND revoked_at IS NULL ORDER BY application_id",
      [seedIds.borrower],
    );
    expect(grants.rows.map((row) => row.application_id)).toEqual([
      seedIds.applicationSmall,
      seedIds.applicationLarge,
      seedIds.applicationSetupDraft,
      seedIds.applicationClosedDraft,
    ]);
    const unshared = await database.db
      .select()
      .from(applications)
      .where(eq(applications.id, seedIds.applicationUnshared));
    expect(unshared[0]?.businessId).toBe(seedIds.businessA);
  });

  it("enforces uniqueness and positive revisions", async () => {
    await expect(
      database.pool.query("INSERT INTO banks (slug, name) VALUES ('bank-a', 'Duplicate')"),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(applications)
        .set({ revision: 0 })
        .where(eq(applications.id, seedIds.applicationSmall)),
    ).rejects.toThrow();
  });

  it("seeds completed and incomplete setup fixtures without overwriting progress", async () => {
    const setups = await database.db.select().from(applicationSetups);
    expect(setups).toHaveLength(7);
    expect(setups.find((row) => row.applicationId === seedIds.applicationSmall)).toMatchObject({
      currentStep: "review",
      completedByUserId: seedIds.borrower,
      skippedSteps: ["industry"],
    });
    expect(setups.find((row) => row.applicationId === seedIds.applicationEmpty)).toMatchObject({
      currentStep: "business_name",
      completedSteps: [],
      skippedSteps: [],
      completedAt: null,
      completedByUserId: null,
    });
    expect(setups.find((row) => row.applicationId === seedIds.applicationSetupDraft)).toMatchObject(
      {
        currentStep: "amount",
        completedSteps: ["business_name"],
        completedAt: null,
      },
    );
    expect(
      setups.find((row) => row.applicationId === seedIds.applicationClosedDraft),
    ).toMatchObject({
      completedAt: null,
      completedByUserId: null,
    });
    await database.db
      .update(applicationSetups)
      .set({ currentStep: "product", completedSteps: ["business_name"] })
      .where(eq(applicationSetups.applicationId, seedIds.applicationEmpty));
    await seedDatabase(database.connectionString);
    const [resumed] = await database.db
      .select()
      .from(applicationSetups)
      .where(eq(applicationSetups.applicationId, seedIds.applicationEmpty));
    expect(resumed?.currentStep).toBe("product");
    expect(resumed?.completedSteps).toEqual(["business_name"]);
  });

  it("rejects cross-bank setup, request, and continuation links", async () => {
    await expect(
      database.pool.query("UPDATE application_setups SET bank_id = $1 WHERE application_id = $2", [
        seedIds.bankB,
        seedIds.applicationSmall,
      ]),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO application_requests (bank_id, scope, operation, key_hash, payload_hash, application_id) VALUES ($1, 'test', 'create', $2, $2, $3)",
        [seedIds.bankB, "a".repeat(64), seedIds.applicationSmall],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO access_delivery_requests (bank_id, contact_id, application_id, portal, origin, return_path, expires_at, request_id) VALUES ($1, $2, $3, 'borrower', 'http://localhost:3001', '/', now() + interval '1 hour', 'synthetic-test')",
        [seedIds.bankA, seedIds.contactA, seedIds.applicationOtherBank],
      ),
    ).rejects.toThrow();
  });

  it("constrains setup steps, positive revisions, and request idempotency scope", async () => {
    for (const changes of [
      { revision: 0 },
      { definitionVersion: 0 },
      { currentStep: "nonexistent" },
      { completedSteps: ["nonexistent"] },
      { skippedSteps: ["product"] },
      { completedSteps: ["industry"], skippedSteps: ["industry"] },
    ]) {
      await expect(
        database.db
          .update(applicationSetups)
          .set(changes)
          .where(eq(applicationSetups.applicationId, seedIds.applicationEmpty)),
      ).rejects.toThrow();
    }
    const insertRequest = (scope: string, operation: string) =>
      database.pool.query(
        "INSERT INTO application_requests (bank_id, scope, operation, key_hash, payload_hash, application_id) VALUES ($1, $2, $3, $4, $4, $5)",
        [seedIds.bankA, scope, operation, "b".repeat(64), seedIds.applicationSmall],
      );
    await insertRequest("actor-a", "create");
    await expect(insertRequest("actor-a", "create")).rejects.toThrow();
    await insertRequest("actor-b", "create");
    await insertRequest("actor-a", "finish");
  });

  it("rolls back prior writes when a later operation fails", async () => {
    const id = randomUUID();
    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .insert(businesses)
          .values({ id, bankId: seedIds.bankA, legalName: "Synthetic rollback business" });
        await tx
          .insert(applications)
          .values({ bankId: seedIds.bankB, businessId: id, source: "seed" });
      }),
    ).rejects.toThrow();
    expect(await database.db.select().from(businesses).where(eq(businesses.id, id))).toHaveLength(
      0,
    );
  });

  it("reports unusable or behind schema without mutating it", async () => {
    await database.pool.query(
      "ALTER TABLE applications RENAME COLUMN revision TO revision_temporarily_missing",
    );
    try {
      await expect(assertSchemaReady(database.connectionString)).rejects.toThrow("pnpm db:migrate");
    } finally {
      await database.pool.query(
        "ALTER TABLE applications RENAME COLUMN revision_temporarily_missing TO revision",
      );
    }
    await assertSchemaReady(database.connectionString);
  });
});
