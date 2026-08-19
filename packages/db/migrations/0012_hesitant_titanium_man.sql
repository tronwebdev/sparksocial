CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"temperature" text NOT NULL,
	"recommended_action" text NOT NULL,
	"routed_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "opportunities_scope_idx" ON "opportunities" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "opportunities_inbox_item_idx" ON "opportunities" USING btree ("inbox_item_id");