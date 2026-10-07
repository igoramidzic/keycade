CREATE TABLE "business_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"ownership_percent" numeric(5, 2),
	"user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationships_kind_valid" CHECK ("business_relationships"."kind" IN ('owner', 'contact')),
	CONSTRAINT "relationships_name_valid" CHECK (length(btrim("business_relationships"."display_name")) BETWEEN 1 AND 160),
	CONSTRAINT "relationships_percentage_valid" CHECK ("business_relationships"."ownership_percent" IS NULL OR ("business_relationships"."kind" = 'owner' AND "business_relationships"."ownership_percent" >= 0 AND "business_relationships"."ownership_percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "participant_role" NOT NULL,
	"scope" "participant_scope" DEFAULT 'assigned' NOT NULL,
	"task_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"document_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"inviter_kind" text NOT NULL,
	"inviter_grant_id" uuid NOT NULL,
	"inviter_grant_updated_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_bank_id_id" UNIQUE("bank_id","id"),
	CONSTRAINT "invitations_email_normalized" CHECK ("invitations"."email" = lower(btrim("invitations"."email")) AND length("invitations"."email") > 3),
	CONSTRAINT "invitations_status_valid" CHECK ("invitations"."status" IN ('pending', 'accepted', 'revoked')),
	CONSTRAINT "invitations_inviter_kind_valid" CHECK ("invitations"."inviter_kind" IN ('staff', 'participant')),
	CONSTRAINT "invitations_admin_scope_valid" CHECK ("invitations"."role" <> 'applicant_admin' OR "invitations"."scope" = 'full')
);
--> statement-breakpoint
CREATE TABLE "participant_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_commands_scope_key" UNIQUE("bank_id","application_id","actor_user_id","operation","key_hash"),
	CONSTRAINT "participant_commands_key_hash_valid" CHECK ("participant_commands"."key_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "participant_commands_payload_hash_valid" CHECK ("participant_commands"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "access_delivery_requests" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "application_participants" ADD COLUMN "task_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "application_participants" ADD COLUMN "document_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "application_participants" ADD COLUMN "unassigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_relationships" ADD CONSTRAINT "business_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_relationships" ADD CONSTRAINT "business_relationships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_relationships" ADD CONSTRAINT "relationships_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_relationships" ADD CONSTRAINT "relationships_business_bank_fk" FOREIGN KEY ("bank_id","business_id") REFERENCES "public"."businesses"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_commands" ADD CONSTRAINT "participant_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_commands" ADD CONSTRAINT "participant_commands_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relationships_application" ON "business_relationships" USING btree ("bank_id","application_id");--> statement-breakpoint
CREATE INDEX "invitations_application" ON "invitations" USING btree ("bank_id","application_id");--> statement-breakpoint
ALTER TABLE "access_delivery_requests" ADD CONSTRAINT "access_delivery_invitation_bank_fk" FOREIGN KEY ("bank_id","invitation_id") REFERENCES "public"."invitations"("bank_id","id") ON DELETE no action ON UPDATE no action;