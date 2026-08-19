ALTER TABLE "brands" ADD COLUMN "family_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "restricted_platforms" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "restricted_content_types" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "quiet_windows" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "permissions" jsonb;