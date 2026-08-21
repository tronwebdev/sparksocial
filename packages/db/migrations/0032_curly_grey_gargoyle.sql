ALTER TABLE "engagement_messages" ADD COLUMN "thread_key" text;--> statement-breakpoint
ALTER TABLE "engagement_messages" ADD COLUMN "sent_reply" text;--> statement-breakpoint
ALTER TABLE "engagement_messages" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "engagement_messages_thread_idx" ON "engagement_messages" USING btree ("org_id","genome_id","thread_key","received_at");