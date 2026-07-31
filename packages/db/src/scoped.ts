import { and, eq, sql, type SQL } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared/types';
import { assets, knowledgeChunks, memories, contentItems } from './schema.js';

/**
 * GENOME ISOLATION.
 *
 * An agency runs many clients inside one workspace. A client's assets must never
 * surface in another client's generation — including via embedding retrieval, which
 * is the leak everyone forgets. Enforcement lives here, in the query layer.
 *
 * A UI filter is not isolation. A `where` clause a developer remembered to add is not
 * isolation. The only way to reach these tables is through this module, and
 * `npm run test:isolation` fails the build if a raw query bypasses it.
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
      requiredRoles?.length
        ? sql`${assets.assetRole} = ANY(${sql.raw(`ARRAY['${requiredRoles.join("','")}']`)})`
        : undefined,
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
