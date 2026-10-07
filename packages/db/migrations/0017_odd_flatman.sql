CREATE TABLE "application_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"application_revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text NOT NULL,
	"private_note" text,
	"approved_amount" numeric(20, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_submission" UNIQUE("submission_id"),
	CONSTRAINT "decisions_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "decisions_terms_valid" CHECK ("application_decisions"."application_revision">0 AND "application_decisions"."currency"='USD' AND (("application_decisions"."outcome"='approved' AND "application_decisions"."approved_amount" IS NOT NULL AND "application_decisions"."approved_amount">0 AND "application_decisions"."reason_code"='demo_criteria_met') OR ("application_decisions"."outcome"='declined' AND "application_decisions"."approved_amount" IS NULL AND "application_decisions"."reason_code" IN ('demo_criteria_not_met','unable_to_verify_information'))))
);
--> statement-breakpoint
CREATE TABLE "application_review_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_commands_key" UNIQUE("bank_id","application_id","idempotency_key"),
	CONSTRAINT "review_commands_hash" CHECK ("application_review_commands"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "application_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"submission_id" uuid,
	"action" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"application_revision" integer NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason_code" text,
	"private_note" text,
	"task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "review_events_revision" UNIQUE("application_id","application_revision"),
	CONSTRAINT "review_events_action_valid" CHECK ("application_review_events"."application_revision">0 AND "application_review_events"."action" IN ('submit','start_review','request_information','approve','decline','withdraw'))
);
--> statement-breakpoint
CREATE TABLE "application_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"application_revision" integer NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "submissions_sequence" UNIQUE("application_id","sequence"),
	CONSTRAINT "submissions_revision_valid" CHECK ("application_submissions"."sequence">0 AND "application_submissions"."application_revision">0)
);
--> statement-breakpoint
ALTER TABLE "application_decisions" ADD CONSTRAINT "application_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_decisions" ADD CONSTRAINT "decisions_submission_fk" FOREIGN KEY ("bank_id","application_id","submission_id") REFERENCES "public"."application_submissions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_review_commands" ADD CONSTRAINT "application_review_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_review_commands" ADD CONSTRAINT "review_commands_event_fk" FOREIGN KEY ("bank_id","application_id","event_id") REFERENCES "public"."application_review_events"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_review_events" ADD CONSTRAINT "application_review_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_review_events" ADD CONSTRAINT "review_events_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_review_events" ADD CONSTRAINT "review_events_submission_fk" FOREIGN KEY ("bank_id","application_id","submission_id") REFERENCES "public"."application_submissions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "submissions_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;