-- pgvector must be allow-listed as a server parameter on the Azure Flexible
-- Server *before* this migration runs, or this statement fails outright
-- (CLAUDE.md § Infrastructure — Azure). Once allow-listed, this is idempotent.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"agent" text NOT NULL,
	"goal" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"trace_id" text,
	"parent_run_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"run_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"ms" integer NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"folder_id" uuid,
	"media_type" text NOT NULL,
	"asset_role" text NOT NULL,
	"storage_path" text NOT NULL,
	"mux_id" text,
	"caption" text,
	"embedding" vector(1536),
	"quality" jsonb,
	"rights_status" text DEFAULT 'pending' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"source" text,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"campaign_id" uuid,
	"playbook_id" text,
	"mode" text,
	"pillar" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"platform" text,
	"copy" jsonb,
	"embedding" vector(1536),
	"why" jsonb,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genomes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"identity" jsonb NOT NULL,
	"dimensions" jsonb NOT NULL,
	"voice" jsonb NOT NULL,
	"audience" jsonb NOT NULL,
	"offer" jsonb NOT NULL,
	"constraints" jsonb NOT NULL,
	"learned" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536),
	"citation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536),
	"confidence" integer,
	"source_run_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"user_id" text,
	"tool" text NOT NULL,
	"version" integer NOT NULL,
	"caller" text NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text,
	"genome_id" text,
	"role" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"effect" text NOT NULL,
	"decision" text NOT NULL,
	"rule_id" text,
	"reason" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"status" text NOT NULL,
	"error" jsonb,
	"why" jsonb,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_runs_brand_idx" ON "agent_runs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "agent_runs_parent_idx" ON "agent_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("run_id","idx");--> statement-breakpoint
CREATE INDEX "assets_scope_idx" ON "assets" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "content_items_scope_idx" ON "content_items" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "genomes_org_brand_idx" ON "genomes" USING btree ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_scope_idx" ON "knowledge_chunks" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "memories_scope_idx" ON "memories" USING btree ("org_id","genome_id");--> statement-breakpoint
CREATE INDEX "tool_calls_org_brand_idx" ON "tool_calls" USING btree ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tool_calls_idempotency_idx" ON "tool_calls" USING btree ("idempotency_key");