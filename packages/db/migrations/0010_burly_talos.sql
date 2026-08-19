CREATE TABLE "engagement_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"author_handle" text NOT NULL,
	"author_name" text,
	"text" text NOT NULL,
	"content_item_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"category" text,
	"intent_score" real,
	"suggested_reply" text,
	"why" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "engagement_messages_scope_idx" ON "engagement_messages" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "engagement_messages_feed_idx" ON "engagement_messages" USING btree ("org_id","genome_id","status","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_messages_external_idx" ON "engagement_messages" USING btree ("org_id","genome_id","platform","external_id");