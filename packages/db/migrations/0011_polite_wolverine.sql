CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"storage_key" text NOT NULL,
	"upload_state" text DEFAULT 'staged' NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"scan_state" text DEFAULT 'pending' NOT NULL,
	"scan_error_code" text,
	"scan_available_at" timestamp with time zone,
	"scan_attempts" integer DEFAULT 0 NOT NULL,
	"scan_generation" integer DEFAULT 1 NOT NULL,
	"scan_claim_token" uuid,
	"scan_lease_until" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_versions_bank_app_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "document_versions_document_id" UNIQUE("bank_id","application_id","document_id","id"),
	CONSTRAINT "document_versions_number" UNIQUE("document_id","version"),
	CONSTRAINT "document_versions_idempotency" UNIQUE("bank_id","application_id","uploaded_by_user_id","key_hash"),
	CONSTRAINT "document_versions_size" CHECK ("document_versions"."size_bytes" > 0 AND "document_versions"."version" > 0),
	CONSTRAINT "document_versions_mime" CHECK ("document_versions"."mime_type" IN ('application/pdf','image/jpeg','image/png')),
	CONSTRAINT "document_versions_upload_state" CHECK ("document_versions"."upload_state" IN ('staged','uploaded','abandoned','missing')),
	CONSTRAINT "document_versions_scan_state" CHECK ("document_versions"."scan_state" IN ('pending','clean','blocked','error')),
	CONSTRAINT "document_versions_uploaded_metadata" CHECK ("document_versions"."upload_state" <> 'uploaded' OR ("document_versions"."sha256" IS NOT NULL AND "document_versions"."sha256" ~ '^[a-f0-9]{64}$' AND "document_versions"."uploaded_at" IS NOT NULL)),
	CONSTRAINT "document_versions_scan_metadata" CHECK ("document_versions"."scan_attempts" >= 0 AND "document_versions"."scan_generation" > 0 AND ("document_versions"."scan_state" <> 'clean' OR "document_versions"."upload_state" = 'uploaded'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"task_id" uuid,
	"visibility" text NOT NULL,
	"subject_user_id" uuid,
	"current_version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_bank_app_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "documents_visibility_valid" CHECK ("documents"."visibility" IN ('shared','assigned','private')),
	CONSTRAINT "documents_private_subject" CHECK ("documents"."visibility" <> 'private' OR "documents"."subject_user_id" IS NOT NULL),
	CONSTRAINT "documents_version_valid" CHECK ("documents"."current_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_document_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"evidence_revision" integer NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_document_evidence_version" UNIQUE("task_id","version_id"),
	CONSTRAINT "task_document_evidence_revision" CHECK ("task_document_evidence"."evidence_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("bank_id","application_id","document_id") REFERENCES "public"."documents"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_task_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_document_evidence" ADD CONSTRAINT "task_document_evidence_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_document_evidence" ADD CONSTRAINT "task_document_evidence_task_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_document_evidence" ADD CONSTRAINT "task_document_evidence_version_fk" FOREIGN KEY ("bank_id","application_id","document_id","version_id") REFERENCES "public"."document_versions"("bank_id","application_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_scan_pending" ON "document_versions" USING btree ("upload_state","scan_state","scan_available_at");--> statement-breakpoint
CREATE INDEX "document_versions_cleanup" ON "document_versions" USING btree ("upload_state","expires_at");
