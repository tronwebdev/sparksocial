CREATE TABLE "trend_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"trend_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"topic" text NOT NULL,
	"volume" integer NOT NULL,
	"velocity_bp" integer NOT NULL,
	"saturation_bp" integer NOT NULL,
	"growth_bp" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trend_observations_unique_idx" ON "trend_observations" USING btree ("source","trend_id","observed_at");