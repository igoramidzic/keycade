ALTER TABLE "application_checks" DROP CONSTRAINT "checks_kind_subject";--> statement-breakpoint
ALTER TABLE "application_checks" DROP CONSTRAINT "checks_policy_valid";--> statement-breakpoint
ALTER TABLE "check_runs" ADD COLUMN "footprint_input" jsonb;--> statement-breakpoint
ALTER TABLE "check_runs" ADD COLUMN "refresh_of_run_id" uuid;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_refresh_scope_fk" FOREIGN KEY ("bank_id","application_id","check_id","refresh_of_run_id") REFERENCES "public"."check_runs"("bank_id","application_id","check_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_refresh_source" UNIQUE("refresh_of_run_id");--> statement-breakpoint
ALTER TABLE "application_checks" ADD CONSTRAINT "checks_kind_subject" CHECK (("application_checks"."kind" IN ('fraud','loan_footprint') AND "application_checks"."subject_relationship_id" IS NULL AND "application_checks"."subject_user_id" IS NULL) OR ("application_checks"."kind"='identity' AND "application_checks"."subject_relationship_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "application_checks" ADD CONSTRAINT "checks_policy_valid" CHECK ("application_checks"."stage" IN ('submission','approval','closing') AND "application_checks"."revision">0 AND (("application_checks"."kind" IN ('identity','fraud') AND "application_checks"."policy_version"='demo-checks-v1') OR ("application_checks"."kind"='loan_footprint' AND "application_checks"."policy_version"='US-only-demo-v1' AND NOT "application_checks"."required" AND NOT "application_checks"."allow_review_resolution")));--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_footprint_input_valid" CHECK ("check_runs"."footprint_input" IS NULL OR ("check_runs"."footprint_input"->>'policyVersion'='US-only-demo-v1' AND ("check_runs"."footprint_input"->>'addressRevision')::integer>=0 AND "check_runs"."subject_key"='business' AND "check_runs"."identifier_id" IS NULL));--> statement-breakpoint
-- Add an informational check to every existing synthetic application, including frozen and
-- legacy applications. Preserve application/setup revisions and all existing decision evidence.
INSERT INTO application_checks (bank_id, application_id, stable_key, kind, required, policy_version, allow_review_resolution)
SELECT bank_id, id, 'loan_footprint:business', 'loan_footprint', false, 'US-only-demo-v1', false
FROM applications WHERE synthetic
ON CONFLICT (bank_id, application_id, stable_key) DO NOTHING;
--> statement-breakpoint
-- Queue current, structurally valid address snapshots; missing legacy addresses wait. The
-- compact JSON fingerprint matches the shared domain's ordered address tuple exactly.
WITH snapshots AS (
  SELECT a.*, c.id AS check_id, c.revision AS check_revision, c.policy_version,
    CASE WHEN jsonb_typeof(a.business_address)='object'
      AND a.business_address ?& ARRAY['line1','locality','region','postalCode','countryCode']
      AND jsonb_typeof(a.business_address->'line1')='string' AND length(btrim(a.business_address->>'line1')) BETWEEN 1 AND 200
      AND jsonb_typeof(a.business_address->'locality')='string' AND length(btrim(a.business_address->>'locality')) BETWEEN 1 AND 100
      AND jsonb_typeof(a.business_address->'region')='string' AND length(btrim(a.business_address->>'region')) BETWEEN 1 AND 100
      AND jsonb_typeof(a.business_address->'postalCode')='string' AND length(btrim(a.business_address->>'postalCode')) BETWEEN 1 AND 30
      AND jsonb_typeof(a.business_address->'countryCode')='string' AND upper(btrim(a.business_address->>'countryCode')) ~ '^[A-Z]{2}$'
      AND (NOT a.business_address ? 'line2' OR (jsonb_typeof(a.business_address->'line2')='string' AND length(btrim(a.business_address->>'line2')) BETWEEN 1 AND 200))
      AND a.business_address - ARRAY['line1','line2','locality','region','postalCode','countryCode'] = '{}'::jsonb
    THEN jsonb_strip_nulls(jsonb_build_object(
      'line1',btrim(a.business_address->>'line1'),'line2',btrim(a.business_address->>'line2'),
      'locality',btrim(a.business_address->>'locality'),'region',btrim(a.business_address->>'region'),
      'postalCode',btrim(a.business_address->>'postalCode'),'countryCode',upper(btrim(a.business_address->>'countryCode'))
    )) ELSE NULL END AS snapshot
  FROM applications a JOIN application_checks c ON c.bank_id=a.bank_id AND c.application_id=a.id
  WHERE a.synthetic AND c.kind='loan_footprint'
)
INSERT INTO check_runs (bank_id,application_id,check_id,fingerprint,subject_key,status,missing_prerequisites,footprint_input,request_id)
SELECT bank_id,id,check_id,
  encode(sha256(convert_to('[' || to_json(check_id)::text || ',' || check_revision || ',' || to_json(policy_version)::text || ',' || business_address_revision || ',' ||
    CASE WHEN snapshot IS NULL THEN 'null' ELSE array_to_json(ARRAY[snapshot->>'line1',snapshot->>'line2',snapshot->>'locality',snapshot->>'region',snapshot->>'postalCode',snapshot->>'countryCode'])::text END || ']', 'UTF8')), 'hex'),
  'business', CASE WHEN snapshot IS NULL THEN 'waiting_for_input'::integration_status ELSE 'queued'::integration_status END,
  CASE WHEN snapshot IS NULL THEN '["business_address"]'::jsonb ELSE '[]'::jsonb END,
  jsonb_build_object('addressRevision',business_address_revision,'address',snapshot,'policyVersion',policy_version),
  'loan-footprint-migration'
FROM snapshots ON CONFLICT (check_id,fingerprint) DO NOTHING;
