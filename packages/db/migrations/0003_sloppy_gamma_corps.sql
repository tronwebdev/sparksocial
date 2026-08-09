CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"approval_mode" text DEFAULT 'review_first_week' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "brands_org_idx" ON "brands" USING btree ("org_id");