CREATE TABLE "trend_source_mutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trend_source_mutes_scope_idx" ON "trend_source_mutes" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trend_source_mutes_unique_idx" ON "trend_source_mutes" USING btree ("genome_id","source");