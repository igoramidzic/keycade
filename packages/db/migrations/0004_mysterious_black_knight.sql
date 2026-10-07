CREATE TABLE "application_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"application_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_requests_scope_key" UNIQUE("bank_id","scope","operation","key_hash"),
	CONSTRAINT "application_requests_key_hash_sha256" CHECK ("application_requests"."key_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "application_requests_payload_hash_sha256" CHECK ("application_requests"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "application_setups" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"bank_id" uuid NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"current_step" text DEFAULT 'business_name' NOT NULL,
	"completed_steps" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"skipped_steps" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	CONSTRAINT "setups_definition_version_positive" CHECK ("application_setups"."definition_version" > 0),
	CONSTRAINT "setups_revision_positive" CHECK ("application_setups"."revision" > 0),
	CONSTRAINT "setups_current_step_valid" CHECK ("application_setups"."current_step" IN ('business_name', 'product', 'amount', 'purpose', 'industry', 'review')),
	CONSTRAINT "setups_completed_steps_valid" CHECK ("application_setups"."completed_steps" <@ ARRAY['business_name', 'product', 'amount', 'purpose', 'industry', 'review']::text[]),
	CONSTRAINT "setups_skipped_steps_optional" CHECK ("application_setups"."skipped_steps" <@ ARRAY['industry']::text[]),
	CONSTRAINT "setups_steps_disjoint" CHECK (NOT ("application_setups"."completed_steps" && "application_setups"."skipped_steps"))
);
--> statement-breakpoint
ALTER TABLE "access_delivery_requests" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "industry_code" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "industry_taxonomy_version" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "demo_created" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_requests" ADD CONSTRAINT "requests_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_setups" ADD CONSTRAINT "application_setups_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_setups" ADD CONSTRAINT "setups_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_delivery_requests" ADD CONSTRAINT "access_delivery_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Adopt each application's existing business name without merging or editing businesses.
UPDATE "applications" AS a
SET "business_name" = b."legal_name"
FROM "businesses" AS b
WHERE a."bank_id" = b."bank_id" AND a."business_id" = b."id";--> statement-breakpoint
-- Historical applications beyond draft keep their existing portal access. No completion
-- actor is invented for those records; all existing drafts still require confirmation.
INSERT INTO "application_setups" (
  "application_id", "bank_id", "revision", "current_step", "completed_steps", "skipped_steps", "completed_at"
)
SELECT
  "id",
  "bank_id",
  "revision",
  CASE WHEN "status" = 'draft' THEN 'business_name' ELSE 'review' END,
  CASE WHEN "status" = 'draft' THEN ARRAY[]::text[] ELSE ARRAY['business_name', 'product', 'amount', 'purpose']::text[] END,
  CASE WHEN "status" = 'draft' THEN ARRAY[]::text[] ELSE ARRAY['industry']::text[] END,
  CASE WHEN "status" = 'draft' THEN NULL ELSE "updated_at" END
FROM "applications";
