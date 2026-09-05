CREATE TABLE "asset_folder_members" (
	"org_id" text NOT NULL,
	"folder_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_folder_members_folder_id_user_id_pk" PRIMARY KEY("folder_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "asset_folder_members_scope_idx" ON "asset_folder_members" USING btree ("org_id","folder_id");