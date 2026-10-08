CREATE TABLE "document_metadata_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"analysis_revision" integer NOT NULL,
	"display_name" text,
	"description" text,
	"expected_period" jsonb,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_metadata_version_revision" UNIQUE("version_id","revision"),
	CONSTRAINT "document_metadata_revision_valid" CHECK ("document_metadata_revisions"."revision" > 0 AND "document_metadata_revisions"."analysis_revision" >= 0 AND "document_metadata_revisions"."analysis_revision" <= "document_metadata_revisions"."revision"),
	CONSTRAINT "document_metadata_text_valid" CHECK (length(btrim("document_metadata_revisions"."reason")) BETWEEN 1 AND 1000 AND ("document_metadata_revisions"."display_name" IS NULL OR length(btrim("document_metadata_revisions"."display_name")) BETWEEN 1 AND 180) AND ("document_metadata_revisions"."description" IS NULL OR length("document_metadata_revisions"."description") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "financial_fact_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_fact_command_key" UNIQUE("bank_id","application_id","idempotency_key"),
	CONSTRAINT "financial_fact_command_hash" CHECK ("financial_fact_commands"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "financial_fact_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"run_generation" integer NOT NULL,
	"category_revision" integer NOT NULL,
	"analysis_revision" integer NOT NULL,
	"metric" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"basis" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"unit" text DEFAULT 'money' NOT NULL,
	"value" numeric(20, 2) NOT NULL,
	"disposition" text NOT NULL,
	"fact_revision" integer,
	"original_candidate" jsonb NOT NULL,
	"adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"business_snapshot" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_fact_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "financial_fact_revision" UNIQUE("bank_id","application_id","metric","period_start","period_end","basis","currency","unit","fact_revision"),
	CONSTRAINT "financial_fact_metric" CHECK ("financial_fact_reviews"."metric" IN ('gross_sales','returns_allowances','revenue','ordinary_income','net_income','depreciation_adjustment','one_time_adjustment','adjusted_net_income','opening_balance','closing_balance','deposits','withdrawals')),
	CONSTRAINT "financial_fact_values" CHECK ("financial_fact_reviews"."currency"='USD' AND "financial_fact_reviews"."unit"='money' AND "financial_fact_reviews"."period_start"<="financial_fact_reviews"."period_end" AND "financial_fact_reviews"."basis" IN ('fiscal_year','statement') AND "financial_fact_reviews"."value"::text NOT IN ('NaN','Infinity','-Infinity')),
	CONSTRAINT "financial_fact_review" CHECK ((("financial_fact_reviews"."disposition" IN ('accept','correct') AND "financial_fact_reviews"."fact_revision" IS NOT NULL AND "financial_fact_reviews"."fact_revision">0) OR ("financial_fact_reviews"."disposition"='reject' AND "financial_fact_reviews"."fact_revision" IS NULL)) AND length(btrim("financial_fact_reviews"."reason")) BETWEEN 1 AND 1000 AND "financial_fact_reviews"."run_generation">0 AND "financial_fact_reviews"."category_revision">=0 AND "financial_fact_reviews"."analysis_revision">=0 AND "financial_fact_reviews"."simulated"=true AND "financial_fact_reviews"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "document_metadata_revisions" ADD CONSTRAINT "document_metadata_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_metadata_revisions" ADD CONSTRAINT "document_metadata_source_fk" FOREIGN KEY ("bank_id","application_id","document_id","version_id") REFERENCES "public"."document_versions"("bank_id","application_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact_commands" ADD CONSTRAINT "financial_fact_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact_commands" ADD CONSTRAINT "financial_fact_command_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact_reviews" ADD CONSTRAINT "financial_fact_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact_reviews" ADD CONSTRAINT "financial_fact_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact_reviews" ADD CONSTRAINT "financial_fact_document_fk" FOREIGN KEY ("bank_id","application_id","document_id","version_id") REFERENCES "public"."document_versions"("bank_id","application_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact_reviews" ADD CONSTRAINT "financial_fact_run_fk" FOREIGN KEY ("bank_id","application_id","run_id") REFERENCES "public"."document_processing_runs"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_fact_history" ON "financial_fact_reviews" USING btree ("bank_id","application_id","reviewed_at");--> statement-breakpoint
CREATE FUNCTION keycade_immutable_financial_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial review and command records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_fact_reviews_immutable BEFORE UPDATE OR DELETE ON financial_fact_reviews
FOR EACH ROW EXECUTE FUNCTION keycade_immutable_financial_record();
--> statement-breakpoint
CREATE TRIGGER financial_fact_commands_immutable BEFORE UPDATE OR DELETE ON financial_fact_commands
FOR EACH ROW EXECUTE FUNCTION keycade_immutable_financial_record();
--> statement-breakpoint
CREATE TRIGGER document_metadata_revisions_immutable BEFORE UPDATE OR DELETE ON document_metadata_revisions
FOR EACH ROW EXECUTE FUNCTION keycade_immutable_financial_record();
