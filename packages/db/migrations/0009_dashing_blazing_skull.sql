CREATE TABLE "content_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"content_item_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "content_metrics_scope_idx" ON "content_metrics" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_metrics_item_platform_idx" ON "content_metrics" USING btree ("content_item_id","platform");