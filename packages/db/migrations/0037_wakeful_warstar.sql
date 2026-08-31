CREATE TABLE "team_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "team_group_members_user_idx" ON "team_group_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "team_group_members_group_idx" ON "team_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_group_members_unique_idx" ON "team_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "team_groups_org_idx" ON "team_groups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_groups_name_idx" ON "team_groups" USING btree ("org_id","name");