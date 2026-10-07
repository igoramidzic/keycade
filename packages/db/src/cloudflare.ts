import type pg from "pg";
import journal from "../migrations/meta/_journal.json";

/** Read-only minimum schema check. GitHub alone applies and checks migration hashes. */
export async function assertWorkerSchemaReady(pool: pg.Pool): Promise<void> {
  const history = await pool.query<{ created_at: string }>(
    "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
  );
  if (
    journal.entries.some((entry, i) => String(entry.when) !== String(history.rows[i]?.created_at))
  )
    throw new Error("Required schema migrations are missing.");
  await pool.query(`SELECT a.id, a.bank_id, a.revision, a.requested_amount, p.user_id, p.revoked_at
    FROM applications a LEFT JOIN application_participants p ON p.application_id = a.id AND p.bank_id = a.bank_id LIMIT 0`);
  await pool.query(
    "SELECT id, status, claim_token, lease_until, available_at FROM integration_runs LIMIT 0",
  );
  await pool.query("SELECT run_id, dispatched_at FROM outbox_events LIMIT 0");
  await pool.query("SELECT operation_id FROM effect_deduplications LIMIT 0");
  await pool.query("SELECT id, action FROM audit_events LIMIT 0");
}
