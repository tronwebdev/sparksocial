CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text,
	"call_id" uuid,
	"tool" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"reason" text DEFAULT 'tool_call' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"options" jsonb,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"run_id" text,
	"answer" text,
	"answered_at" timestamp with time zone,
	"answered_by" text,
	"channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_budgets" (
	"org_id" text PRIMARY KEY NOT NULL,
	"monthly_cap_cents" integer DEFAULT 50000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "posts_per_week" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_call_idx" ON "credit_ledger" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_at_idx" ON "credit_ledger" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "human_messages_brand_idx" ON "human_messages" USING btree ("org_id","brand_id","answered_at");