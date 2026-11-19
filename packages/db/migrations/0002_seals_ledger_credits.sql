CREATE TYPE "public"."anchor_status" AS ENUM('pending', 'submitted', 'finalized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."seal_status" AS ENUM('open', 'closed', 'superseded');--> statement-breakpoint
CREATE TABLE "anchors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"merkle_root" text NOT NULL,
	"item_count" integer NOT NULL,
	"status" "anchor_status" DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"block_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "anchors_merkle_root_unique" UNIQUE("merkle_root"),
	CONSTRAINT "anchors_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "credit_purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	"amount" text NOT NULL,
	"asset" text NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_purchases_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "ledger_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"item_hash" text NOT NULL,
	"anchor_id" bigint,
	"leaf_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_items_item_hash_unique" UNIQUE("item_hash")
);
--> statement-breakpoint
CREATE TABLE "seal_credits" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seal_credits_non_negative" CHECK ("seal_credits"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seals" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"from_e164" text NOT NULL,
	"purpose" text NOT NULL,
	"message" text NOT NULL,
	"amount_value" text,
	"amount_asset" text,
	"code" text NOT NULL,
	"status" "seal_status" DEFAULT 'open' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"seal_json" text NOT NULL,
	"seal_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seals_seal_hash_unique" UNIQUE("seal_hash"),
	CONSTRAINT "seal_code_4_digits" CHECK ("seals"."code" ~ '^[0-9]{4}$'),
	CONSTRAINT "seal_message_length" CHECK (char_length("seals"."message") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_items" ADD CONSTRAINT "ledger_items_anchor_id_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_credits" ADD CONSTRAINT "seal_credits_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seals" ADD CONSTRAINT "seals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seals" ADD CONSTRAINT "seals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_unanchored_idx" ON "ledger_items" USING btree ("id") WHERE "ledger_items"."anchor_id" is null;--> statement-breakpoint
CREATE INDEX "ledger_ref_idx" ON "ledger_items" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "seals_phone_open_idx" ON "seals" USING btree ("phone_hash","expires_at");--> statement-breakpoint
CREATE INDEX "seals_agent_issued_idx" ON "seals" USING btree ("agent_id","issued_at");