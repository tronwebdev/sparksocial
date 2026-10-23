CREATE TABLE "brand_budgets" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"monthly_cap_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "brand_budgets_org_idx" ON "brand_budgets" USING btree ("org_id");