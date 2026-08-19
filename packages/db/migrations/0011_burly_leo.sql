CREATE TABLE "renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"content_item_id" uuid NOT NULL,
	"aspect" text NOT NULL,
	"storage_url" text NOT NULL,
	"engine" text NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "renders_scope_idx" ON "renders" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "renders_content_item_idx" ON "renders" USING btree ("content_item_id");