CREATE TABLE "confirmed_enrichment_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confirmed_facts_run_key" UNIQUE("run_id","key"),
	CONSTRAINT "confirmed_facts_allowed_keys" CHECK ("confirmed_enrichment_facts"."key" IN ('entity_type','registration_state'))
);
--> statement-breakpoint
CREATE TABLE "enrichment_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"subject_user_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"identifier_id" uuid,
	"identifier_revision" integer DEFAULT 0 NOT NULL,
	"tax_authorized_at" timestamp with time zone,
	"tax_authorized_by_user_id" uuid,
	"tax_notice_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_inputs_scope" UNIQUE("bank_id","application_id","subject_key"),
	CONSTRAINT "enrichment_inputs_scope_id" UNIQUE("bank_id","application_id","subject_key","id"),
	CONSTRAINT "enrichment_inputs_subject_valid" CHECK ("enrichment_inputs"."subject_key" = coalesce("enrichment_inputs"."subject_user_id"::text, 'business')),
	CONSTRAINT "enrichment_inputs_revision_valid" CHECK ("enrichment_inputs"."revision" >= 0 AND "enrichment_inputs"."identifier_revision" >= 0 AND (("enrichment_inputs"."identifier_id" IS NULL AND "enrichment_inputs"."identifier_revision"=0) OR ("enrichment_inputs"."identifier_id" IS NOT NULL AND "enrichment_inputs"."identifier_revision">0))),
	CONSTRAINT "enrichment_inputs_authorization_valid" CHECK (("enrichment_inputs"."tax_authorized_at" IS NULL AND "enrichment_inputs"."tax_authorized_by_user_id" IS NULL AND "enrichment_inputs"."tax_notice_version" IS NULL) OR ("enrichment_inputs"."tax_authorized_at" IS NOT NULL AND "enrichment_inputs"."tax_authorized_by_user_id" IS NOT NULL AND "enrichment_inputs"."tax_notice_version" IS NOT NULL AND "enrichment_inputs"."tax_notice_version"='demo-tax-v1'))
);
--> statement-breakpoint
CREATE TABLE "enrichment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"input_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"input_revision" integer NOT NULL,
	"application_revision" integer NOT NULL,
	"status" "integration_status" NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"missing_prerequisites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"claim_token" uuid,
	"result" jsonb,
	"error_code" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_runs_scope_id" UNIQUE("bank_id","application_id","subject_key","id"),
	CONSTRAINT "enrichment_runs_current_input" UNIQUE("input_id","kind","input_revision","application_revision"),
	CONSTRAINT "enrichment_runs_kind_subject" CHECK ("enrichment_runs"."kind" IN ('business','tax') AND ("enrichment_runs"."kind" <> 'business' OR "enrichment_runs"."subject_key"='business')),
	CONSTRAINT "enrichment_runs_attempts_valid" CHECK ("enrichment_runs"."input_revision">=0 AND "enrichment_runs"."application_revision">0 AND "enrichment_runs"."attempts">=0 AND "enrichment_runs"."max_attempts" BETWEEN 1 AND 30 AND "enrichment_runs"."attempts"<="enrichment_runs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "sensitive_identifier_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"masked_value" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identifier_versions_scope_id" UNIQUE("bank_id","application_id","subject_key","id"),
	CONSTRAINT "identifier_versions_scope_revision" UNIQUE("bank_id","application_id","subject_key","revision"),
	CONSTRAINT "identifier_versions_revision_kind" CHECK ("sensitive_identifier_versions"."revision" > 0 AND (("sensitive_identifier_versions"."kind" = 'ein' AND "sensitive_identifier_versions"."subject_key" = 'business') OR ("sensitive_identifier_versions"."kind" = 'ssn' AND "sensitive_identifier_versions"."subject_key" ~ '^[a-f0-9-]{36}$'))),
	CONSTRAINT "identifier_versions_encrypted_format" CHECK ("sensitive_identifier_versions"."encrypted_value" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
ALTER TABLE "confirmed_enrichment_facts" ADD CONSTRAINT "confirmed_enrichment_facts_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_enrichment_facts" ADD CONSTRAINT "confirmed_facts_run_scope_fk" FOREIGN KEY ("bank_id","application_id","subject_key","run_id") REFERENCES "public"."enrichment_runs"("bank_id","application_id","subject_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_inputs" ADD CONSTRAINT "enrichment_inputs_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_inputs" ADD CONSTRAINT "enrichment_inputs_tax_authorized_by_user_id_users_id_fk" FOREIGN KEY ("tax_authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_inputs" ADD CONSTRAINT "enrichment_inputs_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_inputs" ADD CONSTRAINT "enrichment_inputs_identifier_scope_fk" FOREIGN KEY ("bank_id","application_id","subject_key","identifier_id") REFERENCES "public"."sensitive_identifier_versions"("bank_id","application_id","subject_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_input_scope_fk" FOREIGN KEY ("bank_id","application_id","subject_key","input_id") REFERENCES "public"."enrichment_inputs"("bank_id","application_id","subject_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_identifier_versions" ADD CONSTRAINT "sensitive_identifier_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_identifier_versions" ADD CONSTRAINT "identifier_versions_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_runs_pending" ON "enrichment_runs" USING btree ("status","available_at","lease_until");