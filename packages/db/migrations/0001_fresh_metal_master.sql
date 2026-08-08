-- Index shapes matched to the queries that actually run (see schema.ts for the
-- reasoning on each). Dropping `agent_runs_brand_idx` is safe: the new
-- composite leads with `brand_id`, so every lookup the old index served is
-- still served by the new one.
--
-- OPERATIONAL NOTE for when this runs against a database with real traffic:
-- these are plain CREATE INDEX statements, which take an ACCESS EXCLUSIVE lock
-- and block writes to the table for the duration. That is fine now — there is
-- no production data yet — but a later index on a populated `agent_runs` or
-- `content_items` should be `CREATE INDEX CONCURRENTLY`, run outside the
-- migration transaction, since drizzle wraps migrations in one and
-- CONCURRENTLY cannot run inside a transaction.
DROP INDEX "agent_runs_brand_idx";--> statement-breakpoint
CREATE INDEX "agent_runs_brand_started_idx" ON "agent_runs" USING btree ("brand_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_items_published_idx" ON "content_items" USING btree ("org_id","genome_id","published_at" DESC NULLS LAST);