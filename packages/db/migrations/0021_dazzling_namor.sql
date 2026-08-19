ALTER TABLE "oauth_connections" ADD COLUMN "scopes" text[];--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD COLUMN "account_label" text;