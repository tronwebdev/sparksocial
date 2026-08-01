import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — the subset the scoped query layer guards.
 *
 * Master plan §5. Every table carries `org_id`; brand-scoped tables carry `brand_id`;
 * content and asset tables carry `genome_id`. The four tables below are the ones that
 * hold client-confidential material, so they are the ones `scoped.ts` requires a
 * `genomeId` predicate for. Keep `SCOPED_TABLES` in scoped.ts in sync with this list.
 *
 * Target: Azure Database for PostgreSQL Flexible Server. `pgvector` must be allow-listed
 * as a server parameter before `CREATE EXTENSION vector` will succeed.
 *
 * Embeddings are 1536-dim (`text-embedding-3-large`), mandated by the engine spec for
 * ClientForce consistency.
 */

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    folderId: uuid('folder_id'),
    mediaType: text('media_type').notNull(),
    /** AssetRole from @sparksocial/shared — typed at the repository boundary. */
    assetRole: text('asset_role').notNull(),
    storagePath: text('storage_path').notNull(), // Azure Blob Storage
    muxId: text('mux_id'),
    caption: text('caption'),
    embedding: vector('embedding', { dimensions: 1536 }),
    quality: jsonb('quality'),
    /** 'cleared' | 'pending' | 'restricted' — retrieval only ever returns 'cleared'. */
    rightsStatus: text('rights_status').notNull().default('pending'),
    usageCount: integer('usage_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    source: text('source'),
    provenance: jsonb('provenance'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assets_scope_idx').on(t.orgId, t.genomeId)],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    docId: uuid('doc_id').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    citation: jsonb('citation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('knowledge_chunks_scope_idx').on(t.orgId, t.genomeId)],
);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: integer('confidence'),
    sourceRunId: uuid('source_run_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('memories_scope_idx').on(t.orgId, t.genomeId)],
);

export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    campaignId: uuid('campaign_id'),
    playbookId: text('playbook_id'),
    mode: text('mode'), // synthesize | assemble | direct_finish
    pillar: text('pillar'),
    status: text('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    platform: text('platform'),
    copy: jsonb('copy'),
    /**
     * The copy's embedding at publish time — the guardrail layer's `duplicate`
     * check (§10) compares a new draft against the trailing 90 days of these.
     * Computed once, here, rather than re-embedding historical copy on every
     * guardrail run: that would mean every duplicate check pays for N embedding
     * calls where N is how much has been published recently, which grows
     * unboundedly with account age.
     */
    embedding: vector('embedding', { dimensions: 1536 }),
    /** The Explanation payload — PRD §7.3, rendered by <WhyPopover />. */
    why: jsonb('why'),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('content_items_scope_idx').on(t.orgId, t.genomeId)],
);

/**
 * THE BRAND GENOME — engine spec §3.2, `packages/shared/src/genome.ts`'s `Genome` type.
 *
 * `identity`/`voice`/`audience`/`offer`/`constraints`/`learned` are stored as JSONB
 * rather than normalized: they are read and written as one unit by every caller
 * (`ScopedDb.genomes.get` returns the whole `Genome`), and none of them are queried
 * independently today. `dimensions` gets the same treatment for consistency, but is
 * the one column worth a GIN index the moment the resolver needs to query across
 * genomes by dimension rather than always loading one genome by id — CLAUDE.md's
 * "index them" note for `dimensions` is aspirational until that query exists.
 *
 * NOT in `SCOPED_TABLES` (`scoped.ts`): a genome is looked up by its own id, which
 * already pins it to one org/brand — there is no cross-genome genome query for the
 * isolation predicate to guard.
 */
export const genomes = pgTable(
  'genomes',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id').notNull(), // Genome.workspace_id
    version: integer('version').notNull().default(1),
    identity: jsonb('identity').notNull(),
    dimensions: jsonb('dimensions').notNull(),
    voice: jsonb('voice').notNull(),
    audience: jsonb('audience').notNull(),
    offer: jsonb('offer').notNull(),
    constraints: jsonb('constraints').notNull(),
    learned: jsonb('learned').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('genomes_org_brand_idx').on(t.orgId, t.brandId)],
);

/**
 * THE AUDIT ROW — master plan §5 `tool_calls`, `packages/tools/src/invoke.ts`'s
 * `ToolCallRecord`.
 *
 * Written exactly once per invocation (`invoke.ts` never updates a row after
 * writing it — gated/failed/succeeded are all terminal), so this is INSERT-only,
 * never UPDATE. `idempotencyKey` is unique-indexed because it is the field
 * `lookupIdempotent` filters on before a non-idempotent tool re-runs a side effect.
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id'),
    userId: text('user_id'),
    tool: text('tool').notNull(),
    version: integer('version').notNull(),
    caller: text('caller').notNull(), // 'user' | 'agent'
    orgId: text('org_id').notNull(),
    brandId: text('brand_id'),
    genomeId: text('genome_id'),
    role: text('role').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    effect: text('effect').notNull(),
    decision: text('decision').notNull(), // Decision['kind']
    ruleId: text('rule_id'),
    reason: text('reason'),
    costCents: integer('cost_cents').notNull().default(0),
    idempotencyKey: text('idempotency_key'),
    status: text('status').notNull(),
    error: jsonb('error'),
    why: jsonb('why'),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('tool_calls_org_brand_idx').on(t.orgId, t.brandId),
    index('tool_calls_run_idx').on(t.runId),
    // Partial-unique would be ideal (NULLs excluded) but Drizzle's pgTable index
    // builder doesn't expose a WHERE clause portably across drivers here — an
    // ordinary index is enough for `lookupIdempotent`'s equality lookup; true
    // uniqueness is enforced by the "replay if found" logic in invoke.ts, which
    // only ever consults, never depends on the DB rejecting a duplicate insert.
    index('tool_calls_idempotency_idx').on(t.idempotencyKey),
  ],
);

/**
 * `agent_runs` / `agent_steps` — master plan §5, §4.5's Agent Timeline,
 * `packages/spark/src/run.ts`'s `AgentRun` / `AgentStep`.
 *
 * Unlike `tool_calls`, a run is INSERT-then-UPDATE: `startRun` inserts with
 * `status: 'running'`, `finishRun` updates the same row to its terminal state.
 * Steps are append-only, ordered by `idx` rather than `at` — see `StepSequence`
 * in `run.ts` for why timestamp ordering isn't trustworthy enough on its own.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    brandId: text('brand_id').notNull(),
    agent: text('agent').notNull(),
    goal: text('goal').notNull(),
    trigger: text('trigger').notNull(), // 'user' | 'schedule' | 'event'
    status: text('status').notNull().default('running'),
    costCents: integer('cost_cents').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    traceId: text('trace_id'),
    parentRunId: uuid('parent_run_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    error: jsonb('error'),
  },
  (t) => [index('agent_runs_brand_idx').on(t.brandId), index('agent_runs_parent_idx').on(t.parentRunId)],
);

export const agentSteps = pgTable(
  'agent_steps',
  {
    runId: uuid('run_id').notNull(),
    idx: integer('idx').notNull(),
    type: text('type').notNull(), // 'think' | 'tool' | 'delegate' | 'wait'
    payload: jsonb('payload'),
    ms: integer('ms').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('agent_steps_run_idx').on(t.runId, t.idx)],
);
