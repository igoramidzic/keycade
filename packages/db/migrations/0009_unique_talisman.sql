ALTER TABLE "business_relationships" ADD CONSTRAINT "relationships_bank_app_id" UNIQUE("bank_id","application_id","id");--> statement-breakpoint
ALTER TABLE "application_tasks" ADD COLUMN "input_fingerprint" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_tasks" ADD CONSTRAINT "tasks_subject_relationship_fk" FOREIGN KEY ("bank_id","application_id","subject_relationship_id") REFERENCES "public"."business_relationships"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
