ALTER TABLE "application_setups" DROP CONSTRAINT "setups_current_step_valid";--> statement-breakpoint
ALTER TABLE "application_setups" DROP CONSTRAINT "setups_completed_steps_valid";--> statement-breakpoint
ALTER TABLE "application_setups" DROP CONSTRAINT "setups_skipped_steps_optional";--> statement-breakpoint
ALTER TABLE "application_setups" ALTER COLUMN "definition_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "business_address" jsonb;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "business_address_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "funding_purposes" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "purpose_catalog_version" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "other_purpose_detail" text;--> statement-breakpoint
ALTER TABLE "application_setups" ADD CONSTRAINT "setups_current_step_valid" CHECK ("application_setups"."current_step" IN ('business_name', 'business_address', 'business_ein', 'website', 'other_purpose', 'product', 'amount', 'purpose', 'industry', 'review'));--> statement-breakpoint
ALTER TABLE "application_setups" ADD CONSTRAINT "setups_completed_steps_valid" CHECK ("application_setups"."completed_steps" <@ ARRAY['business_name', 'business_address', 'business_ein', 'website', 'other_purpose', 'product', 'amount', 'purpose', 'industry', 'review']::text[]);--> statement-breakpoint
ALTER TABLE "application_setups" ADD CONSTRAINT "setups_skipped_steps_optional" CHECK ("application_setups"."skipped_steps" <@ ARRAY['industry', 'website', 'business_ein', 'other_purpose']::text[]);--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_address_revision_valid" CHECK (("applications"."business_address" IS NULL AND "applications"."business_address_revision" = 0) OR ("applications"."business_address" IS NOT NULL AND "applications"."business_address_revision" > 0));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_purpose_ids_valid" CHECK ("applications"."funding_purposes" <@ ARRAY['working_capital','equipment_purchase','real_estate_purchase','business_acquisition','property_improvements','refinance_debt','refinance_real_estate','other','renewable_energy','construction','conventional']::text[]);--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_purpose_catalog_valid" CHECK ((cardinality("applications"."funding_purposes") = 0 AND "applications"."purpose_catalog_version" IS NULL) OR ("applications"."purpose_catalog_version" = '2026-01' AND cardinality("applications"."funding_purposes") BETWEEN 0 AND 11));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_other_purpose_selected" CHECK ("applications"."other_purpose_detail" IS NULL OR 'other' = ANY("applications"."funding_purposes"));
--> statement-breakpoint
-- Upgrade only unfinished setups. Keep prior answers, acknowledgments and skips intact;
-- an acknowledged v1 purpose still cannot satisfy v2 completion without catalog selections.
WITH upgraded AS (
  UPDATE "applications" AS a SET "revision" = a."revision" + 1
  FROM "application_setups" AS s
  WHERE a."id" = s."application_id" AND a."bank_id" = s."bank_id"
    AND s."completed_at" IS NULL AND s."definition_version" = 1
  RETURNING a."id", a."bank_id", a."business_name", a."revision"
)
UPDATE "application_setups" AS s SET
  "definition_version" = 2,
  "revision" = a."revision",
  "current_step" = CASE
    WHEN a."business_name" IS NULL OR NOT ('business_name' = ANY(s."completed_steps")) THEN 'business_name'
    ELSE 'business_address'
  END
FROM upgraded AS a
WHERE a."id" = s."application_id" AND a."bank_id" = s."bank_id";
