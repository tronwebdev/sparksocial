ALTER TABLE "brands" ADD COLUMN "publish_roles" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "max_pending_review" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "approval_mode" text;