CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "api_key_name_length" CHECK (char_length("api_keys"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "invited_by_business_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_business_idx" ON "api_keys" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_invited_by_business_id_businesses_id_fk" FOREIGN KEY ("invited_by_business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_invite_code_unique" UNIQUE("invite_code");