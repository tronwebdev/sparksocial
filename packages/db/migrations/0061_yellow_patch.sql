ALTER TABLE "org_settings" ADD COLUMN "site_slug" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "site_domain" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "site_content" jsonb;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "site_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_site_slug_unique" UNIQUE("site_slug");--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_site_domain_unique" UNIQUE("site_domain");