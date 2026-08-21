ALTER TABLE "brands" ADD COLUMN "engagement_autonomy" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "engagement_types" jsonb;