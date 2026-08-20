ALTER TABLE "brands" ADD COLUMN "restricted_topics" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "claims_to_avoid" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "strict_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "tone_vector" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "banned_phrases" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "brand_colors" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "posting_windows" jsonb;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "intent" text;