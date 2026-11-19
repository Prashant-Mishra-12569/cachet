CREATE TYPE "public"."business_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concordium_account" text NOT NULL,
	"legal_name" text NOT NULL,
	"legal_country" text NOT NULL,
	"issuer" text NOT NULL,
	"proof_tx" text NOT NULL,
	"request_tx" text NOT NULL,
	"status" "business_status" DEFAULT 'active' NOT NULL,
	"never_calls" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_concordium_account_unique" UNIQUE("concordium_account"),
	CONSTRAINT "legal_country_iso2" CHECK ("businesses"."legal_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "legal_name_length" CHECK (char_length("businesses"."legal_name") between 1 and 200)
);
