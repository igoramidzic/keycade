CREATE TABLE "financing_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"structure_revision_id" uuid NOT NULL,
	"use_id" uuid NOT NULL,
	"facility_version_id" uuid,
	"source_id" uuid,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "financing_allocations_use_facility" UNIQUE("use_id","facility_version_id"),
	CONSTRAINT "financing_allocations_use_source" UNIQUE("use_id","source_id"),
	CONSTRAINT "financing_allocations_valid" CHECK (num_nonnulls("financing_allocations"."facility_version_id", "financing_allocations"."source_id") = 1 AND "financing_allocations"."currency" = 'USD' AND ("financing_allocations"."amount" > 0 AND "financing_allocations"."amount" <> 'NaN'::numeric AND "financing_allocations"."amount" <> 'Infinity'::numeric))
);
--> statement-breakpoint
CREATE TABLE "financing_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financing_commands_key" UNIQUE("bank_id","application_id","idempotency_key"),
	CONSTRAINT "financing_commands_valid" CHECK ("financing_commands"."operation" IN ('save_request','save_draft','publish') AND "financing_commands"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "financing_facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"ordinal" integer NOT NULL,
	"legacy_product_id" uuid,
	"introduced_in_structure_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financing_facilities_ordinal" UNIQUE("application_id","ordinal"),
	CONSTRAINT "financing_facilities_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "financing_facilities_scope_origin" UNIQUE("bank_id","application_id","id","origin"),
	CONSTRAINT "financing_facilities_origin" CHECK ("financing_facilities"."ordinal" > 0 AND (("financing_facilities"."origin" = 'legacy' AND "financing_facilities"."introduced_in_structure_id" IS NULL)
        OR ("financing_facilities"."origin" = 'structured' AND "financing_facilities"."legacy_product_id" IS NULL AND "financing_facilities"."introduced_in_structure_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "financing_facility_lineage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"structure_revision_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"predecessor_facility_id" uuid NOT NULL,
	"successor_facility_id" uuid NOT NULL,
	"facility_origin" text DEFAULT 'structured' NOT NULL,
	CONSTRAINT "financing_lineage_edge" UNIQUE("structure_revision_id","predecessor_facility_id","successor_facility_id"),
	CONSTRAINT "financing_lineage_valid" CHECK ("financing_facility_lineage"."facility_origin" = 'structured' AND "financing_facility_lineage"."kind" IN ('split','combine','duplicate') AND "financing_facility_lineage"."predecessor_facility_id" <> "financing_facility_lineage"."successor_facility_id")
);
--> statement-breakpoint
CREATE TABLE "financing_facility_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"structure_revision_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"facility_origin" text DEFAULT 'structured' NOT NULL,
	"position" integer NOT NULL,
	"draft_key" text NOT NULL,
	"family" text NOT NULL,
	"security" text,
	"product_policy_id" uuid,
	"principal" numeric(20, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financing_versions_facility" UNIQUE("structure_revision_id","facility_id"),
	CONSTRAINT "financing_versions_key" UNIQUE("structure_revision_id","draft_key"),
	CONSTRAINT "financing_versions_scope_id" UNIQUE("bank_id","application_id","structure_revision_id","id"),
	CONSTRAINT "financing_versions_valid" CHECK ("financing_facility_versions"."facility_origin" = 'structured' AND "financing_facility_versions"."position" >= 0 AND "financing_facility_versions"."currency" = 'USD'
        AND "financing_facility_versions"."draft_key" ~ '^[a-z0-9][a-z0-9_-]{0,39}$' AND "financing_facility_versions"."family" IN ('sba_7a','conventional_term','equipment_term')
        AND ("financing_facility_versions"."security" IS NULL OR ("financing_facility_versions"."family" = 'conventional_term' AND "financing_facility_versions"."security" IN ('secured','unsecured')))
        AND ("financing_facility_versions"."principal" IS NULL OR ("financing_facility_versions"."principal" > 0 AND "financing_facility_versions"."principal" <> 'NaN'::numeric AND "financing_facility_versions"."principal" <> 'Infinity'::numeric)))
);
--> statement-breakpoint
CREATE TABLE "financing_product_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"family" text NOT NULL,
	"variant" text NOT NULL,
	"version" integer NOT NULL,
	"security" text,
	"minimum_principal" numeric(20, 2) NOT NULL,
	"maximum_principal" numeric(20, 2) NOT NULL,
	"minimum_basis" text NOT NULL,
	"maximum_basis" text NOT NULL,
	"aggregate_maximum" numeric(20, 2),
	"aggregate_basis" text,
	"catalog_version" text NOT NULL,
	"effective_on" date NOT NULL,
	"expires_on" date,
	"review_due_on" date NOT NULL,
	"sources" jsonb NOT NULL,
	"configuration_note" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financing_policies_bank_id" UNIQUE("bank_id","id"),
	CONSTRAINT "financing_policies_bank_id_family" UNIQUE("bank_id","id","family"),
	CONSTRAINT "financing_policies_variant_version" UNIQUE("bank_id","variant","version"),
	CONSTRAINT "financing_policies_variant_family" CHECK (("financing_product_policies"."family" = 'sba_7a' AND "financing_product_policies"."variant" IN ('sba_7a_standard','sba_7a_small') AND "financing_product_policies"."security" IS NULL)
        OR ("financing_product_policies"."family" = 'conventional_term' AND (("financing_product_policies"."variant" = 'conventional_term_secured' AND "financing_product_policies"."security" = 'secured') OR ("financing_product_policies"."variant" = 'conventional_term_unsecured' AND "financing_product_policies"."security" = 'unsecured')))
        OR ("financing_product_policies"."family" = 'equipment_term' AND "financing_product_policies"."variant" = 'equipment_term' AND "financing_product_policies"."security" IS NULL)),
	CONSTRAINT "financing_policies_limits" CHECK ("financing_product_policies"."version" > 0 AND ("financing_product_policies"."minimum_principal" > 0 AND "financing_product_policies"."minimum_principal" <> 'NaN'::numeric AND "financing_product_policies"."minimum_principal" <> 'Infinity'::numeric) AND ("financing_product_policies"."maximum_principal" > 0 AND "financing_product_policies"."maximum_principal" <> 'NaN'::numeric AND "financing_product_policies"."maximum_principal" <> 'Infinity'::numeric)
        AND "financing_product_policies"."maximum_principal" >= "financing_product_policies"."minimum_principal"
        AND "financing_product_policies"."minimum_basis" IN ('program_restriction','bank_policy','fixture_assumption') AND "financing_product_policies"."maximum_basis" IN ('program_restriction','bank_policy','fixture_assumption')
        AND (("financing_product_policies"."aggregate_maximum" IS NULL AND "financing_product_policies"."aggregate_basis" IS NULL)
          OR (("financing_product_policies"."aggregate_maximum" > 0 AND "financing_product_policies"."aggregate_maximum" <> 'NaN'::numeric AND "financing_product_policies"."aggregate_maximum" <> 'Infinity'::numeric) AND "financing_product_policies"."aggregate_basis" IN ('program_restriction','bank_policy','fixture_assumption')))),
	CONSTRAINT "financing_policies_dates" CHECK ("financing_product_policies"."review_due_on" >= "financing_product_policies"."effective_on" AND ("financing_product_policies"."expires_on" IS NULL OR "financing_product_policies"."expires_on" > "financing_product_policies"."effective_on")
        AND jsonb_typeof("financing_product_policies"."sources") = 'array' AND length(btrim("financing_product_policies"."configuration_note")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "financing_request_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"requested_amount" numeric(20, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"product_preference" text,
	"catalog_version" text NOT NULL,
	"reason" text,
	"author_kind" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financing_requests_revision" UNIQUE("application_id","revision"),
	CONSTRAINT "financing_requests_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "financing_requests_valid" CHECK ("financing_request_revisions"."revision" > 0 AND "financing_request_revisions"."currency" = 'USD'
        AND ("financing_request_revisions"."requested_amount" IS NULL OR ("financing_request_revisions"."requested_amount" > 0 AND "financing_request_revisions"."requested_amount" <> 'NaN'::numeric AND "financing_request_revisions"."requested_amount" <> 'Infinity'::numeric))
        AND ("financing_request_revisions"."product_preference" IS NULL OR "financing_request_revisions"."product_preference" IN ('sba_7a','conventional_term','equipment_term','help_me_choose'))
        AND ("financing_request_revisions"."requested_amount" IS NOT NULL OR "financing_request_revisions"."product_preference" IS NOT NULL)
        AND "financing_request_revisions"."author_kind" IN ('applicant','staff')
        AND ("financing_request_revisions"."reason" IS NULL OR length(btrim("financing_request_revisions"."reason")) BETWEEN 1 AND 500)
        AND ("financing_request_revisions"."revision" = 1 OR "financing_request_revisions"."reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "financing_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"structure_revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"draft_key" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "financing_sources_key" UNIQUE("structure_revision_id","draft_key"),
	CONSTRAINT "financing_sources_scope_id" UNIQUE("bank_id","application_id","structure_revision_id","id"),
	CONSTRAINT "financing_sources_valid" CHECK ("financing_sources"."position" >= 0 AND "financing_sources"."currency" = 'USD' AND ("financing_sources"."amount" > 0 AND "financing_sources"."amount" <> 'NaN'::numeric AND "financing_sources"."amount" <> 'Infinity'::numeric)
        AND "financing_sources"."draft_key" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
        AND "financing_sources"."kind" IN ('borrower_contribution','seller_financing','other_lender','grant_or_subsidy','other')
        AND length(btrim("financing_sources"."description")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "financing_structure_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"state" text NOT NULL,
	"sequence" integer,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"request_revision_id" uuid NOT NULL,
	"based_on_id" uuid,
	"reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "financing_structures_scope_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "financing_structures_sequence" UNIQUE("application_id","sequence"),
	CONSTRAINT "financing_structures_state" CHECK ("financing_structure_revisions"."draft_revision" > 0 AND ("financing_structure_revisions"."reason" IS NULL OR length(btrim("financing_structure_revisions"."reason")) BETWEEN 1 AND 500) AND (
        ("financing_structure_revisions"."state" = 'draft' AND "financing_structure_revisions"."sequence" IS NULL AND "financing_structure_revisions"."published_at" IS NULL AND "financing_structure_revisions"."published_by_user_id" IS NULL)
        OR ("financing_structure_revisions"."state" = 'published' AND "financing_structure_revisions"."sequence" > 0 AND "financing_structure_revisions"."reason" IS NOT NULL AND "financing_structure_revisions"."published_at" IS NOT NULL AND "financing_structure_revisions"."published_by_user_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "financing_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"structure_revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"draft_key" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "financing_uses_key" UNIQUE("structure_revision_id","draft_key"),
	CONSTRAINT "financing_uses_scope_id" UNIQUE("bank_id","application_id","structure_revision_id","id"),
	CONSTRAINT "financing_uses_valid" CHECK ("financing_uses"."position" >= 0 AND "financing_uses"."currency" = 'USD' AND ("financing_uses"."amount" > 0 AND "financing_uses"."amount" <> 'NaN'::numeric AND "financing_uses"."amount" <> 'Infinity'::numeric)
        AND "financing_uses"."draft_key" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
        AND "financing_uses"."category" IN ('working_capital','equipment_purchase','real_estate_purchase','business_acquisition','property_improvements','construction','refinance_debt','refinance_real_estate','renewable_energy','fees_and_closing_costs','other')
        AND length(btrim("financing_uses"."description")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "legacy_facility_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"facility_origin" text DEFAULT 'legacy' NOT NULL,
	"decision_id" uuid,
	"closing_package_id" uuid,
	"funding_record_id" uuid,
	"loan_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_links_decision" UNIQUE("decision_id"),
	CONSTRAINT "legacy_links_closing_package" UNIQUE("closing_package_id"),
	CONSTRAINT "legacy_links_funding_record" UNIQUE("funding_record_id"),
	CONSTRAINT "legacy_links_loan_account" UNIQUE("loan_account_id"),
	CONSTRAINT "legacy_links_valid" CHECK ("legacy_facility_links"."facility_origin" = 'legacy' AND num_nonnulls("legacy_facility_links"."decision_id", "legacy_facility_links"."closing_package_id", "legacy_facility_links"."funding_record_id", "legacy_facility_links"."loan_account_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "financing_mode" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "financing_allocations" ADD CONSTRAINT "financing_allocations_structure_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_allocations" ADD CONSTRAINT "financing_allocations_use_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id","use_id") REFERENCES "public"."financing_uses"("bank_id","application_id","structure_revision_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_allocations" ADD CONSTRAINT "financing_allocations_facility_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id","facility_version_id") REFERENCES "public"."financing_facility_versions"("bank_id","application_id","structure_revision_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_allocations" ADD CONSTRAINT "financing_allocations_source_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id","source_id") REFERENCES "public"."financing_sources"("bank_id","application_id","structure_revision_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_commands" ADD CONSTRAINT "financing_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_commands" ADD CONSTRAINT "financing_commands_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facilities" ADD CONSTRAINT "financing_facilities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facilities" ADD CONSTRAINT "financing_facilities_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facilities" ADD CONSTRAINT "financing_facilities_legacy_product_fk" FOREIGN KEY ("bank_id","legacy_product_id") REFERENCES "public"."loan_products"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facilities" ADD CONSTRAINT "financing_facilities_introduced_fk" FOREIGN KEY ("bank_id","application_id","introduced_in_structure_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facility_lineage" ADD CONSTRAINT "financing_lineage_structure_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facility_lineage" ADD CONSTRAINT "financing_lineage_predecessor_fk" FOREIGN KEY ("bank_id","application_id","predecessor_facility_id","facility_origin") REFERENCES "public"."financing_facilities"("bank_id","application_id","id","origin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facility_lineage" ADD CONSTRAINT "financing_lineage_successor_fk" FOREIGN KEY ("bank_id","application_id","successor_facility_id","facility_origin") REFERENCES "public"."financing_facilities"("bank_id","application_id","id","origin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facility_versions" ADD CONSTRAINT "financing_versions_structure_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facility_versions" ADD CONSTRAINT "financing_versions_facility_fk" FOREIGN KEY ("bank_id","application_id","facility_id","facility_origin") REFERENCES "public"."financing_facilities"("bank_id","application_id","id","origin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_facility_versions" ADD CONSTRAINT "financing_versions_policy_fk" FOREIGN KEY ("bank_id","product_policy_id","family") REFERENCES "public"."financing_product_policies"("bank_id","id","family") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_product_policies" ADD CONSTRAINT "financing_product_policies_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_request_revisions" ADD CONSTRAINT "financing_request_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_request_revisions" ADD CONSTRAINT "financing_requests_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_sources" ADD CONSTRAINT "financing_sources_structure_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_structure_revisions" ADD CONSTRAINT "financing_structure_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_structure_revisions" ADD CONSTRAINT "financing_structure_revisions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_structure_revisions" ADD CONSTRAINT "financing_structures_application_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_structure_revisions" ADD CONSTRAINT "financing_structures_request_fk" FOREIGN KEY ("bank_id","application_id","request_revision_id") REFERENCES "public"."financing_request_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_structure_revisions" ADD CONSTRAINT "financing_structures_based_on_fk" FOREIGN KEY ("bank_id","application_id","based_on_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financing_uses" ADD CONSTRAINT "financing_uses_structure_fk" FOREIGN KEY ("bank_id","application_id","structure_revision_id") REFERENCES "public"."financing_structure_revisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_facility_links" ADD CONSTRAINT "legacy_links_facility_fk" FOREIGN KEY ("bank_id","application_id","facility_id","facility_origin") REFERENCES "public"."financing_facilities"("bank_id","application_id","id","origin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_facility_links" ADD CONSTRAINT "legacy_links_decision_fk" FOREIGN KEY ("bank_id","application_id","decision_id") REFERENCES "public"."application_decisions"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_facility_links" ADD CONSTRAINT "legacy_links_closing_package_fk" FOREIGN KEY ("bank_id","application_id","closing_package_id") REFERENCES "public"."application_closing_packages"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_facility_links" ADD CONSTRAINT "legacy_links_funding_record_fk" FOREIGN KEY ("bank_id","application_id","funding_record_id") REFERENCES "public"."funding_records"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_facility_links" ADD CONSTRAINT "legacy_links_loan_account_fk" FOREIGN KEY ("bank_id","application_id","loan_account_id") REFERENCES "public"."loan_accounts"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financing_allocations_structure" ON "financing_allocations" USING btree ("bank_id","application_id","structure_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financing_facilities_one_legacy" ON "financing_facilities" USING btree ("application_id") WHERE "financing_facilities"."origin" = 'legacy';--> statement-breakpoint
CREATE UNIQUE INDEX "financing_structures_one_draft" ON "financing_structure_revisions" USING btree ("application_id") WHERE "financing_structure_revisions"."state" = 'draft';--> statement-breakpoint
CREATE INDEX "financing_structures_application" ON "financing_structure_revisions" USING btree ("bank_id","application_id","sequence");--> statement-breakpoint
CREATE INDEX "legacy_links_facility" ON "legacy_facility_links" USING btree ("bank_id","application_id","facility_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_financing_mode_valid" CHECK ("applications"."financing_mode" IN ('legacy', 'structured'));--> statement-breakpoint
-- History records are append-only. Drafts stay editable until publication freezes them.
CREATE FUNCTION keylend_immutable_financing_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financing history records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financing_request_revisions_immutable BEFORE UPDATE OR DELETE ON financing_request_revisions
FOR EACH ROW EXECUTE FUNCTION keylend_immutable_financing_record();
--> statement-breakpoint
CREATE TRIGGER financing_commands_immutable BEFORE UPDATE OR DELETE ON financing_commands
FOR EACH ROW EXECUTE FUNCTION keylend_immutable_financing_record();
--> statement-breakpoint
CREATE TRIGGER legacy_facility_links_immutable BEFORE UPDATE OR DELETE ON legacy_facility_links
FOR EACH ROW EXECUTE FUNCTION keylend_immutable_financing_record();
--> statement-breakpoint
-- A policy version can only be deactivated; its limits and sources never change once published.
CREATE FUNCTION keylend_immutable_financing_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
    RAISE EXCEPTION 'Financing product policy versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financing_product_policies_immutable BEFORE UPDATE OR DELETE ON financing_product_policies
FOR EACH ROW EXECUTE FUNCTION keylend_immutable_financing_policy();
--> statement-breakpoint
CREATE FUNCTION keylend_guard_financing_structure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'Published financing structures are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financing_structure_revisions_guard BEFORE UPDATE OR DELETE ON financing_structure_revisions
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_structure();
--> statement-breakpoint
CREATE FUNCTION keylend_guard_financing_structure_child() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND EXISTS (
        SELECT 1 FROM financing_structure_revisions s
        WHERE s.id = OLD.structure_revision_id AND s.state = 'published'))
     OR (TG_OP <> 'DELETE' AND EXISTS (
        SELECT 1 FROM financing_structure_revisions s
        WHERE s.id = NEW.structure_revision_id AND s.state = 'published')) THEN
    RAISE EXCEPTION 'Published financing structures are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financing_facility_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON financing_facility_versions
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_structure_child();
--> statement-breakpoint
CREATE TRIGGER financing_uses_guard BEFORE INSERT OR UPDATE OR DELETE ON financing_uses
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_structure_child();
--> statement-breakpoint
CREATE TRIGGER financing_sources_guard BEFORE INSERT OR UPDATE OR DELETE ON financing_sources
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_structure_child();
--> statement-breakpoint
CREATE TRIGGER financing_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON financing_allocations
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_structure_child();
--> statement-breakpoint
CREATE TRIGGER financing_facility_lineage_guard BEFORE INSERT OR UPDATE OR DELETE ON financing_facility_lineage
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_structure_child();
--> statement-breakpoint
-- Facility identities never change. Only an unreferenced identity introduced by a still-open draft may be discarded.
CREATE FUNCTION keylend_guard_financing_facility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.origin = 'legacy' OR NOT EXISTS (
       SELECT 1 FROM financing_structure_revisions s
       WHERE s.id = OLD.introduced_in_structure_id AND s.state = 'draft') THEN
    RAISE EXCEPTION 'Financing facility identities are immutable';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financing_facilities_guard BEFORE UPDATE OR DELETE ON financing_facilities
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_facility();
--> statement-breakpoint
-- Defense in depth for the mode boundary: structured applications cannot receive legacy
-- amount-only decisions, closing packages, funding records or accounts by any code path.
CREATE FUNCTION keylend_require_legacy_financing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM applications a
    WHERE a.bank_id = NEW.bank_id AND a.id = NEW.application_id AND a.financing_mode <> 'legacy') THEN
    RAISE EXCEPTION 'Structured financing applications cannot use legacy decisions, closing or funding'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER application_decisions_legacy_only BEFORE INSERT ON application_decisions
FOR EACH ROW EXECUTE FUNCTION keylend_require_legacy_financing();
--> statement-breakpoint
CREATE TRIGGER application_closing_packages_legacy_only BEFORE INSERT ON application_closing_packages
FOR EACH ROW EXECUTE FUNCTION keylend_require_legacy_financing();
--> statement-breakpoint
CREATE TRIGGER funding_records_legacy_only BEFORE INSERT ON funding_records
FOR EACH ROW EXECUTE FUNCTION keylend_require_legacy_financing();
--> statement-breakpoint
CREATE TRIGGER loan_accounts_legacy_only BEFORE INSERT ON loan_accounts
FOR EACH ROW EXECUTE FUNCTION keylend_require_legacy_financing();
--> statement-breakpoint
-- Structuring is one-way and only possible before any submission or legacy credit record exists.
CREATE FUNCTION keylend_guard_financing_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.financing_mode = OLD.financing_mode THEN
    RETURN NEW;
  END IF;
  IF OLD.financing_mode <> 'legacy' OR NEW.financing_mode <> 'structured'
     OR EXISTS (SELECT 1 FROM application_submissions x WHERE x.bank_id = OLD.bank_id AND x.application_id = OLD.id)
     OR EXISTS (SELECT 1 FROM application_decisions x WHERE x.bank_id = OLD.bank_id AND x.application_id = OLD.id)
     OR EXISTS (SELECT 1 FROM application_closing_packages x WHERE x.bank_id = OLD.bank_id AND x.application_id = OLD.id)
     OR EXISTS (SELECT 1 FROM funding_records x WHERE x.bank_id = OLD.bank_id AND x.application_id = OLD.id)
     OR EXISTS (SELECT 1 FROM loan_accounts x WHERE x.bank_id = OLD.bank_id AND x.application_id = OLD.id) THEN
    RAISE EXCEPTION 'This application cannot change financing mode'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER applications_financing_mode_guard BEFORE UPDATE OF financing_mode ON applications
FOR EACH ROW EXECUTE FUNCTION keylend_guard_financing_mode();
--> statement-breakpoint
-- Version 1 product policies for every existing synthetic bank; seeding covers banks created later.
INSERT INTO "financing_product_policies" ("bank_id","family","variant","version","security","minimum_principal","maximum_principal","minimum_basis","maximum_basis","aggregate_maximum","aggregate_basis","catalog_version","effective_on","expires_on","review_due_on","sources","configuration_note","active","synthetic")
SELECT b.id, p.family, p.variant, p.version, p.security, p.minimum_principal, p.maximum_principal, p.minimum_basis, p.maximum_basis, p.aggregate_maximum, p.aggregate_basis, p.catalog_version, p.effective_on, p.expires_on, p.review_due_on, p.sources, p.configuration_note, true, true
FROM banks b CROSS JOIN (VALUES
  ('sba_7a'::text, 'sba_7a_standard'::text, 1::integer, NULL::text, '350000.01'::numeric, '5000000.00'::numeric, 'program_restriction'::text, 'program_restriction'::text, '5000000.00'::numeric, 'fixture_assumption'::text, '2026-10-12'::text, '2026-10-12'::date, NULL::date, '2027-04-12'::date, '[{"sourceId":"sba-7a","section":"Maximum 7(a) loan amount","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"},{"sourceId":"sba-lenders","section":"7(a) loan program types","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]'::jsonb, 'Synthetic Keybank demo configuration. Individual SBA 7(a) limits follow the cited SBA pages as reviewed on 2026-10-12; the package-level 7(a) total is a conservative demo assumption pending exposure review. This is not an SBA eligibility determination.'::text),
  ('sba_7a', 'sba_7a_small', 1, NULL, '10000.00', '350000.00', 'bank_policy', 'program_restriction', '5000000.00', 'fixture_assumption', '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"sba-lenders","section":"7(a) Small loans","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"},{"sourceId":"sba-7a","section":"Maximum 7(a) loan amount","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Individual SBA 7(a) limits follow the cited SBA pages as reviewed on 2026-10-12; the package-level 7(a) total is a conservative demo assumption pending exposure review. This is not an SBA eligibility determination.'),
  ('conventional_term', 'conventional_term_unsecured', 1, 'unsecured', '10000.00', '1000000.00', 'bank_policy', 'bank_policy', NULL, NULL, '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"key-small","section":"Business term loans (product example)","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank''s actual credit policy; the cited page is a product example only.'),
  ('conventional_term', 'conventional_term_secured', 1, 'secured', '10000.00', '25000000.00', 'bank_policy', 'bank_policy', NULL, NULL, '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"key-small","section":"Business term loans (product example)","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank''s actual credit policy; the cited page is a product example only.'),
  ('equipment_term', 'equipment_term', 1, NULL, '10000.00', '10000000.00', 'bank_policy', 'bank_policy', NULL, NULL, '2026-10-12', '2026-10-12', NULL, '2027-04-12', '[{"sourceId":"key-equipment","section":"Equipment loans (product example)","publishedOn":null,"effectiveOn":null,"reviewedOn":"2026-10-12"}]', 'Synthetic Keybank demo configuration. Limits are illustrative bank-policy fixtures, not Keybank''s actual credit policy; the cited page is a product example only.')
) AS p(family, variant, version, security, minimum_principal, maximum_principal, minimum_basis, maximum_basis, aggregate_maximum, aggregate_basis, catalog_version, effective_on, expires_on, review_due_on, sources, configuration_note)
WHERE b.synthetic
ON CONFLICT ("bank_id","variant","version") DO NOTHING;
--> statement-breakpoint
-- Each existing application is a legacy single-product request: one legacy facility retaining its
-- actual product version. Nothing is relabelled and no original record is rewritten.
INSERT INTO "financing_facilities" ("bank_id","application_id","origin","ordinal","legacy_product_id")
SELECT a.bank_id, a.id, 'legacy', 1, a.product_id
FROM applications a
WHERE a.financing_mode = 'legacy'
  AND NOT EXISTS (SELECT 1 FROM financing_facilities f WHERE f.application_id = a.id AND f.origin = 'legacy');
--> statement-breakpoint
INSERT INTO "legacy_facility_links" ("bank_id","application_id","facility_id","decision_id")
SELECT d.bank_id, d.application_id, f.id, d.id
FROM application_decisions d
JOIN financing_facilities f ON f.bank_id = d.bank_id AND f.application_id = d.application_id AND f.origin = 'legacy'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "legacy_facility_links" ("bank_id","application_id","facility_id","closing_package_id")
SELECT p.bank_id, p.application_id, f.id, p.id
FROM application_closing_packages p
JOIN financing_facilities f ON f.bank_id = p.bank_id AND f.application_id = p.application_id AND f.origin = 'legacy'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "legacy_facility_links" ("bank_id","application_id","facility_id","funding_record_id")
SELECT r.bank_id, r.application_id, f.id, r.id
FROM funding_records r
JOIN financing_facilities f ON f.bank_id = r.bank_id AND f.application_id = r.application_id AND f.origin = 'legacy'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "legacy_facility_links" ("bank_id","application_id","facility_id","loan_account_id")
SELECT l.bank_id, l.application_id, f.id, l.id
FROM loan_accounts l
JOIN financing_facilities f ON f.bank_id = l.bank_id AND f.application_id = l.application_id AND f.origin = 'legacy'
ON CONFLICT DO NOTHING;
