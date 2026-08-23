ALTER TABLE "campaigns" ADD COLUMN "campaign_type" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "primary_cta" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "weight" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "engagement_rung" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "learn_from_performance" boolean;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "adjust_mix_automatically" boolean;