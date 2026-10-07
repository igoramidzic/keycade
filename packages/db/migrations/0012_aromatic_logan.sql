CREATE TABLE "document_category_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"category" text NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_category_override_revision" UNIQUE("version_id","revision"),
	CONSTRAINT "document_category_override_category" CHECK ("document_category_overrides"."category" IN ('tax','bank_statement','financial_statement','business_legal','identification','signed','other')),
	CONSTRAINT "document_category_override_reason" CHECK (length(btrim("document_category_overrides"."reason")) BETWEEN 1 AND 1000 AND "document_category_overrides"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_processing_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_processing_outbox_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "document_processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"stale" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"last_error_code" text,
	"requested_by_user_id" uuid,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_processing_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "document_processing_generation" UNIQUE("version_id","generation"),
	CONSTRAINT "document_processing_state" CHECK ("document_processing_runs"."state" IN ('queued','processing','classified','needs_review','failed')),
	CONSTRAINT "document_processing_attempts" CHECK ("document_processing_runs"."generation" > 0 AND "document_processing_runs"."attempts" >= 0 AND "document_processing_runs"."max_attempts" BETWEEN 1 AND 10 AND "document_processing_runs"."attempts" <= "document_processing_runs"."max_attempts"),
	CONSTRAINT "document_processing_result_required" CHECK ("document_processing_runs"."state" NOT IN ('classified','needs_review') OR "document_processing_runs"."result" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "document_category_overrides" ADD CONSTRAINT "document_category_overrides_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_category_overrides" ADD CONSTRAINT "document_category_override_version_fk" FOREIGN KEY ("bank_id","application_id","version_id") REFERENCES "public"."document_versions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_processing_outbox" ADD CONSTRAINT "document_processing_outbox_run_fk" FOREIGN KEY ("bank_id","application_id","run_id") REFERENCES "public"."document_processing_runs"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_processing_runs" ADD CONSTRAINT "document_processing_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_processing_runs" ADD CONSTRAINT "document_processing_version_fk" FOREIGN KEY ("bank_id","application_id","version_id") REFERENCES "public"."document_versions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_processing_outbox_pending" ON "document_processing_outbox" USING btree ("dispatched_at");--> statement-breakpoint
CREATE INDEX "document_processing_pending" ON "document_processing_runs" USING btree ("state","available_at","lease_until");