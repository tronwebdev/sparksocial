CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"location" text,
	"website" text,
	"interest" text,
	"notes" text,
	"rating" real,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"dedupe_key" text NOT NULL,
	"converted_brand_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"term_months" integer NOT NULL,
	"line_items" jsonb NOT NULL,
	"monthly_cents" integer NOT NULL,
	"one_off_cents" integer NOT NULL,
	"total_contract_cents" integer NOT NULL,
	"notes" text,
	"share_token" text,
	"share_expires_at" timestamp with time zone,
	"share_revoked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "leads_dedupe_idx" ON "leads" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "leads_recent_idx" ON "leads" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_org_status_idx" ON "proposals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "proposals_lead_idx" ON "proposals" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_share_token_idx" ON "proposals" USING btree ("share_token");