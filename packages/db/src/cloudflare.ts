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
  await pool.query(`SELECT a.id, a.bank_id, a.revision, a.requested_amount, a.business_name, a.business_address, a.business_address_revision, a.website, a.funding_purposes, a.purpose_catalog_version, a.other_purpose_detail, a.industry_code, a.industry_taxonomy_version, a.demo_created, p.user_id, p.revoked_at
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
  await pool.query(
    "SELECT id, bank_id, application_id, body, author_user_id, updated_by_user_id, created_at, updated_at FROM staff_notes LIMIT 0",
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
}
