CREATE TYPE "public"."actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."application_source" AS ENUM('borrower', 'staff', 'seed');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'collecting_information', 'submitted', 'in_review', 'needs_information', 'approved', 'declined', 'closing', 'funded', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."bank_role" AS ENUM('officer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('applicant_admin', 'owner', 'adviser');--> statement-breakpoint
CREATE TYPE "public"."participant_scope" AS ENUM('full', 'assigned');--> statement-breakpoint
CREATE TABLE "applicant_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_bank_id_id" UNIQUE("bank_id","id"),
	CONSTRAINT "contacts_bank_email" UNIQUE("bank_id","email"),
	CONSTRAINT "contacts_email_normalized" CHECK ("applicant_contacts"."email" = lower(btrim("applicant_contacts"."email")) AND length("applicant_contacts"."email") > 3)
);
--> statement-breakpoint
CREATE TABLE "application_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "participant_role" NOT NULL,
	"scope" "participant_scope" DEFAULT 'assigned' NOT NULL,
	"revoked_at" timestamp with time zone,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_application_user" UNIQUE("application_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"business_id" uuid,
	"contact_id" uuid,
	"product_id" uuid,
	"requested_amount" numeric(20, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"purpose" text,
	"source" "application_source" NOT NULL,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"assigned_staff_id" uuid,
	"created_by_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_bank_id_id" UNIQUE("bank_id","id"),
	CONSTRAINT "applications_amount_positive" CHECK ("applications"."requested_amount" IS NULL OR ("applications"."requested_amount" > 0 AND "applications"."requested_amount" <> 'NaN'::numeric)),
	CONSTRAINT "applications_currency_usd" CHECK ("applications"."currency" = 'USD'),
	CONSTRAINT "applications_revision_positive" CHECK ("applications"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid,
	"actor_user_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"changed_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"request_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_actor_user_required" CHECK (("audit_events"."actor_type" = 'user' AND "audit_events"."actor_user_id" IS NOT NULL) OR ("audit_events"."actor_type" = 'system' AND "audit_events"."actor_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "bank_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "bank_role" NOT NULL,
	"revoked_at" timestamp with time zone,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_bank_user" UNIQUE("bank_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"industry_code" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_bank_id_id" UNIQUE("bank_id","id"),
	CONSTRAINT "businesses_revision_positive" CHECK ("businesses"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "loan_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"minimum_amount" numeric(20, 2) NOT NULL,
	"maximum_amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_bank_id_id" UNIQUE("bank_id","id"),
	CONSTRAINT "products_bank_slug_version" UNIQUE("bank_id","slug","version"),
	CONSTRAINT "products_version_positive" CHECK ("loan_products"."version" > 0),
	CONSTRAINT "products_amount_range" CHECK ("loan_products"."minimum_amount" > 0 AND "loan_products"."maximum_amount" >= "loan_products"."minimum_amount" AND "loan_products"."maximum_amount" <> 'NaN'::numeric),
	CONSTRAINT "products_currency_usd" CHECK ("loan_products"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email")) AND length("users"."email") > 3)
);
--> statement-breakpoint
ALTER TABLE "applicant_contacts" ADD CONSTRAINT "applicant_contacts_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_contacts" ADD CONSTRAINT "applicant_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_participants" ADD CONSTRAINT "application_participants_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_participants" ADD CONSTRAINT "application_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_participants" ADD CONSTRAINT "participants_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_business_bank_fk" FOREIGN KEY ("bank_id","business_id") REFERENCES "public"."businesses"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_contact_bank_fk" FOREIGN KEY ("bank_id","contact_id") REFERENCES "public"."applicant_contacts"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_product_bank_fk" FOREIGN KEY ("bank_id","product_id") REFERENCES "public"."loan_products"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assignee_bank_fk" FOREIGN KEY ("bank_id","assigned_staff_id") REFERENCES "public"."bank_memberships"("bank_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_memberships" ADD CONSTRAINT "bank_memberships_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_memberships" ADD CONSTRAINT "bank_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_products" ADD CONSTRAINT "loan_products_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participants_user_bank" ON "application_participants" USING btree ("user_id","bank_id");--> statement-breakpoint
CREATE INDEX "applications_bank_created_id" ON "applications" USING btree ("bank_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_bank_application_created" ON "audit_events" USING btree ("bank_id","application_id","created_at");