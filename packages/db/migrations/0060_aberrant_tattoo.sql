ALTER TABLE "org_settings" ADD COLUMN "agency_profile" jsonb;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "agency_profile_updated_at" timestamp with time zone;