ALTER TABLE "content_items" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "last_publish_error" text;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD COLUMN "expiry_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "oauth_connections_expiry_idx" ON "oauth_connections" USING btree ("expires_at");