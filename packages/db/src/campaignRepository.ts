import { and, desc, eq } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared';
import type { CampaignStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { campaigns } from './schema.js';
import { campaignSlots, replaceCampaignSlots, type Scope } from './scoped.js';

/**
 * `campaigns` backed by Postgres (§6.8, `CMP-01.*`).
 *
 * The campaign row itself is imported here directly — `campaigns` is not in
 * `SCOPED_TABLES`, for the same reason `genomes` is not: it is scoped by
 * `genome_id` but holds no client-confidential material of its own. The slots
 * it owns *are* confidential, so every `content_items` read and write goes
 * through `scoped.ts` rather than being duplicated here.
 */
export function createCampaignRepository(db: Database): CampaignStore {
  return {
    async create({ orgId, genomeId, name, objective, windowDays, startAt, plan }) {
      const [row] = await db
        .insert(campaigns)
        .values({ orgId, genomeId, name, objective, windowDays, startAt, plan: plan as object, status: 'draft' })
        .returning({ id: campaigns.id });
      return { id: row!.id };
    },

    async get(campaignId, orgId) {
      const [row] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.orgId, orgId)))
        .limit(1);
      if (!row) return undefined;
      return {
        id: row.id,
        genomeId: row.genomeId,
        name: row.name,
        objective: row.objective,
        windowDays: row.windowDays,
        startAt: row.startAt,
        status: row.status,
        plan: row.plan,
      };
    },

    async listForGenome(genomeId, orgId, limit) {
      const rows = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.orgId, orgId), eq(campaigns.genomeId, genomeId)))
        .orderBy(desc(campaigns.startAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows.map((r) => ({
        id: r.id,
        genomeId: r.genomeId,
        name: r.name,
        objective: r.objective,
        windowDays: r.windowDays,
        startAt: r.startAt,
        status: r.status,
        plan: r.plan,
      }));
    },

    async replaceSlots({ campaignId, orgId, genomeId, slots }) {
      // `brandId` is not a column on `content_items`; `assertScope` still wants
      // one, so `orgId` stands in — see the same note in `assetRepository.ts`.
      const scope: Scope = { orgId, brandId: orgId, genomeId };
      return replaceCampaignSlots(
        db,
        scope,
        campaignId,
        slots.map((s) => ({ ...s, campaignId })),
      );
    },

    async slots(campaignId, orgId, genomeId) {
      const scope: Scope = { orgId, brandId: orgId, genomeId };
      return campaignSlots(db, scope, campaignId);
    },

    async setStatus(campaignId, orgId, status) {
      const result = await db
        .update(campaigns)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.orgId, orgId)))
        .returning({ id: campaigns.id });
      if (result.length === 0) {
        // Out of scope reads as absent, never as another org's campaign.
        throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId });
      }
    },
  };
}
