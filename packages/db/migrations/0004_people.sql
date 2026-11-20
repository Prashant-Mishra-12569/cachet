CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tg_user_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_enc" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_tg_user_id_unique" UNIQUE("tg_user_id"),
	CONSTRAINT "people_phone_hash_unique" UNIQUE("phone_hash")
);
