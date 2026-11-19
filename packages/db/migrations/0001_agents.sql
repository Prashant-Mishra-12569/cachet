CREATE TYPE "public"."agent_status" AS ENUM('draft', 'registered', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"purposes" text[] NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"calling_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"agent_account" text NOT NULL,
	"status" "agent_status" DEFAULT 'draft' NOT NULL,
	"token_id" bigint,
	"badge" text,
	"register_tx" text,
	"agent_wallet" text,
	"agent_uri" text,
	"metadata_hash" text,
	"card_json" text,
	"card_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "agents_register_tx_unique" UNIQUE("register_tx"),
	CONSTRAINT "agents_card_tx_unique" UNIQUE("card_tx"),
	CONSTRAINT "agent_name_length" CHECK (char_length("agents"."name") between 1 and 80),
	CONSTRAINT "agent_description_length" CHECK (char_length("agents"."description") between 1 and 500),
	CONSTRAINT "agent_language_iso" CHECK ("agents"."language" ~ '^[a-z]{2}$'),
	CONSTRAINT "agent_purposes_nonempty" CHECK (cardinality("agents"."purposes") >= 1)
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_business_idx" ON "agents" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "agents_calling_numbers_idx" ON "agents" USING gin ("calling_numbers");