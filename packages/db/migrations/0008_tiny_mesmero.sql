ALTER TABLE "application_participants" ADD CONSTRAINT "participants_bank_app_id" UNIQUE("bank_id","application_id","id");--> statement-breakpoint
CREATE TABLE "application_requirement_policies" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"bank_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"evidence_reuse_policy" text DEFAULT 'never' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_policy_version_positive" CHECK ("application_requirement_policies"."version" > 0),
	CONSTRAINT "requirement_policy_reuse_never" CHECK ("application_requirement_policies"."evidence_reuse_policy" = 'never')
);
--> statement-breakpoint
CREATE TABLE "application_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"occurrence" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"rule_set_id" uuid,
	"rule_version" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"reason" text NOT NULL,
	"stage" text NOT NULL,
	"required" boolean NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"visibility" text NOT NULL,
	"subject_user_id" uuid,
	"subject_relationship_id" uuid,
	"assignee_participant_id" uuid,
	"due_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"input_revision" integer NOT NULL,
	"evidence_revision" integer DEFAULT 0 NOT NULL,
	"reviewed_evidence_revision" integer,
	"manual_payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_bank_app_id" UNIQUE("bank_id","application_id","id"),
	CONSTRAINT "tasks_stable_occurrence" UNIQUE("bank_id","application_id","stable_key","occurrence"),
	CONSTRAINT "tasks_states_valid" CHECK ("application_tasks"."state" IN ('open','submitted','needs_changes','completed','waived','cancelled')),
	CONSTRAINT "tasks_stage_valid" CHECK ("application_tasks"."stage" IN ('submission','approval','closing')),
	CONSTRAINT "tasks_visibility_valid" CHECK ("application_tasks"."visibility" IN ('shared','assigned','private')),
	CONSTRAINT "tasks_source_valid" CHECK ("application_tasks"."source" IN ('rule','manual')),
	CONSTRAINT "tasks_revisions_valid" CHECK ("application_tasks"."revision">0 AND "application_tasks"."occurrence">0 AND "application_tasks"."input_revision">0 AND "application_tasks"."evidence_revision">=0),
	CONSTRAINT "tasks_title_valid" CHECK (length(btrim("application_tasks"."title")) BETWEEN 1 AND 160),
	CONSTRAINT "tasks_review_current" CHECK ("application_tasks"."state" <> 'completed' OR ("application_tasks"."evidence_revision">0 AND "application_tasks"."reviewed_evidence_revision" = "application_tasks"."evidence_revision"))
);
--> statement-breakpoint
CREATE TABLE "product_requirement_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"evidence_reuse_policy" text DEFAULT 'never' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_rules_bank_id" UNIQUE("bank_id","id"),
	CONSTRAINT "requirement_rules_product_version" UNIQUE("bank_id","product_id","version"),
	CONSTRAINT "requirement_rules_version_positive" CHECK ("product_requirement_rules"."version" > 0),
	CONSTRAINT "requirement_rules_reuse_never" CHECK ("product_requirement_rules"."evidence_reuse_policy" = 'never')
);
--> statement-breakpoint
CREATE TABLE "task_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"evidence_revision" integer NOT NULL,
	"answer" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_answers_revision" UNIQUE("task_id","evidence_revision"),
	CONSTRAINT "task_answers_revision_positive" CHECK ("task_answers"."evidence_revision">0),
	CONSTRAINT "task_answers_length" CHECK (length(btrim("task_answers"."answer")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"participant_id" uuid,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"evidence_revision" integer NOT NULL,
	"task_revision" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reviews_decision_valid" CHECK ("task_reviews"."decision" IN ('completed','needs_changes','waived')),
	CONSTRAINT "task_reviews_reason_required" CHECK (length(btrim("task_reviews"."reason")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "business_relationships" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application_requirement_policies" ADD CONSTRAINT "requirement_policy_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_requirement_policies" ADD CONSTRAINT "requirement_policy_rule_bank_fk" FOREIGN KEY ("bank_id","rule_set_id") REFERENCES "public"."product_requirement_rules"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_requirement_policies" ADD CONSTRAINT "requirement_policy_product_bank_fk" FOREIGN KEY ("bank_id","product_id") REFERENCES "public"."loan_products"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tasks" ADD CONSTRAINT "application_tasks_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tasks" ADD CONSTRAINT "tasks_application_bank_fk" FOREIGN KEY ("bank_id","application_id") REFERENCES "public"."applications"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tasks" ADD CONSTRAINT "tasks_rule_bank_fk" FOREIGN KEY ("bank_id","rule_set_id") REFERENCES "public"."product_requirement_rules"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tasks" ADD CONSTRAINT "tasks_assignee_application_fk" FOREIGN KEY ("bank_id","application_id","assignee_participant_id") REFERENCES "public"."application_participants"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requirement_rules" ADD CONSTRAINT "product_requirement_rules_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requirement_rules" ADD CONSTRAINT "requirement_rules_product_bank_fk" FOREIGN KEY ("bank_id","product_id") REFERENCES "public"."loan_products"("bank_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_answers" ADD CONSTRAINT "task_answers_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_answers" ADD CONSTRAINT "task_answers_task_bank_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_bank_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_participant_bank_fk" FOREIGN KEY ("bank_id","application_id","participant_id") REFERENCES "public"."application_participants"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_task_bank_fk" FOREIGN KEY ("bank_id","application_id","task_id") REFERENCES "public"."application_tasks"("bank_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_application" ON "application_tasks" USING btree ("bank_id","application_id","state");--> statement-breakpoint
