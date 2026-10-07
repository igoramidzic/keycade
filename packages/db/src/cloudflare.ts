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
  await pool.query(`SELECT a.id, a.bank_id, a.revision, a.requested_amount, a.business_name, a.industry_code, a.industry_taxonomy_version, a.demo_created, p.user_id, p.revoked_at
    FROM applications a LEFT JOIN application_participants p ON p.application_id = a.id AND p.bank_id = a.bank_id LIMIT 0`);
  await pool.query(
    "SELECT application_id, bank_id, definition_version, current_step, completed_steps, skipped_steps, revision, completed_at, completed_by_user_id FROM application_setups LIMIT 0",
  );
  await pool.query(
    "SELECT bank_id, scope, operation, key_hash, payload_hash, application_id FROM application_requests LIMIT 0",
  );
  await pool.query(
    "SELECT id, status, claim_token, lease_until, available_at FROM integration_runs LIMIT 0",
  );
  await pool.query("SELECT run_id, dispatched_at FROM outbox_events LIMIT 0");
  await pool.query("SELECT operation_id FROM effect_deduplications LIMIT 0");
  await pool.query("SELECT id, action FROM audit_events LIMIT 0");
  await pool.query(
    "SELECT id, application_id, consumed_at, expires_at FROM access_delivery_requests LIMIT 0",
  );
  await pool.query("SELECT delivery_request_id, token_hash FROM login_tokens LIMIT 0");
  await pool.query(
    "SELECT token_hash, origin, authentication_method, revoked_at FROM sessions LIMIT 0",
  );
  await pool.query("SELECT key_hash, reset_at FROM identity_rate_limits LIMIT 0");
}
