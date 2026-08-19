import type { Opportunity, OpportunityStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/**
 * `ScopedDb['opportunities']` backed by Postgres. Never touches
 * `opportunities` directly; delegates to `scoped.ts`, the only module the
 * isolation test permits to import scoped tables. Mirrors
 * `engagementRepository.ts`'s shape.
 */
export function createOpportunityRepository(db: Database): OpportunityStore {
  return {
    async create({ genomeId, orgId, ...args }) {
      const row = await scoped.createOpportunity(db, { orgId, brandId: orgId, genomeId }, args);
      return toOpportunity(row);
    },

    async get(id, genomeId, orgId) {
      const row = await scoped.getOpportunity(db, { orgId, brandId: orgId, genomeId }, id);
      return row ? toOpportunity(row) : undefined;
    },

    async route({ id, genomeId, orgId, routedTo }) {
      const row = await scoped.routeOpportunity(db, { orgId, brandId: orgId, genomeId }, { id, routedTo });
      return row ? toOpportunity(row) : undefined;
    },
  };
}

function toOpportunity(row: scoped.OpportunityRow): Opportunity {
  return {
    id: row.id,
    genomeId: row.genomeId,
    inboxItemId: row.inboxItemId,
    temperature: row.temperature as Opportunity['temperature'],
    recommendedAction: row.recommendedAction,
    ...(row.routedTo ? { routedTo: row.routedTo } : {}),
    createdAt: row.createdAt,
  };
}
