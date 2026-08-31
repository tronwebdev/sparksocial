CREATE TABLE "brand_engagement_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"platform" text NOT NULL,
	"autonomy" text,
	"engagement_types" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "hard_rules" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "escalation_behavior" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "engagement_tone" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "emoji_level" text;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_engagement_platform_idx" ON "brand_engagement_settings" USING btree ("brand_id","platform");--> statement-breakpoint
CREATE INDEX "brand_engagement_scope_idx" ON "brand_engagement_settings" USING btree ("org_id","brand_id");