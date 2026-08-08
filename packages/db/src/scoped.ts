import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { ToolError, type AssetRole } from '@sparksocial/shared/types';
import { byId } from '@sparksocial/playbooks';
import { assets, knowledgeChunks, memories, contentItems } from './schema.js';
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
const SCOPED_TABLES = { assets, knowledgeChunks, memories, contentItems } as const;
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
): Promise<Record<string, { rightsStatus: string; lastUsedDaysAgo?: number }>> {
  if (ids.length === 0) return {};
  const now = Date.now();
  const rows = await db
    .select({ id: assets.id, rightsStatus: assets.rightsStatus, lastUsedAt: assets.lastUsedAt })
    .from(assets)
    .where(and(scopePredicate('assets', scope), inArray(assets.id, ids)));

  const out: Record<string, { rightsStatus: string; lastUsedDaysAgo?: number }> = {};
  for (const r of rows) {
    out[r.id] = {
      rightsStatus: r.rightsStatus,
      lastUsedDaysAgo: r.lastUsedAt ? (now - r.lastUsedAt.getTime()) / 86_400_000 : undefined,
    };
  }
  return out;
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

/** Marks a content item published, with its copy's embedding — the write side of {@link recentContent}. */
export async function markContentPublished(
  db: Database,
  scope: Pick<Scope, 'orgId'>,
  args: { id: string; embedding: number[]; publishedAt?: Date },
): Promise<void> {
  await db
    .update(contentItems)
    .set({ status: 'published', publishedAt: args.publishedAt ?? new Date(), embedding: args.embedding })
    .where(and(eq(contentItems.id, args.id), eq(contentItems.orgId, scope.orgId)));
}

/** Read helper for {@link lookupIdempotentToolCall}-style lookups is intentionally absent here —
 * `tool_calls` and `agent_runs`/`agent_steps` are not in {@link SCOPED_TABLE_NAMES}: they carry
 * `genome_id` for traceability but are audit/operational tables, not the client-confidential
 * material this module exists to fence off, and `auditRepository.ts` / `runRecorderRepository.ts`
 * own them directly. */
