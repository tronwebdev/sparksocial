CREATE TABLE "content_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"content_item_id" uuid NOT NULL,
	"dub_link_id" text NOT NULL,
	"short_url" text NOT NULL,
	"destination_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "content_links_scope_idx" ON "content_links" USING btree ("org_id","genome_id","content_item_id");