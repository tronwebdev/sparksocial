CREATE TABLE "idempotency_reservations" (
	"key" text PRIMARY KEY NOT NULL,
	"tool" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "recipe_id" uuid;