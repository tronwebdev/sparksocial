ALTER TABLE "brands" ADD COLUMN "agent_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "paused_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "pause_reason" text;