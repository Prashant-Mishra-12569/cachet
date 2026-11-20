CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seal_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"tx_hash" text NOT NULL,
	"payer" text NOT NULL,
	"recipient" text NOT NULL,
	"amount" text NOT NULL,
	"asset" text NOT NULL,
	"sponsored" boolean NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_seal_id_unique" UNIQUE("seal_id"),
	CONSTRAINT "payments_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_seal_id_seals_id_fk" FOREIGN KEY ("seal_id") REFERENCES "public"."seals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;