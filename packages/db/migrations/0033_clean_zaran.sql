CREATE TABLE "influencer_watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "influencer_watchlist_scope_idx" ON "influencer_watchlist" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "influencer_watchlist_unique_idx" ON "influencer_watchlist" USING btree ("genome_id","platform","handle");