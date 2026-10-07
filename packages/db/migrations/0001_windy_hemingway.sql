CREATE TYPE "public"."integration_status" AS ENUM('waiting_for_input', 'queued', 'running', 'succeeded', 'retry_scheduled', 'failed', 'timed_out', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."simulation_scenario" AS ENUM('success', 'missing_input', 'transient_error', 'timeout', 'terminal_error');--> statement-breakpoint
CREATE TABLE "effect_deduplications" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"input_revision" integer NOT NULL,
	"scenario" "simulation_scenario" NOT NULL,
	"status" "integration_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"claim_token" uuid,
	"stale" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"last_error_code" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_bank_application_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "runs_revisions_attempts_valid" CHECK ("integration_runs"."input_revision" > 0 AND "integration_runs"."attempts" >= 0 AND "integration_runs"."max_attempts" BETWEEN 1 AND 10 AND "integration_runs"."attempts" <= "integration_runs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "effect_deduplications" ADD CONSTRAINT "effects_run_scope_fk" FOREIGN KEY ("bank_id","application_id","operation_id") REFERENCES "public"."integration_runs"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_runs" ADD CONSTRAINT "integration_runs_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_runs" ADD CONSTRAINT "runs_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_run_scope_fk" FOREIGN KEY ("bank_id","application_id","run_id") REFERENCES "public"."integration_runs"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_recovery" ON "integration_runs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "outbox_pending" ON "outbox_events" USING btree ("dispatched_at");