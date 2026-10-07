CREATE TABLE "demo_inbox_messages" (
	"delivery_request_id" uuid PRIMARY KEY NOT NULL,
	"login_token_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"encrypted_confirm_url" text NOT NULL,
	"attempt" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_inbox_attempt_valid" CHECK ("demo_inbox_messages"."attempt" BETWEEN 1 AND 3),
	CONSTRAINT "demo_inbox_subject_bounded" CHECK (length("demo_inbox_messages"."subject") BETWEEN 1 AND 240),
	CONSTRAINT "demo_inbox_text_bounded" CHECK (length("demo_inbox_messages"."text") BETWEEN 1 AND 4000),
	CONSTRAINT "demo_inbox_link_bounded" CHECK (length("demo_inbox_messages"."encrypted_confirm_url") BETWEEN 1 AND 4096),
	CONSTRAINT "demo_inbox_recipient_normalized" CHECK ("demo_inbox_messages"."recipient_email" = lower(btrim("demo_inbox_messages"."recipient_email")) AND length("demo_inbox_messages"."recipient_email") BETWEEN 4 AND 254)
);
--> statement-breakpoint
ALTER TABLE "demo_inbox_messages" ADD CONSTRAINT "demo_inbox_messages_delivery_request_id_access_delivery_requests_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."access_delivery_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_inbox_messages" ADD CONSTRAINT "demo_inbox_messages_login_token_id_login_tokens_id_fk" FOREIGN KEY ("login_token_id") REFERENCES "public"."login_tokens"("id") ON DELETE no action ON UPDATE no action;