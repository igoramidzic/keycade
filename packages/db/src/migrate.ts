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
    await pool.query(
      "SELECT id, application_id, consumed_at, expires_at FROM access_delivery_requests LIMIT 0",
    );
    await pool.query("SELECT delivery_request_id, token_hash FROM login_tokens LIMIT 0");
    await pool.query(
      "SELECT token_hash, origin, authentication_method, revoked_at FROM sessions LIMIT 0",
    );
    await pool.query("SELECT key_hash, reset_at FROM identity_rate_limits LIMIT 0");
    await pool.query(
      "SELECT id, bank_id, application_id, body, author_user_id, updated_by_user_id, created_at, updated_at FROM staff_notes LIMIT 0",
    );
    await pool.query(`SELECT a.id, a.bank_id, a.revision, a.requested_amount, a.business_name, a.business_address, a.business_address_revision, a.website, a.funding_purposes, a.purpose_catalog_version, a.other_purpose_detail, a.industry_code, a.industry_taxonomy_version, a.demo_created, p.user_id, p.revoked_at
      FROM applications a LEFT JOIN application_participants p ON p.application_id = a.id AND p.bank_id = a.bank_id LIMIT 0`);
    await pool.query(
      "SELECT application_id, bank_id, definition_version, current_step, completed_steps, skipped_steps, revision, completed_at, completed_by_user_id FROM application_setups LIMIT 0",
    );
    await pool.query(
      "SELECT bank_id, scope, operation, key_hash, payload_hash, application_id FROM application_requests LIMIT 0",
    );
    await pool.query(
      "SELECT task_ids, document_ids, unassigned_at FROM application_participants LIMIT 0",
    );
    await pool.query("SELECT invitation_id FROM access_delivery_requests LIMIT 0");
    await pool.query(
      "SELECT id, inviter_grant_id, inviter_grant_updated_at, status, task_assignments FROM invitations LIMIT 0",
    );
    await pool.query(
      "SELECT id, bank_id, application_id, business_id FROM business_relationships LIMIT 0",
    );
    await pool.query("SELECT key_hash, payload_hash, result_id FROM participant_commands LIMIT 0");
    await pool.query("SELECT product_id, version, rules FROM product_requirement_rules LIMIT 0");
    await pool.query(
      "SELECT application_id, rule_set_id, rules, evidence_reuse_policy FROM application_requirement_policies LIMIT 0",
    );
    await pool.query(
      "SELECT bank_id, application_id, stable_key, occurrence, revision, input_fingerprint, assignee_generation_at, evidence_revision, reviewed_evidence_revision FROM application_tasks LIMIT 0",
    );
    await pool.query("SELECT task_id, evidence_revision, author_user_id FROM task_answers LIMIT 0");
    await pool.query("SELECT task_id, task_revision, decision, reason FROM task_reviews LIMIT 0");
    await pool.query("SELECT task_id, participant_id FROM task_assignments LIMIT 0");
    await pool.query("SELECT removed_at FROM business_relationships LIMIT 0");
    await pool.query("SELECT demo_import_fixture FROM document_versions LIMIT 0");
    await pool.query("SELECT footprint_input, refresh_of_run_id FROM check_runs LIMIT 0");
    await pool.query(
      "SELECT version_id, revision, analysis_revision, expected_period FROM document_metadata_revisions LIMIT 0",
    );
    await pool.query(
      "SELECT application_id, version_id, run_id, fact_revision, metric, value, original_candidate FROM financial_fact_reviews LIMIT 0",
    );
    await pool.query(
      "SELECT application_id, idempotency_key, payload_hash, response FROM financial_fact_commands LIMIT 0",
    );
  } catch {
    throw new Error(
      "Database schema is missing, behind, or unusable. Run pnpm db:migrate against the project local database.",
    );
  } finally {
    await pool.end();
  }
}
