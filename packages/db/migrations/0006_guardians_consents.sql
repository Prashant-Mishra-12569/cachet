CREATE TYPE "public"."consent_status" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hash" text NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" text DEFAULT 'bot' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_person_id" uuid NOT NULL,
	"guardian_name" text NOT NULL,
	"ward_label" text NOT NULL,
	"ward_person_id" uuid,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_invite_token_hash_unique" UNIQUE("invite_token_hash"),
	CONSTRAINT "guardian_label_length" CHECK (char_length("guardians"."ward_label") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_guardian_person_id_people_id_fk" FOREIGN KEY ("guardian_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_ward_person_id_people_id_fk" FOREIGN KEY ("ward_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consents_phone_business_idx" ON "consents" USING btree ("phone_hash","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardians_pair_idx" ON "guardians" USING btree ("guardian_person_id","ward_person_id");--> statement-breakpoint
CREATE INDEX "guardians_ward_idx" ON "guardians" USING btree ("ward_person_id");