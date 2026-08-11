CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text,
	"call_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rule_id" text,
	"reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "approvals_queue_idx" ON "approvals" USING btree ("org_id","brand_id","status","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_call_idx" ON "approvals" USING btree ("call_id");