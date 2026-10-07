CREATE TABLE "applicant_activity" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"bank_id" uuid NOT NULL,
	"episode_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"last_meaningful_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"bank_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_bank_id_user_id_pk" PRIMARY KEY("bank_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid,
	"recipient_user_id" uuid,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"resource_id" uuid,
	"resource_revision" integer,
	"episode_id" uuid,
	"reminder_ordinal" integer,
	"state" text DEFAULT 'pending' NOT NULL,
	"delivery_request_id" uuid,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suppressed_at" timestamp with time zone,
	"suppression_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_deduplication_key_unique" UNIQUE("deduplication_key"),
	CONSTRAINT "notifications_delivery_request_id_unique" UNIQUE("delivery_request_id"),
	CONSTRAINT "notification_kind_valid" CHECK ("notifications"."kind" IN ('access_requested','application_started','application_resume','invitation','task_assigned','task_returned','status_changed','reminder','signature_requested')),
	CONSTRAINT "notification_state_valid" CHECK ("notifications"."state" IN ('pending','queued','suppressed')),
	CONSTRAINT "notification_recipient_required" CHECK ("notifications"."recipient_user_id" IS NOT NULL OR "notifications"."contact_id" IS NOT NULL),
	CONSTRAINT "notification_reminder_episode" CHECK ("notifications"."kind" <> 'reminder' OR ("notifications"."episode_id" IS NOT NULL AND "notifications"."reminder_ordinal" IN (1,2)))
);
--> statement-breakpoint
ALTER TABLE "applicant_activity" ADD CONSTRAINT "applicant_activity_app_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_delivery_request_id_access_delivery_requests_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."access_delivery_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_app_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_contact_fk" FOREIGN KEY ("bank_id","contact_id") REFERENCES "public"."applicant_contacts"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_pending" ON "notifications" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "notification_application" ON "notifications" USING btree ("bank_id","application_id","created_at");