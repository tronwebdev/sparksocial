ALTER TABLE "oauth_connections" ADD COLUMN "account_id" text;--> statement-breakpoint
CREATE INDEX "oauth_connections_account_idx" ON "oauth_connections" USING btree ("provider","account_id");