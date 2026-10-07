CREATE TABLE "application_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"kind" text NOT NULL,
	"subject_user_id" uuid,
	"subject_relationship_id" uuid,
	"stage" text DEFAULT 'approval' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"policy_version" text DEFAULT 'demo-checks-v1' NOT NULL,
	"allow_review_resolution" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checks_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "checks_stable_key" UNIQUE("bank_id","application_id","stable_key"),
	CONSTRAINT "checks_kind_subject" CHECK (("application_checks"."kind"='fraud' AND "application_checks"."subject_relationship_id" IS NULL AND "application_checks"."subject_user_id" IS NULL) OR ("application_checks"."kind"='identity' AND "application_checks"."subject_relationship_id" IS NOT NULL)),
	CONSTRAINT "checks_policy_valid" CHECK ("application_checks"."stage" IN ('submission','approval','closing') AND "application_checks"."policy_version"='demo-checks-v1' AND "application_checks"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "check_input_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"kind" text NOT NULL,
	"captured_input_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_input_task_kind" CHECK ("check_input_tasks"."kind" IN ('identifier','tax_authorization') AND ("check_input_tasks"."subject_key"='business' OR "check_input_tasks"."subject_key" ~ '^[a-f0-9-]{36}$') AND ("check_input_tasks"."captured_input_revision" IS NULL OR "check_input_tasks"."captured_input_revision">=0))
);
--> statement-breakpoint
CREATE TABLE "check_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"resolved_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_resolutions_run" UNIQUE("run_id"),
	CONSTRAINT "check_resolution_reason_valid" CHECK ("check_resolutions"."reason"='reviewed_synthetic_evidence')
);
--> statement-breakpoint
CREATE TABLE "check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"identifier_id" uuid,
	"subject_key" text NOT NULL,
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
	CONSTRAINT "check_runs_scope_id" UNIQUE("bank_id","application_id","check_id","id"),
	CONSTRAINT "check_runs_current_input" UNIQUE("check_id","fingerprint"),
	CONSTRAINT "check_runs_attempts_valid" CHECK ("check_runs"."attempts">=0 AND "check_runs"."max_attempts" BETWEEN 1 AND 30 AND "check_runs"."attempts"<="check_runs"."max_attempts"),
	CONSTRAINT "check_runs_fingerprint_valid" CHECK ("check_runs"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "application_checks" ADD CONSTRAINT "application_checks_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_checks" ADD CONSTRAINT "checks_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_checks" ADD CONSTRAINT "checks_relationship_fk" FOREIGN KEY ("bank_id","application_id","subject_relationship_id") REFERENCES "public"."business_relationships"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_input_tasks" ADD CONSTRAINT "check_input_task_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_resolutions" ADD CONSTRAINT "check_resolutions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_resolutions" ADD CONSTRAINT "check_resolutions_run_fk" FOREIGN KEY ("bank_id","application_id","check_id","run_id") REFERENCES "public"."check_runs"("bank_id","application_id","check_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_check_fk" FOREIGN KEY ("bank_id","application_id","check_id") REFERENCES "public"."application_checks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_identifier_fk" FOREIGN KEY ("bank_id","application_id","subject_key","identifier_id") REFERENCES "public"."sensitive_identifier_versions"("bank_id","application_id","subject_key","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_input_task_subject" ON "check_input_tasks" USING btree ("bank_id","application_id","subject_key");--> statement-breakpoint
CREATE INDEX "check_runs_pending" ON "check_runs" USING btree ("status","available_at","lease_until");