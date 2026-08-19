CREATE TABLE "brand_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_arms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"pillar" text NOT NULL,
	"alpha" real DEFAULT 1 NOT NULL,
	"beta" real DEFAULT 1 NOT NULL,
	"observations" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"content_item_id" uuid NOT NULL,
	"pillar" text NOT NULL,
	"reward" real NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"default_approval_mode" text DEFAULT 'review_first_week' NOT NULL,
	"sso_required" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"preview" jsonb NOT NULL,
	"content_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recipe_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"status" text NOT NULL,
	"output_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"interval_minutes" integer,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"token" text NOT NULL,
	"scope" text NOT NULL,
	"target_id" text,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"trend_id" text NOT NULL,
	"source" text NOT NULL,
	"topic" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "brand_members_org_idx" ON "brand_members" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_members_unique_idx" ON "brand_members" USING btree ("brand_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_arms_unique_idx" ON "learning_arms" USING btree ("genome_id","pillar");--> statement-breakpoint
CREATE INDEX "learning_outcomes_scope_idx" ON "learning_outcomes" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_outcomes_item_idx" ON "learning_outcomes" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "recipe_outputs_scope_idx" ON "recipe_outputs" USING btree ("org_id","genome_id","status");--> statement-breakpoint
CREATE INDEX "recipe_runs_recipe_idx" ON "recipe_runs" USING btree ("recipe_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recipes_scope_idx" ON "recipes" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_links_token_idx" ON "review_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "trend_watchlist_scope_idx" ON "trend_watchlist" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trend_watchlist_unique_idx" ON "trend_watchlist" USING btree ("genome_id","trend_id");