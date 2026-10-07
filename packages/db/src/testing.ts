import { randomUUID } from "node:crypto";
import { createDatabase } from "./index.js";
import { migrateDatabase } from "./migrate.js";

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
    adminUrl.username !== "keycade" ||
    !/^\/keycade(?:_[a-z0-9_]+)?$/.test(adminUrl.pathname) ||
    adminUrl.search !== ""
  ) {
    throw new Error(
      "Integration tests require the recognized loopback keycade database/user with no URL overrides.",
    );
  }
  const databaseName = `keycade_test_${randomUUID().replaceAll("-", "")}`;
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
