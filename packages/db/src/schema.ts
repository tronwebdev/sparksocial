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
    platform: text('platform'),
    copy: jsonb('copy'),
    /** The Explanation payload — PRD §7.3, rendered by <WhyPopover />. */
    why: jsonb('why'),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('content_items_scope_idx').on(t.orgId, t.genomeId)],
);
