import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createDatabase } from "./index.js";
import { migrateDatabase } from "./migrate.js";
import { seedIds } from "./seed.js";

/** Fresh real PostgreSQL database per suite; never resets or drops the configured database. */
export async function createTestDatabase(
  adminConnectionString = process.env.TEST_DATABASE_URL,
  options: { migrate?: boolean } = {},
) {
  if (!adminConnectionString)
    throw new Error(
      "TEST_DATABASE_URL is required. Run pnpm test:integration from the repository root.",
    );
  const adminUrl = new URL(adminConnectionString);
  if (
    !["postgres:", "postgresql:"].includes(adminUrl.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) ||
    !["keylend", "keycade"].includes(adminUrl.username) ||
    !/^\/(?:keylend|keycade)(?:_[a-z0-9_]+)?$/.test(adminUrl.pathname) ||
    adminUrl.search !== ""
  ) {
    throw new Error(
      "Integration tests require the recognized loopback keylend database/user with no URL overrides.",
    );
  }
  const databaseName = `keylend_test_${randomUUID().replaceAll("-", "")}`;
  const { pool: adminPool } = createDatabase(adminConnectionString);
  let created = false;
  try {
    // The SQL identifier is entirely generated here, never taken from environment or caller input.
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    const connectionString = testUrl.toString();
    if (options.migrate !== false) await migrateDatabase(connectionString);
    const { db, pool } = createDatabase(connectionString);
    let cleaned = false;
    return {
      connectionString,
      db,
      pool,
      async cleanup() {
        if (cleaned) return;
        await pool.end();
        // pg-pool can resolve end() before retiring clients finish their socket close.
        // A normal drop lets PostgreSQL wait for that graceful exit; FORCE can emit
        // an unhandled 57P01 on a client that is still closing. Real leaked sessions
        // should fail teardown instead of being hidden by server-side termination.
        await adminPool.query(`DROP DATABASE "${databaseName}"`);
        cleaned = true;
        await adminPool.end();
      },
    };
  } catch (error) {
    if (created) await adminPool.query(`DROP DATABASE "${databaseName}"`);
    await adminPool.end();
    throw error;
  }
}

/**
 * Synthetic rows for upgrade tests that start from an older schema. Deliberately uses only the SQL
 * columns present in migration 0004: the current ORM/seed would couple historical fixtures to
 * later schema additions (Drizzle inserts list every current column).
 */
export async function seedHistoricalFixtures(database: { pool: Pick<pg.Pool, "query"> }) {
  await database.pool.query(
    "INSERT INTO banks (id, slug, name, synthetic) VALUES ($1,'keybank','Synthetic Historical A',true), ($2,'isolation-fixture','Synthetic Historical B',true)",
    [seedIds.bankA, seedIds.bankB],
  );
  await database.pool.query(
    `INSERT INTO users (id,email,display_name,email_verified_at,synthetic) VALUES
    ($1,'borrower@example.test','Synthetic Historical Borrower','2026-01-01',true),
    ($2,'officer-a@example.test','Synthetic Historical Officer','2026-01-01',true),
    ($3,'adviser@example.test','Synthetic Historical Adviser','2026-01-01',true),
    ($4,'revoked-owner@example.test','Synthetic Historical Revoked Owner','2026-01-01',true)`,
    [seedIds.borrower, seedIds.officerA, seedIds.adviser, seedIds.revokedOwner],
  );
  await database.pool.query(
    "INSERT INTO bank_memberships (bank_id,user_id,role,synthetic) VALUES ($1,$2,'officer',true)",
    [seedIds.bankA, seedIds.officerA],
  );
  await database.pool.query(
    "INSERT INTO applicant_contacts (id,bank_id,email,user_id,synthetic) VALUES ($1,$2,'borrower@example.test',$3,true)",
    [seedIds.contactA, seedIds.bankA, seedIds.borrower],
  );
  await database.pool.query(
    `INSERT INTO loan_products (id,bank_id,slug,name,minimum_amount,maximum_amount,synthetic) VALUES
    ($1,$2,'business-credit','Synthetic Business Credit',10000,7500000,true),
    ($3,$4,'business-credit','Synthetic Business Credit',10000,7500000,true)`,
    [seedIds.productA, seedIds.bankA, seedIds.productB, seedIds.bankB],
  );
  await database.pool.query(
    `INSERT INTO applications (id,bank_id,product_id,source,status,business_name,synthetic) VALUES
    ($1,$2,$3,'seed','collecting_information','Synthetic Historical Business',true),
    ($4,$2,$3,'seed','draft',NULL,true),
    ($5,$6,$7,'seed','draft','Synthetic Other Isolation fixtureusiness',true)`,
    [
      seedIds.applicationSmall,
      seedIds.bankA,
      seedIds.productA,
      seedIds.applicationEmpty,
      seedIds.applicationOtherBank,
      seedIds.bankB,
      seedIds.productB,
    ],
  );
  await database.pool.query(
    `INSERT INTO application_setups (application_id,bank_id,current_step,completed_steps,skipped_steps,completed_at,completed_by_user_id) VALUES
    ($1,$2,'review',ARRAY['business_name','product','amount','purpose'],ARRAY['industry'],'2026-01-01',$3),
    ($4,$2,'business_name',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL),
    ($5,$6,'business_name',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL)`,
    [
      seedIds.applicationSmall,
      seedIds.bankA,
      seedIds.borrower,
      seedIds.applicationEmpty,
      seedIds.applicationOtherBank,
      seedIds.bankB,
    ],
  );
  await database.pool.query(
    `INSERT INTO application_participants (bank_id,application_id,user_id,role,scope,revoked_at,synthetic) VALUES
    ($1,$2,$3,'applicant_admin','full',NULL,true),
    ($1,$2,$4,'adviser','assigned',NULL,true),
    ($1,$2,$5,'owner','assigned','2026-01-01',true)`,
    [
      seedIds.bankA,
      seedIds.applicationSmall,
      seedIds.borrower,
      seedIds.adviser,
      seedIds.revokedOwner,
    ],
  );
}
