ALTER TABLE "org_settings" ADD COLUMN "two_factor_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "data_residency" text DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "retention_days" integer;