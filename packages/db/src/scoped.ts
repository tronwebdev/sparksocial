import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { ToolError, type AssetRole } from '@sparksocial/shared/types';
import { byId } from '@sparksocial/playbooks';
import { assets, assetFolders, campaigns, knowledgeChunks, memories, contentItems, contentMetrics, engagementMessages, renders, opportunities, trendWatchlist, influencerWatchlist, learningArms, learningOutcomes, recipes, recipeRuns, recipeOutputs, oauthConnections, contentLinks } from './schema.js';
import type { Database } from './client.js';

/**
 * GENOME ISOLATION.
 *
 * An agency runs many clients inside one workspace. A client's assets must never
 * surface in another client's generation — including via embedding retrieval, which
 * is the leak everyone forgets. Enforcement lives here, in the query layer.
 *
 * A UI filter is not isolation. A `where` clause someone remembered to add is not
 * isolation. **This module is the only place in the repo allowed to import
 * `assets` / `knowledgeChunks` / `memories` / `contentItems` from `schema.ts`** —
 * `test/isolation.test.ts` fails the build if any other file does, including the
 * repository files elsewhere in this package. That is deliberate: a repository
 * function that builds its own `and(eq(...), eq(...))` predicate ad hoc is exactly
 * the "a developer has to remember it" failure mode this file exists to close off.
 * Every scoped-table read or write in the codebase — including the ones that don't
 * look like a "query" (an INSERT, a role-grouped count) — is a function here.
 */

/** Tables that carry client-confidential material and must always be genome-scoped. */
const SCOPED_TABLES = {
  assets, assetFolders, knowledgeChunks, memories, contentItems, contentMetrics, engagementMessages, renders, opportunities,
  trendWatchlist, influencerWatchlist, learningArms, learningOutcomes, recipes, recipeRuns, recipeOutputs, oauthConnections, contentLinks,
} as const;
export type ScopedTable = keyof typeof SCOPED_TABLES;

export interface Scope {
  orgId: string;
  brandId: string;
  genomeId: string;
}

export const assertScope = (scope: Partial<Scope>): Scope => {
  if (!scope.orgId || !scope.brandId || !scope.genomeId) {
    throw new ToolError(
      'ISOLATION_VIOLATION',
      'A genome-scoped query was attempted without a complete scope.',
      { scope },
    );
  }
  return scope as Scope;
};

/** The mandatory predicate. Every scoped query is built on top of this. */
export const scopePredicate = (table: ScopedTable, scope: Scope): SQL => {
  const t = SCOPED_TABLES[table];
  return and(eq(t.orgId, scope.orgId), eq(t.genomeId, scope.genomeId))!;
};

export interface RetrieveArgs {
  intent: string;
  embedding: number[];
  requiredRoles?: string[];
  k?: number;
  /** Days since last use below which an asset is penalised, not excluded. */
  cooldownDays?: number;
}

/**
 * Intent-based asset retrieval for the Assemble pipeline.
 *
 * Ranking is deliberately not pure cosine similarity. Without the recency and
 * usage penalties the same three photos appear every week and the account reads
 * as automated — which is the specific failure this product exists to avoid.
 *
 * ── Why there is no ivfflat/hnsw index on `assets.embedding` ────────────────
 * Not an oversight, and adding one would not help. A pgvector ANN index can
 * only accelerate an `ORDER BY embedding <=> vec`; this query orders by
 * `similarity - recencyPenalty - diversityPenalty`, which is not the distance
 * operator, so the planner cannot use an ANN index for it under any
 * configuration. Postgres must evaluate the score per candidate row regardless.
 *
 * What keeps that affordable is the isolation predicate: every candidate set is
 * already narrowed to one genome's cleared assets by `assets_scope_idx` before
 * any distance is computed, so the scan is over one brand's library — hundreds
 * of rows — not the table. The scoping requirement and the performance story
 * are the same mechanism.
 *
 * The cliff, when it comes, is a single genome with a very large library. The
 * fix then is two-phase, not an index on this query: take top-K by raw distance
 * (which *can* use an ANN index) in a subquery, then apply the penalties and
 * re-rank the K rows. That trades exact recall for speed and should not be done
 * before there is a genome big enough to need it.
 */
export function buildRetrieveQuery(scope: Scope, args: RetrieveArgs) {
  assertScope(scope);
  const { embedding, requiredRoles, k = 8, cooldownDays = 21 } = args;
  const vec = sql`${JSON.stringify(embedding)}::vector`;

  const similarity = sql<number>`1 - (${assets.embedding} <=> ${vec})`;
  const recencyPenalty = sql<number>`
    CASE WHEN ${assets.lastUsedAt} IS NULL THEN 0
         ELSE GREATEST(0, 1 - (EXTRACT(EPOCH FROM (now() - ${assets.lastUsedAt})) / 86400.0)
                          / ${cooldownDays}) * 0.5
    END`;
  const diversityPenalty = sql<number>`LEAST(${assets.usageCount} * 0.03, 0.3)`;

  return {
    where: and(
      scopePredicate('assets', scope),          // ← non-negotiable
      eq(assets.rightsStatus, 'cleared'),
      // `inArray` binds each role as a parameter — no string-built SQL. An
      // earlier version spliced `requiredRoles` into an `ARRAY[...]` literal via
      // `sql.raw`; every current caller validates roles against the `AssetRole`
      // enum first, so it wasn't reachable, but a raw-string ARRAY literal is an
      // injection footgun waiting for a future caller that doesn't validate.
      requiredRoles?.length ? inArray(assets.assetRole, requiredRoles) : undefined,
    ),
    score: sql<number>`${similarity} - ${recencyPenalty} - ${diversityPenalty}`,
    limit: k,
  };
}

/**
 * Guard used by the isolation test. Any Drizzle query built outside this module
 * that touches a scoped table without the predicate will be caught by the static
 * check in test/isolation.test.ts — keep the table list above in sync.
 */
export const SCOPED_TABLE_NAMES = Object.keys(SCOPED_TABLES) as ScopedTable[];

// ---------------------------------------------------------------------------
// Executable repository functions — engine spec §4, §10.
//
// These run the actual query against `db`, rather than returning a fragment for
// a caller to assemble further. `assetRepository.ts` / `contentRepository.ts`
// are thin `ScopedDb`-shaped adapters over these; they never import `assets` or
// `contentItems` themselves.
// ---------------------------------------------------------------------------

/** §4: counts by asset_role for the genome — the resolver's availability input. */
export async function assetInventory(
  db: Database,
  scope: Scope,
): Promise<Partial<Record<AssetRole, number>>> {
  const rows = await db
    .select({ role: assets.assetRole, count: sql<number>`count(*)::int` })
    .from(assets)
    .where(and(scopePredicate('assets', scope), eq(assets.rightsStatus, 'cleared')))
    .groupBy(assets.assetRole);

  const out: Partial<Record<AssetRole, number>> = {};
  for (const r of rows) out[r.role as AssetRole] = r.count;
  return out;
}

/** §4.3: ranked retrieval, executing {@link buildRetrieveQuery}. */
export async function retrieveAssets(
  db: Database,
  scope: Scope,
  args: RetrieveArgs,
): Promise<
  Array<{
    assetId: string;
    role: AssetRole;
    caption: string | null;
    score: number;
    usageCount: number;
    lastUsedAt: Date | null;
    rightsStatus: string;
    url: string;
    mediaType: string;
    folderId: string | null;
  }>
> {
  const q = buildRetrieveQuery(scope, args);
  const rows = await db
    .select({
      assetId: assets.id,
      role: assets.assetRole,
      caption: assets.caption,
      score: q.score,
      usageCount: assets.usageCount,
      lastUsedAt: assets.lastUsedAt,
      rightsStatus: assets.rightsStatus,
      url: assets.storagePath,
      mediaType: assets.mediaType,
      folderId: assets.folderId,
    })
    .from(assets)
    .where(q.where)
    .orderBy(sql`${q.score} DESC`)
    .limit(q.limit);

  return rows.map((r) => ({ ...r, role: r.role as AssetRole }));
}

export interface CreateAssetArgs {
  url: string;
  assetRole: AssetRole;
  mediaType: 'image' | 'video' | 'audio';
  rightsStatus: 'cleared' | 'pending' | 'restricted';
  caption: string;
  embedding: number[];
  source: string;
}

/** §4.1: the only way a new asset enters the graph. */
export async function createAsset(db: Database, scope: Scope, args: CreateAssetArgs): Promise<{ id: string }> {
  assertScope(scope);
  const [row] = await db
    .insert(assets)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      mediaType: args.mediaType,
      assetRole: args.assetRole,
      storagePath: args.url,
      caption: args.caption,
      embedding: args.embedding,
      rightsStatus: args.rightsStatus,
      source: args.source,
    })
    .returning({ id: assets.id });
  return row!;
}

/** Concatenatable grounding text for `guard.claim_grounding` (§10). */
export async function assetCaptionsByRole(db: Database, scope: Scope, roles: AssetRole[]): Promise<string[]> {
  const rows = await db
    .select({ caption: assets.caption })
    .from(assets)
    .where(and(scopePredicate('assets', scope), inArray(assets.assetRole, roles)));
  return rows.map((r) => r.caption).filter((c): c is string => c !== null);
}

/** Rights + reuse-cooldown lookup for `guard.rights` / `guard.duplicate` (§10). */
export async function assetInfo(
  db: Database,
  scope: Scope,
  ids: string[],
): Promise<Record<string, { rightsStatus: string; lastUsedDaysAgo?: number; url: string; mediaType: string }>> {
  if (ids.length === 0) return {};
  const now = Date.now();
  const rows = await db
    .select({
      id: assets.id,
      rightsStatus: assets.rightsStatus,
      lastUsedAt: assets.lastUsedAt,
      url: assets.storagePath,
      mediaType: assets.mediaType,
    })
    .from(assets)
    .where(and(scopePredicate('assets', scope), inArray(assets.id, ids)));

  const out: Record<string, { rightsStatus: string; lastUsedDaysAgo?: number; url: string; mediaType: string }> = {};
  for (const r of rows) {
    out[r.id] = {
      rightsStatus: r.rightsStatus,
      lastUsedDaysAgo: r.lastUsedAt ? (now - r.lastUsedAt.getTime()) / 86_400_000 : undefined,
      url: r.url,
      mediaType: r.mediaType,
    };
  }
  return out;
}

/**
 * `asset.rights.set` — the only writer of `rights_status` after ingest time.
 * Retrieval (`retrieveAssets`) only ever returns `'cleared'` rows, so this is
 * the one lever that turns a `'pending'`/`'restricted'` upload into something
 * the resolver can actually use, or pulls a `'cleared'` one back out of
 * rotation if a rights concern surfaces later.
 */
export async function setAssetRights(
  db: Database,
  scope: Scope,
  args: { id: string; rightsStatus: 'cleared' | 'pending' | 'restricted' },
): Promise<AssetRightsRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(assets)
    .set({ rightsStatus: args.rightsStatus })
    .where(and(eq(assets.id, args.id), scopePredicate('assets', scope)))
    .returning({ id: assets.id, rightsStatus: assets.rightsStatus });
  return row;
}

export interface AssetRightsRow {
  id: string;
  rightsStatus: string;
}

/**
 * `asset.reuse` — the only writer of `usage_count`/`last_used_at`. Without
 * this, both columns sit at their insert-time defaults forever: `retrieveAssets`'s
 * recency/usage penalty (this file, `buildRetrieveQuery`) and `guard.duplicate`'s
 * reuse-cooldown check (`packages/guardrails/src/duplicate.ts`) both read these
 * columns but nothing was ever calling this to make them mean anything. Also
 * called automatically by `publish.now` on every `referencedAssetIds` entry —
 * see that tool's own comment — so a human never has to remember to call this
 * by hand for the common path; it exists standalone for uses outside publish
 * (Assemble renders, manual reservation).
 */
export async function recordAssetUsage(db: Database, scope: Scope, args: { id: string }): Promise<AssetUsageRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(assets)
    .set({ usageCount: sql`${assets.usageCount} + 1`, lastUsedAt: sql`now()` })
    .where(and(eq(assets.id, args.id), scopePredicate('assets', scope)))
    .returning({ id: assets.id, usageCount: assets.usageCount, lastUsedAt: assets.lastUsedAt });
  return row;
}

export interface AssetUsageRow {
  id: string;
  usageCount: number;
  lastUsedAt: Date | null;
}

export interface AssetFolderRow {
  id: string;
  genomeId: string;
  name: string;
  createdAt: Date;
  /**
   * How many assets sit in this folder. PRD §8.11's `LIB-01` asks the folder
   * list for exactly this ("list with created date/count"), and it is not
   * derivable client-side: `asset.retrieve` is semantic and returns the top-k
   * matches, so counting what it happens to return would report a ranking
   * cutoff as a folder size.
   */
  assetCount: number;
}

/** `asset.folder.create` — see the table's own comment on `assets.folderId`'s history. */
export async function createAssetFolder(db: Database, scope: Scope, args: { name: string }): Promise<AssetFolderRow> {
  assertScope(scope);
  const [row] = await db
    .insert(assetFolders)
    .values({ orgId: scope.orgId, genomeId: scope.genomeId, name: args.name })
    .returning({ id: assetFolders.id, genomeId: assetFolders.genomeId, name: assetFolders.name, createdAt: assetFolders.createdAt });
  // A folder that was created one statement ago holds nothing; no count query
  // needed to know that.
  return { ...row!, assetCount: 0 };
}

export async function listAssetFolders(db: Database, scope: Scope): Promise<AssetFolderRow[]> {
  // Left join, so an empty folder still appears with a count of zero — the
  // empty ones are precisely the ones somebody needs to see.
  const rows = await db
    .select({
      id: assetFolders.id,
      genomeId: assetFolders.genomeId,
      name: assetFolders.name,
      createdAt: assetFolders.createdAt,
      assetCount: sql<number>`count(${assets.id})::int`,
    })
    .from(assetFolders)
    .leftJoin(assets, and(eq(assets.folderId, assetFolders.id), eq(assets.orgId, assetFolders.orgId)))
    .where(scopePredicate('assetFolders', scope))
    .groupBy(assetFolders.id, assetFolders.genomeId, assetFolders.name, assetFolders.createdAt)
    .orderBy(assetFolders.name);
  return rows.map((r) => ({ ...r, assetCount: Number(r.assetCount) }));
}

export interface ContentLinkRow {
  id: string;
  genomeId: string;
  contentItemId: string;
  dubLinkId: string;
  shortUrl: string;
  destinationUrl: string;
  createdAt: Date;
}

const contentLinkColumns = {
  id: contentLinks.id,
  genomeId: contentLinks.genomeId,
  contentItemId: contentLinks.contentItemId,
  dubLinkId: contentLinks.dubLinkId,
  shortUrl: contentLinks.shortUrl,
  destinationUrl: contentLinks.destinationUrl,
  createdAt: contentLinks.createdAt,
};

/** `link.shorten`'s attribution write, when called with a `contentItemId` — see the table's own comment. */
export async function createContentLink(
  db: Database,
  scope: Scope,
  args: { contentItemId: string; dubLinkId: string; shortUrl: string; destinationUrl: string },
): Promise<ContentLinkRow> {
  assertScope(scope);
  const [row] = await db
    .insert(contentLinks)
    .values({ orgId: scope.orgId, genomeId: scope.genomeId, ...args })
    .returning(contentLinkColumns);
  return row!;
}

/** `analytics.cta_traffic`'s read — every link attached to any of these content items, this genome only. */
export async function listContentLinksForItems(db: Database, scope: Scope, contentItemIds: string[]): Promise<ContentLinkRow[]> {
  if (contentItemIds.length === 0) return [];
  return db
    .select(contentLinkColumns)
    .from(contentLinks)
    .where(and(scopePredicate('contentLinks', scope), inArray(contentLinks.contentItemId, contentItemIds)));
}

/**
 * `asset.folder.move` — `folderId: null` moves an asset back out of any
 * folder. A non-null id is verified against `asset_folders` in the same
 * scope first: without that check, an asset could be pointed at a folder id
 * from a completely different genome, since `assets.folderId` carries no
 * foreign-key constraint of its own (folders didn't exist as a real table
 * until this function did).
 */
export async function moveAssetToFolder(
  db: Database,
  scope: Scope,
  args: { assetId: string; folderId: string | null },
): Promise<{ id: string; folderId: string | null } | undefined> {
  assertScope(scope);
  if (args.folderId) {
    const [folder] = await db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(and(eq(assetFolders.id, args.folderId), scopePredicate('assetFolders', scope)))
      .limit(1);
    if (!folder) return undefined;
  }
  const [row] = await db
    .update(assets)
    .set({ folderId: args.folderId })
    .where(and(eq(assets.id, args.assetId), scopePredicate('assets', scope)))
    .returning({ id: assets.id, folderId: assets.folderId });
  return row;
}

/**
 * §10: the guardrail layer's only reader of publishing history. `isAvatarFormat`
 * is derived from the playbook's own `requires_likeness_license` precondition
 * rather than a stored column — the playbook record is the single source of
 * truth for what a format requires (§5.1), and a stored boolean would drift the
 * moment a playbook's precondition changed without a backfill nobody would
 * remember to run.
 */
export async function recentContent(
  db: Database,
  scope: Scope,
  windowDays: number,
): Promise<Array<{ isAvatarFormat: boolean; embedding: number[] | null }>> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({ playbookId: contentItems.playbookId, embedding: contentItems.embedding })
    .from(contentItems)
    .where(
      and(
        scopePredicate('contentItems', scope),
        eq(contentItems.status, 'published'),
        gte(contentItems.publishedAt, cutoff),
      ),
    );

  return rows.map((r) => ({
    isAvatarFormat: r.playbookId ? (byId(r.playbookId)?.preconditions.requires_likeness_license ?? false) : false,
    embedding: r.embedding,
  }));
}

/**
 * Marks a content item published, with its copy's embedding — the write side
 * of {@link recentContent} and the only writer of `platform`/`external_id`/
 * `publish_via`/`publish_url`. Called once, by `publish.now`'s handler.
 */
export async function markContentPublished(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: {
    id: string;
    platform: string;
    embedding: number[];
    externalId: string;
    via: string;
    url?: string;
    publishedAt?: Date;
  },
): Promise<void> {
  await db
    .update(contentItems)
    .set({
      status: 'published',
      publishedAt: args.publishedAt ?? new Date(),
      embedding: args.embedding,
      platform: args.platform,
      externalId: args.externalId,
      publishVia: args.via,
      ...(args.url ? { publishUrl: args.url } : {}),
    })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

/**
 * `publish.rollback`'s write. Deliberately not a reset to `'draft'` — see
 * `ContentStore.markRolledBack`'s doc comment for why a rolled-back post
 * keeps its publish receipt rather than looking like it was never live.
 */
export async function markContentRolledBack(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string },
): Promise<void> {
  await db
    .update(contentItems)
    .set({ status: 'rolled_back' })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

/**
 * The scheduler's write when a due item's `publish.now` call comes back
 * `GUARDRAIL_BLOCKED` — see `ContentStore.markBlocked`'s own comment for why
 * this is a distinct status from `'scheduled'` rather than a log line. Scoped
 * like `markContentPublished`/`markContentRolledBack` (orgId only): by the
 * time this is called the row is already resolved by id.
 */
export async function markContentBlocked(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string; reason: string },
): Promise<void> {
  await db
    .update(contentItems)
    .set({ status: 'blocked', blockedReason: args.reason })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

/**
 * One failed publish attempt, counted — PRD §10's retry flow needs an end.
 *
 * `publish_attempts + 1` in SQL rather than read-modify-write: two scheduler
 * ticks racing the same row would otherwise both read 3 and both write 4, and a
 * ceiling that can be undercounted is a ceiling that can be walked past.
 *
 * Deliberately does not change `status`. The item stays `scheduled` and stays
 * retryable; whether the count has reached a ceiling is the scheduler's
 * decision, and mixing the two here would put a retry policy in the storage
 * layer.
 */
export async function recordContentPublishFailure(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string; error: string },
): Promise<{ attempts: number }> {
  const [row] = await db
    .update(contentItems)
    .set({
      publishAttempts: sql`${contentItems.publishAttempts} + 1`,
      lastPublishError: args.error.slice(0, 2000),
    })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)))
    .returning({ attempts: contentItems.publishAttempts });

  // A row that no longer exists (or belongs to another org) reports zero rather
  // than throwing: the caller is a clock reacting to a failure it has already
  // logged, and a second error there would replace a useful message with a
  // useless one.
  return { attempts: row?.attempts ?? 0 };
}

/**
 * PRD §7.4's `Needs Review` state — see `ContentStore.markNeedsReview`.
 *
 * Reuses `blockedReason` for the held-reason rather than adding a second column:
 * both answer the one question a person opening a stalled item asks, and one
 * column with one meaning ("why is this not moving") beats two that have to be
 * checked in the right order.
 */
export async function markContentNeedsReview(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string; reason: string },
): Promise<void> {
  await db
    .update(contentItems)
    .set({ status: 'needs_review', blockedReason: args.reason })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

/** PRD §7.4's `Approved` state — see `ContentStore.markApproved`. */
export async function markContentApproved(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string },
): Promise<void> {
  await db
    .update(contentItems)
    // Clears the held-reason: it described a wait that is over.
    .set({ status: 'approved', blockedReason: null })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

/** PRD §7.4: a rejected item is editable again — see `ContentStore.markRejected`. */
export async function markContentRejected(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string; reason: string },
): Promise<void> {
  await db
    .update(contentItems)
    // Back to `draft`, with the reason kept so whoever picks it up knows what
    // to change. `scheduledAt` is left alone: the date was not the objection.
    .set({ status: 'draft', blockedReason: args.reason })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

export interface RenderRow {
  id: string;
  contentItemId: string;
  aspect: string;
  storageUrl: string;
  engine: string;
  costCents: number;
  createdAt: Date;
}

/** Write side of `compose.render` — one row per aspect ratio rendered. */
export async function recordRender(
  db: Database,
  scope: Scope,
  args: { contentItemId: string; aspect: string; storageUrl: string; engine: string; costCents: number },
): Promise<RenderRow> {
  const [row] = await db
    .insert(renders)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      contentItemId: args.contentItemId,
      aspect: args.aspect,
      storageUrl: args.storageUrl,
      engine: args.engine,
      costCents: args.costCents,
    })
    .returning();
  if (!row) throw new ToolError('UPSTREAM_FAILED', 'Failed to record the render.', { contentItemId: args.contentItemId });
  return row;
}

/** Every render already produced for a content item — `compose.render`'s own "already done?" check, and the Draft Panel's render list. */
export async function listRenders(db: Database, scope: Scope, contentItemId: string): Promise<RenderRow[]> {
  return db
    .select()
    .from(renders)
    .where(and(scopePredicate('renders', scope), eq(renders.contentItemId, contentItemId)))
    .orderBy(desc(renders.createdAt));
}

export interface ContentMetricsRow {
  id: string;
  contentItemId: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  impressions: number;
  saves: number;
  raw: unknown;
  syncedAt: Date;
}

const contentMetricsColumns = {
  id: contentMetrics.id,
  contentItemId: contentMetrics.contentItemId,
  platform: contentMetrics.platform,
  likes: contentMetrics.likes,
  comments: contentMetrics.comments,
  shares: contentMetrics.shares,
  views: contentMetrics.views,
  impressions: contentMetrics.impressions,
  saves: contentMetrics.saves,
  raw: contentMetrics.raw,
  syncedAt: contentMetrics.syncedAt,
};

/**
 * `analytics.sync`'s one write — an upsert keyed on `(content_item_id,
 * platform)` (`content_metrics_item_platform_idx`), because a sync reports
 * "what the platform says right now", not a new historical event. Re-syncing
 * the same post just refreshes the row.
 */
export async function upsertContentMetrics(
  db: Database,
  scope: Scope,
  args: {
    contentItemId: string;
    platform: string;
    likes: number;
    comments: number;
    shares: number;
    views: number;
    impressions: number;
    saves: number;
    raw: unknown;
    syncedAt?: Date;
  },
): Promise<ContentMetricsRow> {
  assertScope(scope);
  const [row] = await db
    .insert(contentMetrics)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      contentItemId: args.contentItemId,
      platform: args.platform,
      likes: args.likes,
      comments: args.comments,
      shares: args.shares,
      views: args.views,
      impressions: args.impressions,
      saves: args.saves,
      raw: args.raw as object,
      syncedAt: args.syncedAt ?? new Date(),
    })
    .onConflictDoUpdate({
      target: [contentMetrics.contentItemId, contentMetrics.platform],
      set: {
        likes: args.likes,
        comments: args.comments,
        shares: args.shares,
        views: args.views,
        impressions: args.impressions,
      saves: args.saves,
        raw: args.raw as object,
        syncedAt: args.syncedAt ?? new Date(),
      },
    })
    .returning(contentMetricsColumns);
  return row!;
}

/** Every platform's latest snapshot for one post — `analytics.post_metrics`'s future read, and `analytics.sync`'s own output. */
export async function getContentMetrics(
  db: Database,
  scope: Scope,
  contentItemId: string,
): Promise<ContentMetricsRow[]> {
  return db
    .select(contentMetricsColumns)
    .from(contentMetrics)
    .where(and(scopePredicate('contentMetrics', scope), eq(contentMetrics.contentItemId, contentItemId)));
}

/**
 * Every platform's latest snapshot across a set of posts — `campaign.report_vs_outcome`'s
 * roll-up. `inArray` rather than N calls to {@link getContentMetrics}: a
 * campaign can hold dozens of slots, and this is one query either way.
 */
export async function getContentMetricsForItems(
  db: Database,
  scope: Scope,
  contentItemIds: string[],
): Promise<ContentMetricsRow[]> {
  if (contentItemIds.length === 0) return [];
  return db
    .select(contentMetricsColumns)
    .from(contentMetrics)
    .where(and(scopePredicate('contentMetrics', scope), inArray(contentMetrics.contentItemId, contentItemIds)));
}

export interface EngagementMessageRow {
  /** When it stopped needing attention — PRD §5's "Reply SLA" endpoint. */
  resolvedAt: Date | null;
  id: string;
  genomeId: string;
  platform: string;
  externalId: string;
  kind: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  contentItemId: string | null;
  receivedAt: Date;
  status: string;
  category: string | null;
  intentScore: number | null;
  suggestedReply: string | null;
  why: unknown;
  /** `ENG-02.4`'s conversation key. Null on rows written before threading existed. */
  threadKey: string | null;
  /** What we sent back, and when — the outbound half of a thread. */
  sentReply: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

const engagementMessageColumns = {
  id: engagementMessages.id,
  genomeId: engagementMessages.genomeId,
  platform: engagementMessages.platform,
  externalId: engagementMessages.externalId,
  kind: engagementMessages.kind,
  authorHandle: engagementMessages.authorHandle,
  authorName: engagementMessages.authorName,
  text: engagementMessages.text,
  contentItemId: engagementMessages.contentItemId,
  receivedAt: engagementMessages.receivedAt,
  status: engagementMessages.status,
  category: engagementMessages.category,
  intentScore: engagementMessages.intentScore,
  resolvedAt: engagementMessages.resolvedAt,
  suggestedReply: engagementMessages.suggestedReply,
  why: engagementMessages.why,
  threadKey: engagementMessages.threadKey,
  sentReply: engagementMessages.sentReply,
  sentAt: engagementMessages.sentAt,
  createdAt: engagementMessages.createdAt,
};

/**
 * `engage.ingest`'s one write — an upsert keyed on
 * `(org_id, genome_id, platform, external_id)` (`engagement_messages_external_idx`),
 * because inbound delivery from every platform is at-least-once: a webhook
 * retry must land the same feed row, not a duplicate.
 */
export async function ingestEngagementMessage(
  db: Database,
  scope: Scope,
  args: {
    platform: string;
    externalId: string;
    kind: string;
    authorHandle: string;
    authorName?: string;
    text: string;
    contentItemId?: string;
    receivedAt?: Date;
    /** Derived by the caller (`engage.ingest`) so the rule lives in one place. */
    threadKey?: string;
  },
): Promise<EngagementMessageRow> {
  assertScope(scope);
  const values = {
    orgId: scope.orgId,
    genomeId: scope.genomeId,
    platform: args.platform,
    externalId: args.externalId,
    kind: args.kind,
    authorHandle: args.authorHandle,
    authorName: args.authorName ?? null,
    text: args.text,
    contentItemId: args.contentItemId ?? null,
    receivedAt: args.receivedAt ?? new Date(),
    threadKey: args.threadKey ?? null,
  };
  const [row] = await db
    .insert(engagementMessages)
    .values(values)
    .onConflictDoUpdate({
      target: [engagementMessages.orgId, engagementMessages.genomeId, engagementMessages.platform, engagementMessages.externalId],
      // Only the delivery-side fields refresh on a retried webhook. A
      // classification already sitting on this row (status/category/etc.)
      // must not be clobbered back to "new" by the platform redelivering
      // the same comment.
      // `threadKey` refreshes with the delivery fields, unlike the
      // classification: a platform that starts supplying a real conversation id
      // should correct a derived one, and a redelivery is the moment it would.
      set: { text: values.text, authorName: values.authorName, threadKey: values.threadKey },
    })
    .returning(engagementMessageColumns);
  return row!;
}

/** Read side of {@link ingestEngagementMessage} — one row, scoped. */
export async function getEngagementMessage(
  db: Database,
  scope: Scope,
  id: string,
): Promise<EngagementMessageRow | undefined> {
  const [row] = await db
    .select(engagementMessageColumns)
    .from(engagementMessages)
    .where(and(eq(engagementMessages.id, id), scopePredicate('engagementMessages', scope)))
    .limit(1);
  return row;
}

/** `engage.classify`'s write — the triage decision that sorts a message into the feed's tabs. */
export async function classifyEngagementMessage(
  db: Database,
  scope: Scope,
  args: {
    id: string;
    category: string;
    intentScore: number;
    suggestedReply?: string;
    why: unknown;
  },
): Promise<EngagementMessageRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(engagementMessages)
    .set({
      status: 'classified',
      category: args.category,
      intentScore: args.intentScore,
      suggestedReply: args.suggestedReply ?? null,
      why: args.why as object,
    })
    .where(and(eq(engagementMessages.id, args.id), scopePredicate('engagementMessages', scope)))
    .returning(engagementMessageColumns);
  return row;
}

/** `engage.reply.send`'s write — flips `status` to `replied` once delivery succeeds. */
export async function markEngagementMessageReplied(
  db: Database,
  scope: Scope,
  args: { id: string; sentReply?: string },
): Promise<EngagementMessageRow | undefined> {
  assertScope(scope);
  const now = new Date();
  const [row] = await db
    .update(engagementMessages)
    // `resolvedAt` is the second endpoint PRD §5's "Reply SLA" is defined
    // as an interval over. Set wherever a message stops needing attention.
    //
    // `sentReply` is optional because the send already happened by the time
    // this runs: a caller that cannot supply the text must still be able to
    // record that the message was answered rather than leaving it open.
    .set({ status: 'replied', resolvedAt: now, ...(args.sentReply ? { sentReply: args.sentReply, sentAt: now } : {}) })
    .where(and(eq(engagementMessages.id, args.id), scopePredicate('engagementMessages', scope)))
    .returning(engagementMessageColumns);
  return row;
}

/** `engage.autohandle`'s write — flips `status` to `auto_handled` once the unattended send succeeds. */
export async function markEngagementMessageAutoHandled(
  db: Database,
  scope: Scope,
  args: { id: string; sentReply?: string },
): Promise<EngagementMessageRow | undefined> {
  assertScope(scope);
  const now = new Date();
  const [row] = await db
    .update(engagementMessages)
    // `resolvedAt` is the second endpoint PRD §5's "Reply SLA" is defined
    // as an interval over. Set wherever a message stops needing attention.
    .set({ status: 'auto_handled', resolvedAt: now, ...(args.sentReply ? { sentReply: args.sentReply, sentAt: now } : {}) })
    .where(and(eq(engagementMessages.id, args.id), scopePredicate('engagementMessages', scope)))
    .returning(engagementMessageColumns);
  return row;
}

/**
 * One conversation, oldest first — `engage.thread`'s read (`ENG-02.4`).
 *
 * Ascending, unlike every other engagement read in this file. The feed answers
 * "what is new" and sorts newest-first for it; a transcript is read downward,
 * and reversing it in the client would put the ordering rule somewhere a second
 * caller could get wrong.
 *
 * Scoped like the rest. A thread key is not a capability: it identifies a
 * conversation *within* a genome, and two genomes could hold the same derived
 * key for the same public commenter on their respective posts.
 */
export async function threadEngagementMessages(
  db: Database,
  scope: Scope,
  args: { threadKey: string; limit: number },
): Promise<EngagementMessageRow[]> {
  return db
    .select(engagementMessageColumns)
    .from(engagementMessages)
    .where(and(scopePredicate('engagementMessages', scope), eq(engagementMessages.threadKey, args.threadKey)))
    .orderBy(asc(engagementMessages.receivedAt))
    .limit(args.limit);
}

/**
 * `engage.escalate`'s write, and `engage.takeover`'s — flips `status` to
 * `escalated`. Shared rather than split into two statuses: see
 * `packages/engage/src/takeover.ts`'s own comment for why.
 */
export async function markEngagementMessageEscalated(
  db: Database,
  scope: Scope,
  args: { id: string },
): Promise<EngagementMessageRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(engagementMessages)
    // `resolvedAt` is the second endpoint PRD §5's "Reply SLA" is defined
    // as an interval over. Set wherever a message stops needing attention.
    .set({ status: 'escalated', resolvedAt: new Date() })
    .where(and(eq(engagementMessages.id, args.id), scopePredicate('engagementMessages', scope)))
    .returning(engagementMessageColumns);
  return row;
}

/**
 * `engage.list`'s read — the inbox feed's source (`ENG-02`'s four tabs),
 * newest first. Backed by `engagement_messages_feed_idx` on
 * `(org_id, genome_id, status, receivedAt desc)`; `category` isn't part of
 * that index (it's nullable and only meaningful post-classification) so it's
 * applied as a plain equality filter alongside it rather than assumed to be
 * index-covered.
 */
export async function listEngagementMessages(
  db: Database,
  scope: Scope,
  args: { status?: string; category?: string; limit: number },
): Promise<EngagementMessageRow[]> {
  return db
    .select(engagementMessageColumns)
    .from(engagementMessages)
    .where(
      and(
        scopePredicate('engagementMessages', scope),
        args.status ? eq(engagementMessages.status, args.status) : undefined,
        args.category ? eq(engagementMessages.category, args.category) : undefined,
      ),
    )
    .orderBy(desc(engagementMessages.receivedAt))
    .limit(args.limit);
}

/**
 * `engage.audit.query`'s read — every resolved engagement action (i.e. not
 * `new`/`classified`) within a range, newest first. Deliberately its own
 * query rather than a call to `listEngagementMessages` with a status filter:
 * that function takes one `status`, and this one matches a fixed set of
 * five, plus an optional time range `engage.list` has no use for.
 */
export async function auditEngagementMessages(
  db: Database,
  scope: Scope,
  args: { statuses: string[]; since?: Date; until?: Date; limit: number },
): Promise<EngagementMessageRow[]> {
  return db
    .select(engagementMessageColumns)
    .from(engagementMessages)
    .where(
      and(
        scopePredicate('engagementMessages', scope),
        inArray(engagementMessages.status, args.statuses),
        args.since ? gte(engagementMessages.receivedAt, args.since) : undefined,
        args.until ? lte(engagementMessages.receivedAt, args.until) : undefined,
      ),
    )
    .orderBy(desc(engagementMessages.receivedAt))
    .limit(args.limit);
}

export interface OpportunityRow {
  id: string;
  genomeId: string;
  inboxItemId: string;
  temperature: string;
  recommendedAction: string;
  routedTo: string | null;
  createdAt: Date;
}

const opportunityColumns = {
  id: opportunities.id,
  genomeId: opportunities.genomeId,
  inboxItemId: opportunities.inboxItemId,
  temperature: opportunities.temperature,
  recommendedAction: opportunities.recommendedAction,
  routedTo: opportunities.routedTo,
  createdAt: opportunities.createdAt,
};

/** `engage.opportunity.create`'s write — one row per call, never an upsert: raising the same lead twice is two real leads. */
export async function createOpportunity(
  db: Database,
  scope: Scope,
  args: { inboxItemId: string; temperature: string; recommendedAction: string },
): Promise<OpportunityRow> {
  assertScope(scope);
  const [row] = await db
    .insert(opportunities)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      inboxItemId: args.inboxItemId,
      temperature: args.temperature,
      recommendedAction: args.recommendedAction,
    })
    .returning(opportunityColumns);
  if (!row) throw new ToolError('UPSTREAM_FAILED', 'Failed to create the opportunity.', { inboxItemId: args.inboxItemId });
  return row;
}

/** Read side of {@link createOpportunity} — one row, scoped. `engage.opportunity.route`'s own "does this exist?" check. */
export async function getOpportunity(db: Database, scope: Scope, id: string): Promise<OpportunityRow | undefined> {
  const [row] = await db
    .select(opportunityColumns)
    .from(opportunities)
    .where(and(eq(opportunities.id, id), scopePredicate('opportunities', scope)))
    .limit(1);
  return row;
}

/** `engage.opportunity.route`'s write — updates `routed_to` on an existing row. */
export async function routeOpportunity(
  db: Database,
  scope: Scope,
  args: { id: string; routedTo: string },
): Promise<OpportunityRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(opportunities)
    .set({ routedTo: args.routedTo })
    .where(and(eq(opportunities.id, args.id), scopePredicate('opportunities', scope)))
    .returning(opportunityColumns);
  return row;
}

export interface ContentDraftRow {
  /** Set by `markPublished`. PRD §5's "time to first post" measures from here. */
  publishedAt: Date | null;
  id: string;
  genomeId: string;
  campaignId: string | null;
  playbookId: string | null;
  mode: string | null;
  pillar: string | null;
  status: string;
  platform: string | null;
  externalId: string | null;
  publishVia: string | null;
  publishUrl: string | null;
  blockedReason: string | null;
  /** §10's retry state — see `recordContentPublishFailure`. */
  publishAttempts: number;
  lastPublishError: string | null;
  copy: unknown;
  why: unknown;
  scheduledAt: Date | null;
  createdAt: Date;
}

const contentDraftColumns = {
  id: contentItems.id,
  genomeId: contentItems.genomeId,
  campaignId: contentItems.campaignId,
  playbookId: contentItems.playbookId,
  mode: contentItems.mode,
  pillar: contentItems.pillar,
  status: contentItems.status,
  platform: contentItems.platform,
  externalId: contentItems.externalId,
  publishVia: contentItems.publishVia,
  publishUrl: contentItems.publishUrl,
  blockedReason: contentItems.blockedReason,
  // §10's retry flow: a stalled item has to be able to explain how many times
  // it has been tried and what happened, or the only record is a console line.
  publishAttempts: contentItems.publishAttempts,
  lastPublishError: contentItems.lastPublishError,
  copy: contentItems.copy,
  why: contentItems.why,
  scheduledAt: contentItems.scheduledAt,
  // PRD §5's "time to first post" measures from campaign start to here, so the
  // projection has to carry it — the column existed and was never selected.
  publishedAt: contentItems.publishedAt,
  createdAt: contentItems.createdAt,
};

/**
 * A brand-new draft — `content.draft`'s ad-hoc path (CC-02), where no
 * calendar slot exists yet. `status` starts at the column default ('draft')
 * rather than being passed in: this function only ever creates drafts, never
 * scheduled or published rows — those come from {@link replaceCampaignSlots}
 * and {@link markContentPublished} respectively.
 */
export async function createContentDraft(
  db: Database,
  scope: Scope,
  args: {
    playbookId: string;
    mode: string;
    pillar?: string;
    copy: unknown;
    why: unknown;
    campaignId?: string;
    recipeId?: string;
    intent?: string;
    sourceTrendId?: string;
    scheduledAt?: Date;
  },
): Promise<ContentDraftRow> {
  assertScope(scope);
  const [row] = await db
    .insert(contentItems)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      playbookId: args.playbookId,
      mode: args.mode,
      ...(args.pillar ? { pillar: args.pillar } : {}),
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
      ...(args.recipeId ? { recipeId: args.recipeId } : {}),
      ...(args.intent ? { intent: args.intent } : {}),
      ...(args.sourceTrendId ? { sourceTrendId: args.sourceTrendId } : {}),
      // A row created with a date is created scheduled; the column default
      // (`draft`) is right for everything else.
      ...(args.scheduledAt ? { scheduledAt: args.scheduledAt, status: 'scheduled' } : {}),
      copy: args.copy as object,
      why: args.why as object,
    })
    .returning(contentDraftColumns);
  return row!;
}

/** Read side of {@link createContentDraft}/{@link updateContentDraft} — one row, scoped. */
export async function getContentItem(db: Database, scope: Scope, id: string): Promise<ContentDraftRow | undefined> {
  const [row] = await db
    .select(contentDraftColumns)
    .from(contentItems)
    .where(and(eq(contentItems.id, id), scopePredicate('contentItems', scope)))
    .limit(1);
  return row;
}

/**
 * Fills in a slot `calendar.generate` already created, or re-fills one
 * `content.draft` created earlier (regeneration is the normal path — a user
 * asks for another take on the same copy). Excludes published rows for the
 * same reason {@link replaceCampaignSlots}'s delete does: a published post is
 * a fact about the world, and no amount of re-drafting may rewrite it.
 */
export async function updateContentDraft(
  db: Database,
  scope: Scope,
  args: { id: string; copy: unknown; why: unknown },
): Promise<ContentDraftRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(contentItems)
    .set({ copy: args.copy as object, why: args.why as object })
    .where(
      and(
        eq(contentItems.id, args.id),
        scopePredicate('contentItems', scope),
        ne(contentItems.status, 'published'),
      ),
    )
    .returning(contentDraftColumns);
  return row;
}

/**
 * Places (or moves) a content item on the calendar — `CAL-04`'s "create post
 * for date" and `CAL-05`'s drag-and-drop reschedule are the same write: set
 * `scheduledAt`, mark it `scheduled`. Same published-row guard as
 * {@link updateContentDraft}, for the same reason.
 */
export async function scheduleContentItem(
  db: Database,
  scope: Scope,
  args: { id: string; scheduledAt: Date },
): Promise<ContentDraftRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(contentItems)
    .set({
      scheduledAt: args.scheduledAt,
      status: 'scheduled',
      // Rescheduling is a person saying "try this again". Carrying the old
      // attempt count forward would mean an item that hit the ceiling once
      // could never be given a second chance without editing the database.
      publishAttempts: 0,
      lastPublishError: null,
    })
    .where(
      and(
        eq(contentItems.id, args.id),
        scopePredicate('contentItems', scope),
        ne(contentItems.status, 'published'),
      ),
    )
    .returning(contentDraftColumns);
  return row;
}

/**
 * Every content item for a genome, newest first — the Draft List's (CC-03)
 * source. Deliberately genome-wide rather than per-campaign: `content.draft`'s
 * ad-hoc path (CC-02's "one brief → draft pack") creates rows with no
 * `campaignId` at all, and a list scoped to one campaign would never surface
 * them. `campaignSlots` stays the campaign-scoped read `calendar.get` uses;
 * this is the other one, for "everything this brand has in flight".
 */
export async function listContentForGenome(
  db: Database,
  scope: Scope,
  args: { status?: string; limit: number },
): Promise<ContentDraftRow[]> {
  return db
    .select(contentDraftColumns)
    .from(contentItems)
    .where(
      and(
        scopePredicate('contentItems', scope),
        args.status ? eq(contentItems.status, args.status) : undefined,
      ),
    )
    .orderBy(desc(contentItems.createdAt))
    .limit(args.limit);
}

/**
 * Every `scheduled` content item due by `before`, across every tenant.
 *
 * The one deliberate exception to this file's own rule. Every other function
 * here takes a `Scope` because it runs on behalf of *one* caller acting for
 * one tenant, and the isolation predicate is what stops that caller reaching
 * another's rows. A scheduler is not that caller — it is the system itself,
 * looking for whatever is due the same way a cron process reads a queue
 * table, and it must see across every tenant to do its job at all. No tool
 * exposes this: `apps/api/src/scheduler.ts` is its only caller, and it builds
 * a fresh, correctly-scoped `Scope` *per row* before doing anything with what
 * this returns — the isolation boundary moves from "this query" to "every
 * write this query's caller makes downstream", which is exactly the boundary
 * `publish.now` and everything upstream of it already enforces.
 */
export interface DueContentItem {
  id: string;
  orgId: string;
  genomeId: string;
  playbookId: string | null;
  platform: string | null;
  copy: unknown;
  /** The brief, for a slot the scheduler has to draft before it can publish it. */
  intent: string | null;
  scheduledAt: Date;
}

/**
 * `ContentStore.publishOrigin` — did a recipe make this, and does that recipe
 * want its output reviewed?
 *
 * One join rather than two reads, because `policy.ts` runs this on the critical
 * path of every publish. `reviewBeforePublish` is read out of the recipe's own
 * `config` jsonb (`RecipeCommonConfig`), and defaults to `true` for a config
 * that cannot be parsed — an unreadable recipe config is the one case where
 * "send it unreviewed" is definitely the wrong answer.
 */
export async function contentPublishOrigin(
  db: Database,
  scope: Scope,
  id: string,
): Promise<{ recipeId?: string; reviewBeforePublish: boolean } | undefined> {
  assertScope(scope);
  const [row] = await db
    .select({
      recipeId: contentItems.recipeId,
      config: recipes.config,
      campaignApprovalMode: campaigns.approvalMode,
    })
    .from(contentItems)
    .leftJoin(recipes, eq(recipes.id, contentItems.recipeId))
    // PRD §7.2's per-campaign approval scope, read in the same statement rather
    // than a second round trip: this runs on the critical path of every publish.
    .leftJoin(campaigns, eq(campaigns.id, contentItems.campaignId))
    .where(and(eq(contentItems.id, id), scopePredicate('contentItems', scope)))
    .limit(1);

  if (!row) return undefined;

  const campaignMode = row.campaignApprovalMode
    ? { campaignApprovalMode: row.campaignApprovalMode as 'autopublish' | 'review_first_week' | 'review_everything' }
    : {};

  if (!row.recipeId) return { reviewBeforePublish: false, ...campaignMode };

  const cfg = row.config as { reviewBeforePublish?: unknown } | null;
  return {
    recipeId: row.recipeId,
    reviewBeforePublish: typeof cfg?.reviewBeforePublish === 'boolean' ? cfg.reviewBeforePublish : true,
    ...campaignMode,
  };
}

/**
 * How many of this genome's items are sitting at `needs_review` — §10's queue
 * cap reads it. `count(*)`, not a list: the policy engine needs the depth of the
 * pile and has no business seeing what is in it.
 */
export async function countPendingReview(db: Database, scope: Scope): Promise<number> {
  assertScope(scope);
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(contentItems)
    .where(and(scopePredicate('contentItems', scope), eq(contentItems.status, 'needs_review')));
  return Number(row?.n ?? 0);
}

export async function findDueContentItems(db: Database, args: { before: Date; limit: number }): Promise<DueContentItem[]> {
  return db
    .select({
      id: contentItems.id,
      orgId: contentItems.orgId,
      genomeId: contentItems.genomeId,
      playbookId: contentItems.playbookId,
      platform: contentItems.platform,
      copy: contentItems.copy,
      intent: contentItems.intent,
      scheduledAt: contentItems.scheduledAt,
    })
    .from(contentItems)
    .where(and(eq(contentItems.status, 'scheduled'), lte(contentItems.scheduledAt, args.before)))
    .orderBy(asc(contentItems.scheduledAt))
    .limit(args.limit) as Promise<DueContentItem[]>;
}

export interface CalendarSlotRow {
  campaignId: string;
  playbookId: string;
  mode: string;
  pillar: string;
  scheduledAt: Date;
  /** `CMP-01.4`'s chosen account for this slot. Null keeps the playbook fallback. */
  platform?: string;
}

/**
 * §6.8 Step 4: writes a campaign's calendar as `content_items` slots.
 *
 * Replaces the campaign's existing *unpublished* slots rather than appending,
 * because regeneration is the normal path — the user adjusts the mix and asks
 * again, repeatedly. Appending would silently double the month.
 *
 * The delete is deliberately narrow: `status <> 'published'`. A published post
 * is a fact about the world, not a plan, and no amount of re-planning may erase
 * it — the guardrail layer's duplicate and saturation checks both read that
 * history, so losing rows there would quietly weaken them.
 */
export async function replaceCampaignSlots(
  db: Database,
  scope: Scope,
  campaignId: string,
  slots: CalendarSlotRow[],
): Promise<number> {
  assertScope(scope);

  await db
    .delete(contentItems)
    .where(
      and(
        scopePredicate('contentItems', scope),
        eq(contentItems.campaignId, campaignId),
        ne(contentItems.status, 'published'),
      ),
    );

  if (slots.length === 0) return 0;

  await db.insert(contentItems).values(
    slots.map((s) => ({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      campaignId: s.campaignId,
      playbookId: s.playbookId,
      mode: s.mode,
      pillar: s.pillar,
      status: 'scheduled',
      scheduledAt: s.scheduledAt,
      ...(s.platform ? { platform: s.platform } : {}),
    })),
  );
  return slots.length;
}

/** §6.8 Step 4's read side — the month view, ordered as it is rendered. */
export async function campaignSlots(
  db: Database,
  scope: Scope,
  campaignId: string,
): Promise<
  Array<{
    id: string;
    playbookId: string | null;
    mode: string | null;
    pillar: string | null;
    status: string;
    scheduledAt: Date | null;
    /**
     * Set at placement time by `CMP-01.4`'s account selection, and null for a
     * slot placed on a day rather than on an account (the date picker and
     * drag-and-drop paths). Selected here for §8.7's platform filter — the
     * column existed and this projection never read it, so the calendar could
     * not group by the thing it schedules to.
     */
    platform: string | null;
  }>
> {
  return db
    .select({
      id: contentItems.id,
      playbookId: contentItems.playbookId,
      mode: contentItems.mode,
      pillar: contentItems.pillar,
      status: contentItems.status,
      scheduledAt: contentItems.scheduledAt,
      platform: contentItems.platform,
    })
    .from(contentItems)
    .where(and(scopePredicate('contentItems', scope), eq(contentItems.campaignId, campaignId)))
    .orderBy(asc(contentItems.scheduledAt));
}

/** Read helper for {@link lookupIdempotentToolCall}-style lookups is intentionally absent here —
 * `tool_calls` and `agent_runs`/`agent_steps` are not in {@link SCOPED_TABLE_NAMES}: they carry
 * `genome_id` for traceability but are audit/operational tables, not the client-confidential
 * material this module exists to fence off, and `auditRepository.ts` / `runRecorderRepository.ts`
 * own them directly. */

// ---------------------------------------------------------------------------
// knowledge_chunks — `brand.knowledge.attach` (plan §12 P6's brand.* family;
// the wider knowledge.* ingestion pipeline itself is still a real gap — this
// is the one write it needs, not the whole family).
// ---------------------------------------------------------------------------

export interface KnowledgeChunkRow {
  id: string;
  genomeId: string;
  docId: string;
  text: string;
  citation: unknown;
  createdAt: Date;
}

const knowledgeChunkColumns = {
  id: knowledgeChunks.id,
  genomeId: knowledgeChunks.genomeId,
  docId: knowledgeChunks.docId,
  text: knowledgeChunks.text,
  citation: knowledgeChunks.citation,
  createdAt: knowledgeChunks.createdAt,
};

export async function createKnowledgeChunk(
  db: Database,
  scope: Scope,
  args: { docId: string; text: string; embedding: number[]; citation?: unknown },
): Promise<KnowledgeChunkRow> {
  assertScope(scope);
  const [row] = await db
    .insert(knowledgeChunks)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      docId: args.docId,
      text: args.text,
      embedding: args.embedding,
      ...(args.citation ? { citation: args.citation } : {}),
    })
    .returning(knowledgeChunkColumns);
  if (!row) throw new ToolError('UPSTREAM_FAILED', 'Failed to save the knowledge chunk.', { docId: args.docId });
  return row;
}

export async function listKnowledgeChunks(db: Database, scope: Scope, docId?: string): Promise<KnowledgeChunkRow[]> {
  return db
    .select(knowledgeChunkColumns)
    .from(knowledgeChunks)
    .where(and(scopePredicate('knowledgeChunks', scope), docId ? eq(knowledgeChunks.docId, docId) : undefined))
    .orderBy(desc(knowledgeChunks.createdAt));
}

// ---------------------------------------------------------------------------
// P5: trend watchlist
// ---------------------------------------------------------------------------

export interface TrendWatchlistRow {
  id: string;
  genomeId: string;
  trendId: string;
  source: string;
  topic: string;
  note: string | null;
  createdAt: Date;
}

const trendWatchlistColumns = {
  id: trendWatchlist.id,
  genomeId: trendWatchlist.genomeId,
  trendId: trendWatchlist.trendId,
  source: trendWatchlist.source,
  topic: trendWatchlist.topic,
  note: trendWatchlist.note,
  createdAt: trendWatchlist.createdAt,
};

/** Upsert-by-(genome, trend) — watching the same trend twice is one watch, not two. */
export interface InfluencerWatchRow {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  note: string | null;
  createdAt: Date;
}

const influencerWatchColumns = {
  id: influencerWatchlist.id,
  platform: influencerWatchlist.platform,
  handle: influencerWatchlist.handle,
  displayName: influencerWatchlist.displayName,
  note: influencerWatchlist.note,
  createdAt: influencerWatchlist.createdAt,
};

/**
 * §8.9's influencer watchlist — upsert by `(genome, platform, handle)`.
 *
 * Watching the same account twice is one watch. The handle arrives already
 * normalised (`normaliseHandle` in `packages/trends/src/influencer.ts`), which
 * is what makes the unique index mean "this account" rather than "this spelling
 * of this account".
 */
export async function addInfluencerWatch(
  db: Database,
  scope: Scope,
  args: { platform: string; handle: string; displayName?: string; note?: string },
): Promise<InfluencerWatchRow> {
  assertScope(scope);
  const [row] = await db
    .insert(influencerWatchlist)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      platform: args.platform,
      handle: args.handle,
      displayName: args.displayName ?? null,
      note: args.note ?? null,
    })
    .onConflictDoUpdate({
      target: [influencerWatchlist.genomeId, influencerWatchlist.platform, influencerWatchlist.handle],
      // Re-watching updates the note rather than erroring: the second attempt is
      // almost always somebody correcting why they were watching.
      set: { note: args.note ?? null, ...(args.displayName ? { displayName: args.displayName } : {}) },
    })
    .returning(influencerWatchColumns);
  return row!;
}

export async function removeInfluencerWatch(
  db: Database,
  scope: Scope,
  args: { platform: string; handle: string },
): Promise<void> {
  assertScope(scope);
  await db
    .delete(influencerWatchlist)
    .where(
      and(
        scopePredicate('influencerWatchlist', scope),
        eq(influencerWatchlist.platform, args.platform),
        eq(influencerWatchlist.handle, args.handle),
      ),
    );
}

/** Newest first — the account somebody just added is the one they are looking for. */
export async function listInfluencerWatchlist(db: Database, scope: Scope): Promise<InfluencerWatchRow[]> {
  return db
    .select(influencerWatchColumns)
    .from(influencerWatchlist)
    .where(scopePredicate('influencerWatchlist', scope))
    .orderBy(desc(influencerWatchlist.createdAt));
}

export async function addToTrendWatchlist(
  db: Database,
  scope: Scope,
  args: { trendId: string; source: string; topic: string; note?: string },
): Promise<TrendWatchlistRow> {
  assertScope(scope);
  const [row] = await db
    .insert(trendWatchlist)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      trendId: args.trendId,
      source: args.source,
      topic: args.topic,
      ...(args.note ? { note: args.note } : {}),
    })
    .onConflictDoUpdate({
      target: [trendWatchlist.genomeId, trendWatchlist.trendId],
      set: { note: args.note ?? null },
    })
    .returning(trendWatchlistColumns);
  if (!row) throw new ToolError('UPSTREAM_FAILED', 'Failed to save the watchlist entry.', { trendId: args.trendId });
  return row;
}

export async function removeFromTrendWatchlist(db: Database, scope: Scope, trendId: string): Promise<void> {
  assertScope(scope);
  await db
    .delete(trendWatchlist)
    .where(and(scopePredicate('trendWatchlist', scope), eq(trendWatchlist.trendId, trendId)));
}

export async function listTrendWatchlist(db: Database, scope: Scope): Promise<TrendWatchlistRow[]> {
  return db
    .select(trendWatchlistColumns)
    .from(trendWatchlist)
    .where(scopePredicate('trendWatchlist', scope))
    .orderBy(desc(trendWatchlist.createdAt));
}

// ---------------------------------------------------------------------------
// P6.1: learning loop (Thompson sampling)
// ---------------------------------------------------------------------------

export interface LearningArmRow {
  id: string;
  genomeId: string;
  pillar: string;
  alpha: number;
  beta: number;
  observations: number;
  updatedAt: Date;
}

const learningArmColumns = {
  id: learningArms.id,
  genomeId: learningArms.genomeId,
  pillar: learningArms.pillar,
  alpha: learningArms.alpha,
  beta: learningArms.beta,
  observations: learningArms.observations,
  updatedAt: learningArms.updatedAt,
};

export async function listLearningArms(db: Database, scope: Scope): Promise<LearningArmRow[]> {
  return db.select(learningArmColumns).from(learningArms).where(scopePredicate('learningArms', scope));
}

/**
 * `learning.reset` — deletes every arm AND every outcome for this genome, not
 * just the arms. Deleting only `learning_arms` would leave `learning_outcomes`
 * behind, and `recordLearningOutcome`'s `onConflictDoNothing` on
 * `contentItemId` would then silently refuse to re-score any post scored
 * before the reset — a genome that looked freshly cold-start would actually
 * still be unable to learn from its own history. Both tables, same transaction.
 */
export async function resetLearning(db: Database, scope: Scope): Promise<void> {
  assertScope(scope);
  await db.transaction(async (tx) => {
    await tx.delete(learningArms).where(scopePredicate('learningArms', scope));
    await tx.delete(learningOutcomes).where(scopePredicate('learningOutcomes', scope));
  });
}

/**
 * Records one outcome and updates its arm's Beta posterior in the same
 * transaction — `alpha += reward`, `beta += (1 - reward)`, the standard Beta-
 * Bernoulli update. Idempotent on `contentItemId` via the unique index on
 * `learning_outcomes`: a re-ingested metrics snapshot for a post already
 * scored must not move the arm twice.
 */
export async function recordLearningOutcome(
  db: Database,
  scope: Scope,
  args: { contentItemId: string; pillar: string; reward: number },
): Promise<{ recorded: boolean; arm: LearningArmRow }> {
  assertScope(scope);
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(learningOutcomes)
      .values({
        orgId: scope.orgId,
        genomeId: scope.genomeId,
        contentItemId: args.contentItemId,
        pillar: args.pillar,
        reward: args.reward,
      })
      .onConflictDoNothing({ target: learningOutcomes.contentItemId })
      .returning({ id: learningOutcomes.id });

    const recorded = !!inserted;

    if (recorded) {
      await tx
        .insert(learningArms)
        .values({
          orgId: scope.orgId,
          genomeId: scope.genomeId,
          pillar: args.pillar,
          alpha: 1 + args.reward,
          beta: 1 + (1 - args.reward),
          observations: 1,
        })
        .onConflictDoUpdate({
          target: [learningArms.genomeId, learningArms.pillar],
          set: {
            alpha: sql`${learningArms.alpha} + ${args.reward}`,
            beta: sql`${learningArms.beta} + ${1 - args.reward}`,
            observations: sql`${learningArms.observations} + 1`,
            updatedAt: sql`now()`,
          },
        });
    }

    const [arm] = await tx
      .select(learningArmColumns)
      .from(learningArms)
      .where(and(scopePredicate('learningArms', scope), eq(learningArms.pillar, args.pillar)))
      .limit(1);
    if (!arm) throw new ToolError('UPSTREAM_FAILED', 'Failed to update the learning arm.', { pillar: args.pillar });

    return { recorded, arm };
  });
}

// ---------------------------------------------------------------------------
// P5.2: recipes
// ---------------------------------------------------------------------------

export interface RecipeRow {
  id: string;
  genomeId: string;
  kind: string;
  name: string;
  config: unknown;
  status: string;
  intervalMinutes: number | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const recipeColumns = {
  id: recipes.id,
  genomeId: recipes.genomeId,
  kind: recipes.kind,
  name: recipes.name,
  config: recipes.config,
  status: recipes.status,
  intervalMinutes: recipes.intervalMinutes,
  lastRunAt: recipes.lastRunAt,
  createdAt: recipes.createdAt,
  updatedAt: recipes.updatedAt,
};

export async function createRecipe(
  db: Database,
  scope: Scope,
  args: { kind: string; name: string; config: unknown; intervalMinutes?: number },
): Promise<RecipeRow> {
  assertScope(scope);
  const [row] = await db
    .insert(recipes)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      kind: args.kind,
      name: args.name,
      config: args.config,
      ...(args.intervalMinutes ? { intervalMinutes: args.intervalMinutes } : {}),
    })
    .returning(recipeColumns);
  if (!row) throw new ToolError('UPSTREAM_FAILED', 'Failed to create the recipe.', { kind: args.kind });
  return row;
}

export async function getRecipe(db: Database, scope: Scope, id: string): Promise<RecipeRow | undefined> {
  const [row] = await db
    .select(recipeColumns)
    .from(recipes)
    .where(and(eq(recipes.id, id), scopePredicate('recipes', scope)))
    .limit(1);
  return row;
}

export async function listRecipes(db: Database, scope: Scope): Promise<RecipeRow[]> {
  return db
    .select(recipeColumns)
    .from(recipes)
    .where(scopePredicate('recipes', scope))
    .orderBy(desc(recipes.createdAt));
}

export async function setRecipeStatus(
  db: Database,
  scope: Scope,
  args: { id: string; status: 'active' | 'paused' },
): Promise<RecipeRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(recipes)
    .set({ status: args.status, updatedAt: sql`now()` })
    .where(and(eq(recipes.id, args.id), scopePredicate('recipes', scope)))
    .returning(recipeColumns);
  return row;
}

export async function deleteRecipe(db: Database, scope: Scope, id: string): Promise<void> {
  assertScope(scope);
  await db.delete(recipes).where(and(eq(recipes.id, id), scopePredicate('recipes', scope)));
}

export async function markRecipeRan(db: Database, scope: Scope, id: string, at: Date): Promise<void> {
  assertScope(scope);
  await db
    .update(recipes)
    .set({ lastRunAt: at, updatedAt: sql`now()` })
    .where(and(eq(recipes.id, id), scopePredicate('recipes', scope)));
}

/** Recipes due to run — `lastRunAt` is either null (never run) or older than its own interval. Not genome-scoped by caller; the runner sweeps across every org. */
export async function findDueRecipes(db: Database, before: Date): Promise<Array<RecipeRow & { orgId: string }>> {
  return db
    .select({ ...recipeColumns, orgId: recipes.orgId })
    .from(recipes)
    .where(
      and(
        eq(recipes.status, 'active'),
        sql`${recipes.intervalMinutes} is not null`,
        sql`(${recipes.lastRunAt} is null or ${recipes.lastRunAt} + (${recipes.intervalMinutes} || ' minutes')::interval <= ${before.toISOString()})`,
      ),
    );
}

export interface RecipeOutputRow {
  id: string;
  recipeId: string;
  runId: string;
  genomeId: string;
  status: string;
  preview: unknown;
  contentItemId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

const recipeOutputColumns = {
  id: recipeOutputs.id,
  recipeId: recipeOutputs.recipeId,
  runId: recipeOutputs.runId,
  genomeId: recipeOutputs.genomeId,
  status: recipeOutputs.status,
  preview: recipeOutputs.preview,
  contentItemId: recipeOutputs.contentItemId,
  createdAt: recipeOutputs.createdAt,
  decidedAt: recipeOutputs.decidedAt,
};

export async function recordRecipeRun(
  db: Database,
  scope: Scope,
  args: { recipeId: string; status: 'succeeded' | 'failed'; outputCount: number; error?: string; outputs: unknown[] },
): Promise<{ runId: string }> {
  assertScope(scope);
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(recipeRuns)
      .values({
        orgId: scope.orgId,
        genomeId: scope.genomeId,
        recipeId: args.recipeId,
        status: args.status,
        outputCount: args.outputCount,
        ...(args.error ? { error: args.error } : {}),
        finishedAt: sql`now()`,
      })
      .returning({ id: recipeRuns.id });
    if (!run) throw new ToolError('UPSTREAM_FAILED', 'Failed to record the recipe run.', { recipeId: args.recipeId });

    if (args.outputs.length) {
      await tx.insert(recipeOutputs).values(
        args.outputs.map((preview) => ({
          orgId: scope.orgId,
          genomeId: scope.genomeId,
          recipeId: args.recipeId,
          runId: run.id,
          preview,
        })),
      );
    }

    return { runId: run.id };
  });
}

export async function listRecipeOutputs(
  db: Database,
  scope: Scope,
  args: { status?: string; limit: number },
): Promise<RecipeOutputRow[]> {
  return db
    .select(recipeOutputColumns)
    .from(recipeOutputs)
    .where(and(scopePredicate('recipeOutputs', scope), args.status ? eq(recipeOutputs.status, args.status) : undefined))
    .orderBy(desc(recipeOutputs.createdAt))
    .limit(args.limit);
}

export async function decideRecipeOutput(
  db: Database,
  scope: Scope,
  args: { id: string; status: 'approved' | 'rejected'; contentItemId?: string },
): Promise<RecipeOutputRow | undefined> {
  assertScope(scope);
  const [row] = await db
    .update(recipeOutputs)
    .set({ status: args.status, decidedAt: sql`now()`, ...(args.contentItemId ? { contentItemId: args.contentItemId } : {}) })
    .where(and(eq(recipeOutputs.id, args.id), scopePredicate('recipeOutputs', scope)))
    .returning(recipeOutputColumns);
  return row;
}

// ---------------------------------------------------------------------------
// `oauth_connections` — a brand's own connected third-party account (Canva).
// ---------------------------------------------------------------------------

export interface OAuthConnectionRow {
  id: string;
  /** Selected for `findExpiringOAuthConnections` — see the projection's comment. */
  orgId: string;
  genomeId: string;
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  connectedBy: string;
  createdAt: Date;
  updatedAt: Date;
  scopes: string[] | null;
  accountLabel: string | null;
  expiryNotifiedAt: Date | null;
}

const oauthConnectionColumns = {
  id: oauthConnections.id,
  // `orgId` is here for `findExpiringOAuthConnections`, the one read on this
  // table that is not already inside a tenant: its caller has to know whose
  // connection each row is before it can notify anybody about it.
  orgId: oauthConnections.orgId,
  genomeId: oauthConnections.genomeId,
  provider: oauthConnections.provider,
  accessToken: oauthConnections.accessToken,
  refreshToken: oauthConnections.refreshToken,
  expiresAt: oauthConnections.expiresAt,
  connectedBy: oauthConnections.connectedBy,
  createdAt: oauthConnections.createdAt,
  updatedAt: oauthConnections.updatedAt,
  scopes: oauthConnections.scopes,
  accountLabel: oauthConnections.accountLabel,
  expiryNotifiedAt: oauthConnections.expiryNotifiedAt,
};

/** Upsert by (genome, provider) — reconnecting replaces the old token rather than accumulating stale rows. */
export async function saveOAuthConnection(
  db: Database,
  scope: Scope,
  args: {
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    connectedBy: string;
    scopes?: string[];
    accountLabel?: string;
  },
): Promise<OAuthConnectionRow> {
  assertScope(scope);
  const [row] = await db
    .insert(oauthConnections)
    .values({
      orgId: scope.orgId,
      genomeId: scope.genomeId,
      provider: args.provider,
      accessToken: args.accessToken,
      connectedBy: args.connectedBy,
      ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
      ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
      ...(args.scopes ? { scopes: args.scopes } : {}),
      ...(args.accountLabel ? { accountLabel: args.accountLabel } : {}),
    })
    .onConflictDoUpdate({
      target: [oauthConnections.genomeId, oauthConnections.provider],
      set: {
        accessToken: args.accessToken,
        connectedBy: args.connectedBy,
        refreshToken: args.refreshToken ?? null,
        expiresAt: args.expiresAt ?? null,
        scopes: args.scopes ?? null,
        accountLabel: args.accountLabel ?? null,
        // Reconnecting re-arms the §10 expiry alert. The new token has a new
        // expiry, so the next warning is a new fact, not a repeat of the one
        // that prompted this reconnection.
        expiryNotifiedAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning(oauthConnectionColumns);
  if (!row) throw new ToolError('UPSTREAM_FAILED', 'Failed to save the OAuth connection.', { provider: args.provider });
  return row;
}

export async function getOAuthConnection(db: Database, scope: Scope, provider: string): Promise<OAuthConnectionRow | undefined> {
  const [row] = await db
    .select(oauthConnectionColumns)
    .from(oauthConnections)
    .where(and(scopePredicate('oauthConnections', scope), eq(oauthConnections.provider, provider)))
    .limit(1);
  return row;
}

/**
 * Connections due a §10 expiry warning: token expires before `before`, and
 * nobody has been told since the token was last saved.
 *
 * **The second deliberate cross-tenant read in this file**, after
 * {@link findDueContentItems}, and it carries the same justification and the
 * same shape. The caller is a clock (`apps/api/src/connection-watcher.ts`);
 * a clock has no session, so there is no genome to scope to. Every row comes
 * back carrying its own `orgId` and `genomeId`, and the caller is required to
 * use them — the notification it raises goes through that tenant's own
 * governance, exactly like a scheduled publish does.
 *
 * `expiresAt` null is excluded, not treated as urgent. Several providers issue
 * tokens with no stated expiry (or ones this codebase never learned), and
 * warning about a connection that is working fine is how an alert channel
 * becomes noise the owner learns to ignore — which would cost more than the
 * alert is worth.
 */
export async function findExpiringOAuthConnections(
  db: Database,
  args: { before: Date; limit: number },
): Promise<OAuthConnectionRow[]> {
  return db
    .select(oauthConnectionColumns)
    .from(oauthConnections)
    .where(
      and(
        isNotNull(oauthConnections.expiresAt),
        lte(oauthConnections.expiresAt, args.before),
        isNull(oauthConnections.expiryNotifiedAt),
      ),
    )
    .orderBy(asc(oauthConnections.expiresAt))
    .limit(args.limit);
}

/** Latches the warning from {@link findExpiringOAuthConnections}. Org-scoped, unlike the read. */
export async function markOAuthExpiryNotified(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string; at: Date },
): Promise<void> {
  await db
    .update(oauthConnections)
    .set({ expiryNotifiedAt: args.at })
    .where(and(eq(oauthConnections.id, args.id), eq(oauthConnections.orgId, scope.orgId)));
}

export async function removeOAuthConnection(db: Database, scope: Scope, provider: string): Promise<void> {
  assertScope(scope);
  await db.delete(oauthConnections).where(and(scopePredicate('oauthConnections', scope), eq(oauthConnections.provider, provider)));
}

/* ── PRD §5's success metrics ───────────────────────────────────────────── */

/**
 * The raw counts PRD §5's fourteen success metrics are computed from, for one
 * genome over one window.
 *
 * ── Why one read and not fourteen ──────────────────────────────────────────
 *
 * §5 is a dashboard. Fourteen separate tools would be fourteen round trips to
 * render one screen, and — worse — fourteen chances for two numbers on the same
 * screen to be computed over subtly different windows. One read, one window, one
 * moment.
 *
 * ── What is a count and what is honestly a proxy ───────────────────────────
 *
 * Most of these are exact. Two are not, and the tool that reads this says so
 * rather than presenting an estimate as a measurement:
 *
 *  - **Draft edits per post** is counted as successful `content.draft` calls
 *    divided by published posts. A "post" can be re-drafted before it is ever
 *    published, and `tool_calls` does not carry the content item id in a queryable
 *    column (it is inside the `input` jsonb), so this is a ratio over the window
 *    rather than a per-post average. Directionally right, not exact.
 *  - **CTA clicks** are not here at all. Clicks live in Dub, behind
 *    `analytics.cta_traffic`, one link at a time. What this reports is how many
 *    published posts carried a tracked link — the denominator — because a
 *    fabricated click total would be worse than an honest absence.
 */
export interface SuccessMetricRows {
  /* Activation */
  connectedAccounts: number;
  campaignCount: number;
  firstCampaignStartAt: Date | null;
  firstPublishedAt: Date | null;

  /* Production */
  publishedInWindow: number;
  postsWithTrackedLink: number;

  /* Discovery */
  postsFromTrends: number;

  /* Automation */
  recipeCount: number;
  outputsApproved: number;
  outputsRejected: number;

  /* Engagement */
  messagesInWindow: number;
  messagesResolved: number;
  /** Mean seconds from arrival to resolution, over resolved messages only. */
  meanReplySeconds: number | null;
  opportunitiesInWindow: number;
  opportunitiesRouted: number;

  /* Trust & safety */
  publishedEverBlocked: number;
  rolledBack: number;
  needsReview: number;
}

export async function readSuccessMetrics(
  db: Database,
  scope: Scope,
  since: Date,
): Promise<SuccessMetricRows> {
  assertScope(scope);
  const contentScope = scopePredicate('contentItems', scope);

  const [
    connections,
    campaignRows,
    firstPublished,
    contentCounts,
    linked,
    recipeRows,
    outputRows,
    messageRows,
    opportunityRows,
  ] = await Promise.all([
    db
      .select({ n: sql<string>`count(*)` })
      .from(oauthConnections)
      .where(scopePredicate('oauthConnections', scope)),

    // Campaign count and the earliest start, for "time to first post after
    // activation" — the interval §5 names, measured from activation not creation.
    db
      .select({ n: sql<string>`count(*)`, firstStart: sql<Date | null>`min(${campaigns.startAt})` })
      .from(campaigns)
      .where(and(eq(campaigns.orgId, scope.orgId), eq(campaigns.genomeId, scope.genomeId))),

    db
      .select({ at: sql<Date | null>`min(${contentItems.publishedAt})` })
      .from(contentItems)
      .where(and(contentScope, eq(contentItems.status, 'published'))),

    // One grouped pass over statuses rather than a query each: the dashboard
    // wants published, blocked, rolled back and needs-review together.
    db
      .select({ status: contentItems.status, n: sql<string>`count(*)` })
      .from(contentItems)
      .where(contentScope)
      .groupBy(contentItems.status),

    // Published in the window, split by whether it carried a tracked link and
    // whether it came from a trend — the two attribution questions §5 asks.
    db
      .select({
        published: sql<string>`count(*)`,
        withLink: sql<string>`count(distinct ${contentLinks.contentItemId})`,
        fromTrend: sql<string>`count(${contentItems.sourceTrendId})`,
      })
      .from(contentItems)
      .leftJoin(contentLinks, eq(contentLinks.contentItemId, contentItems.id))
      .where(and(contentScope, eq(contentItems.status, 'published'), gte(contentItems.publishedAt, since))),

    db
      .select({ n: sql<string>`count(*)` })
      .from(recipes)
      .where(scopePredicate('recipes', scope)),

    db
      .select({ status: recipeOutputs.status, n: sql<string>`count(*)` })
      .from(recipeOutputs)
      .where(scopePredicate('recipeOutputs', scope))
      .groupBy(recipeOutputs.status),

    // Reply SLA over *resolved* messages only. Including the unanswered ones
    // would make an ignored inbox look fast, since an open message has no
    // interval at all.
    db
      .select({
        total: sql<string>`count(*)`,
        resolved: sql<string>`count(${engagementMessages.resolvedAt})`,
        meanSeconds: sql<
          string | null
        >`avg(extract(epoch from (${engagementMessages.resolvedAt} - ${engagementMessages.receivedAt})))`,
      })
      .from(engagementMessages)
      .where(and(scopePredicate('engagementMessages', scope), gte(engagementMessages.receivedAt, since))),

    // "Next action taken" is `routedTo` being set: §8.8's recommended action
    // having actually been carried out, rather than merely offered.
    db
      .select({
        total: sql<string>`count(*)`,
        routed: sql<string>`count(${opportunities.routedTo})`,
      })
      .from(opportunities)
      .where(and(scopePredicate('opportunities', scope), gte(opportunities.createdAt, since))),
  ]);

  const byStatus = (status: string) =>
    Number(contentCounts.find((r) => r.status === status)?.n ?? 0);
  const outputsBy = (status: string) => Number(outputRows.find((r) => r.status === status)?.n ?? 0);
  const meanSeconds = messageRows[0]?.meanSeconds;

  return {
    connectedAccounts: Number(connections[0]?.n ?? 0),
    campaignCount: Number(campaignRows[0]?.n ?? 0),
    firstCampaignStartAt: campaignRows[0]?.firstStart ?? null,
    firstPublishedAt: firstPublished[0]?.at ?? null,

    publishedInWindow: Number(linked[0]?.published ?? 0),
    postsWithTrackedLink: Number(linked[0]?.withLink ?? 0),
    postsFromTrends: Number(linked[0]?.fromTrend ?? 0),

    recipeCount: Number(recipeRows[0]?.n ?? 0),
    outputsApproved: outputsBy('approved'),
    outputsRejected: outputsBy('rejected'),

    messagesInWindow: Number(messageRows[0]?.total ?? 0),
    messagesResolved: Number(messageRows[0]?.resolved ?? 0),
    meanReplySeconds: meanSeconds === null || meanSeconds === undefined ? null : Number(meanSeconds),
    opportunitiesInWindow: Number(opportunityRows[0]?.total ?? 0),
    opportunitiesRouted: Number(opportunityRows[0]?.routed ?? 0),

    publishedEverBlocked: byStatus('blocked'),
    rolledBack: byStatus('rolled_back'),
    needsReview: byStatus('needs_review'),
  };
}
