CREATE TABLE "signature_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"evidence_revision" integer NOT NULL,
	"body" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_artifacts_envelope_id_unique" UNIQUE("envelope_id"),
	CONSTRAINT "signature_artifact_task_revision" UNIQUE("task_id","evidence_revision")
);
--> statement-breakpoint
CREATE TABLE "signature_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"task_evidence_revision" integer NOT NULL,
	"completed_evidence_revision" integer,
	"idempotency_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"delivery_status" text DEFAULT 'not_sent' NOT NULL,
	"scenario" text NOT NULL,
	"send_error" text,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"send_generation" integer DEFAULT 0 NOT NULL,
	"send_available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"send_claim_token" uuid,
	"send_lease_until" timestamp with time zone,
	"provider_envelope_id" text,
	"stale" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "signature_envelopes_bank_app_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "signature_envelopes_idempotency" UNIQUE("bank_id","application_id","idempotency_key"),
	CONSTRAINT "signature_envelope_state" CHECK ("signature_envelopes"."state" IN ('draft','sent','partially_signed','completed','declined','expired','voided')),
	CONSTRAINT "signature_envelope_delivery" CHECK ("signature_envelopes"."delivery_status" IN ('not_sent','pending','running','sent','failed')),
	CONSTRAINT "signature_envelope_scenario" CHECK ("signature_envelopes"."scenario" IN ('success','transient_error','terminal_error')),
	CONSTRAINT "signature_envelope_revisions" CHECK ("signature_envelopes"."task_evidence_revision">=0 AND "signature_envelopes"."send_attempts">=0 AND "signature_envelopes"."send_generation">=0),
	CONSTRAINT "signature_envelope_completion" CHECK ("signature_envelopes"."state"<>'completed' OR ("signature_envelopes"."completed_at" IS NOT NULL AND "signature_envelopes"."completed_evidence_revision" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "signature_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"kind" text DEFAULT 'signature_requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "signature_notification_signer" UNIQUE("signer_id","kind")
);
--> statement-breakpoint
CREATE TABLE "signature_provider_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"envelope_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"type" text NOT NULL,
	"signer_id" uuid,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_send_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "signature_send_intent" UNIQUE("envelope_id","generation")
);
--> statement-breakpoint
CREATE TABLE "signature_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"participant_generation_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"acted_at" timestamp with time zone,
	CONSTRAINT "signature_signer_envelope_user" UNIQUE("envelope_id","user_id"),
	CONSTRAINT "signature_signer_envelope_id" UNIQUE("envelope_id","id"),
	CONSTRAINT "signature_signer_state" CHECK ("signature_signers"."state" IN ('pending','signed','declined'))
);
--> statement-breakpoint
CREATE TABLE "task_signature_policies" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signature_artifacts" ADD CONSTRAINT "signature_artifacts_envelope_id_signature_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signature_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_artifacts" ADD CONSTRAINT "signature_artifacts_task_id_application_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."application_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelope_app_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelope_task_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelope_version_fk" FOREIGN KEY ("bank_id","application_id","source_version_id") REFERENCES "public"."document_versions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_notification_outbox" ADD CONSTRAINT "signature_notification_outbox_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_notification_outbox" ADD CONSTRAINT "signature_notification_envelope_fk" FOREIGN KEY ("bank_id","application_id","envelope_id") REFERENCES "public"."signature_envelopes"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_notification_outbox" ADD CONSTRAINT "signature_notification_signer_fk" FOREIGN KEY ("envelope_id","signer_id") REFERENCES "public"."signature_signers"("envelope_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_provider_events" ADD CONSTRAINT "signature_provider_events_envelope_id_signature_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signature_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_send_outbox" ADD CONSTRAINT "signature_send_outbox_envelope_id_signature_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signature_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signer_envelope_fk" FOREIGN KEY ("bank_id","application_id","envelope_id") REFERENCES "public"."signature_envelopes"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signer_participant_fk" FOREIGN KEY ("bank_id","application_id","participant_id") REFERENCES "public"."application_participants"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_signature_policies" ADD CONSTRAINT "task_signature_policy_task_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_signature_policies" ADD CONSTRAINT "task_signature_policy_envelope_fk" FOREIGN KEY ("bank_id","application_id","envelope_id") REFERENCES "public"."signature_envelopes"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signature_envelope_dispatch" ON "signature_envelopes" USING btree ("delivery_status","send_available_at");