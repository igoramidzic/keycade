CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_notes_body_length" CHECK (length(btrim("staff_notes"."body")) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_author_bank_fk" FOREIGN KEY ("bank_id","author_user_id") REFERENCES "public"."bank_memberships"("bank_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_editor_bank_fk" FOREIGN KEY ("bank_id","updated_by_user_id") REFERENCES "public"."bank_memberships"("bank_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_notes_bank_application_created" ON "staff_notes" USING btree ("bank_id","application_id","created_at","id");--> statement-breakpoint
CREATE INDEX "applications_bank_updated_id" ON "applications" USING btree ("bank_id","updated_at","id");