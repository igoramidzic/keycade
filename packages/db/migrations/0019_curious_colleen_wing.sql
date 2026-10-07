CREATE TABLE "application_closing_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"amount_policy" text NOT NULL,
	"terms" jsonb NOT NULL,
	"condition_templates" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_packages_application" UNIQUE("application_id"),
	CONSTRAINT "closing_packages_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "closing_packages_decision_id" UNIQUE("bank_id","application_id","id","decision_id"),
	CONSTRAINT "closing_package_valid" CHECK ("application_closing_packages"."revision">0 AND "application_closing_packages"."policy_version">0 AND "application_closing_packages"."amount_policy"='exact_approved_amount')
);
--> statement-breakpoint
CREATE TABLE "closing_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"account_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"application_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_commands_key" UNIQUE("bank_id","application_id","idempotency_key"),
	CONSTRAINT "closing_command_valid" CHECK ("closing_commands"."application_revision">0 AND "closing_commands"."payload_hash" ~ '^[a-f0-9]{64}$' AND (("closing_commands"."action"='start' AND "closing_commands"."account_id" IS NULL) OR ("closing_commands"."action"='fund' AND "closing_commands"."account_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "closing_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"required" boolean NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_condition_key" UNIQUE("package_id","key"),
	CONSTRAINT "closing_condition_task" UNIQUE("task_id"),
	CONSTRAINT "closing_condition_kind" CHECK ("closing_conditions"."kind" IN ('task','signature'))
);
--> statement-breakpoint
CREATE TABLE "funding_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"approved_amount" numeric(20, 2) NOT NULL,
	"funded_amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"funded_on" date NOT NULL,
	"reference" text NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"evidence" jsonb NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_records_application" UNIQUE("application_id"),
	CONSTRAINT "funding_records_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "funding_amounts_simulated" CHECK ("funding_records"."simulated"=true AND "funding_records"."currency"='USD' AND "funding_records"."approved_amount">0 AND "funding_records"."funded_amount"="funding_records"."approved_amount"),
	CONSTRAINT "funding_reference_valid" CHECK (length(btrim("funding_records"."reference")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "loan_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"funding_record_id" uuid NOT NULL,
	"terms" jsonb NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_accounts_application" UNIQUE("application_id"),
	CONSTRAINT "loan_accounts_funding" UNIQUE("funding_record_id"),
	CONSTRAINT "loan_accounts_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "account_simulated" CHECK ("loan_accounts"."simulated"=true)
);
--> statement-breakpoint
CREATE TABLE "product_closing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"amount_policy" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closing_policies_scope_id" UNIQUE("bank_id","id"),
	CONSTRAINT "closing_policies_version" UNIQUE("product_id","version"),
	CONSTRAINT "closing_policy_valid" CHECK ("product_closing_policies"."version">0 AND "product_closing_policies"."amount_policy"='exact_approved_amount')
);
--> statement-breakpoint
ALTER TABLE "application_closing_packages" ADD CONSTRAINT "application_closing_packages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_closing_packages" ADD CONSTRAINT "closing_package_decision_fk" FOREIGN KEY ("bank_id","application_id","decision_id") REFERENCES "public"."application_decisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_closing_packages" ADD CONSTRAINT "closing_package_submission_fk" FOREIGN KEY ("bank_id","application_id","submission_id") REFERENCES "public"."application_submissions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_closing_packages" ADD CONSTRAINT "closing_package_policy_fk" FOREIGN KEY ("bank_id","policy_id") REFERENCES "public"."product_closing_policies"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_commands" ADD CONSTRAINT "closing_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_commands" ADD CONSTRAINT "closing_command_package_fk" FOREIGN KEY ("bank_id","application_id","package_id") REFERENCES "public"."application_closing_packages"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_commands" ADD CONSTRAINT "closing_command_account_fk" FOREIGN KEY ("bank_id","application_id","account_id") REFERENCES "public"."loan_accounts"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_conditions" ADD CONSTRAINT "closing_condition_package_fk" FOREIGN KEY ("bank_id","application_id","package_id") REFERENCES "public"."application_closing_packages"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_conditions" ADD CONSTRAINT "closing_condition_task_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_records" ADD CONSTRAINT "funding_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_records" ADD CONSTRAINT "funding_package_decision_fk" FOREIGN KEY ("bank_id","application_id","package_id","decision_id") REFERENCES "public"."application_closing_packages"("bank_id","application_id","id","decision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_accounts" ADD CONSTRAINT "account_funding_fk" FOREIGN KEY ("bank_id","application_id","funding_record_id") REFERENCES "public"."funding_records"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_accounts" ADD CONSTRAINT "account_business_fk" FOREIGN KEY ("bank_id","business_id") REFERENCES "public"."businesses"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_closing_policies" ADD CONSTRAINT "closing_policy_product_fk" FOREIGN KEY ("bank_id","product_id") REFERENCES "public"."loan_products"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Configure existing synthetic product versions in hosted and local databases without relying on seeds.
INSERT INTO "product_closing_policies" ("bank_id", "product_id", "version", "amount_policy", "conditions")
SELECT "bank_id", "id", 1, 'exact_approved_amount',
'[{"key":"funding-confirmation","title":"Confirm simulated funding readiness","description":"Confirm that the approved funding shown here is a simulation and moves no money.","kind":"task","required":true},{"key":"closing-agreement","title":"Sign simulated closing agreement","description":"Bank staff prepare a clean synthetic closing document and select the intended verified signers. Every intended signer must complete this simulated agreement.","kind":"signature","required":true}]'::jsonb
FROM "loan_products" WHERE "synthetic"=true AND "slug"='business-credit'
ON CONFLICT ("product_id","version") DO NOTHING;
