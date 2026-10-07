import { fileURLToPath, URL } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./index.js";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Caller must validate target ownership before applying migrations to local development data. */
export async function migrateDatabase(connectionString: string): Promise<void> {
  const { db, pool } = createDatabase(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/** Read-only startup check: all committed migration hashes plus an actual schema query. */
export async function assertSchemaReady(connectionString: string): Promise<void> {
  const { pool } = createDatabase(connectionString);
  try {
    const committed = readMigrationFiles({ migrationsFolder });
    const result = await pool.query<{ hash: string }>(
      "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    const applied = result.rows.map((row) => row.hash);
    if (
      applied.length !== committed.length ||
      committed.some((migration, index) => migration.hash !== applied[index])
    ) {
      throw new Error("Schema migration history does not match the committed migrations.");
    }
    await pool.query("SELECT id, status, claim_token FROM integration_runs LIMIT 0");
    await pool.query("SELECT run_id, dispatched_at FROM outbox_events LIMIT 0");
    await pool.query("SELECT operation_id FROM effect_deduplications LIMIT 0");
    await pool.query("SELECT worker_id, seen_at FROM worker_heartbeats LIMIT 0");
    await pool.query("SELECT id, consumed_at, expires_at FROM access_delivery_requests LIMIT 0");
    await pool.query("SELECT delivery_request_id, token_hash FROM login_tokens LIMIT 0");
    await pool.query(
      "SELECT token_hash, origin, authentication_method, revoked_at FROM sessions LIMIT 0",
    );
    await pool.query("SELECT key_hash, reset_at FROM identity_rate_limits LIMIT 0");
    await pool.query(`SELECT a.id, a.bank_id, a.revision, a.requested_amount, p.user_id, p.revoked_at
      FROM applications a LEFT JOIN application_participants p ON p.application_id = a.id AND p.bank_id = a.bank_id LIMIT 0`);
  } catch {
    throw new Error(
      "Database schema is missing, behind, or unusable. Run pnpm db:migrate against the project local database.",
    );
  } finally {
    await pool.end();
  }
}
