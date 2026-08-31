import { and, desc, eq } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared';
import type { ApprovalMode, CampaignRecord, CampaignStore } from '@sparksocial/tools/defineTool';
import type { CampaignType, CampaignWeight, EngagementRung } from '@sparksocial/shared/campaignAutonomy';
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
    async create({
      orgId, genomeId, name, objective, windowDays, startAt, plan, targetCount, targetLabel, platforms, approvalMode,
      campaignType, primaryCta, weight, engagementRung, learnFromPerformance, adjustMixAutomatically,
    }) {
      const [row] = await db
        .insert(campaigns)
        .values({
          orgId,
          genomeId,
          name,
          objective,
          windowDays,
          startAt,
          plan: plan as object,
          status: 'draft',
          ...(targetCount !== undefined ? { targetCount } : {}),
          ...(targetLabel !== undefined ? { targetLabel } : {}),
          ...(platforms?.length ? { platforms } : {}),
          ...(approvalMode ? { approvalMode } : {}),
          // The wizard's fields. Each is omitted rather than defaulted when the
          // caller says nothing, so "never asked" stays distinguishable from
          // "answered with the default" — `CampaignRecord` explains why.
          ...(campaignType ? { campaignType } : {}),
          ...(primaryCta ? { primaryCta } : {}),
          ...(weight ? { weight } : {}),
          ...(engagementRung ? { engagementRung } : {}),
          ...(learnFromPerformance !== undefined ? { learnFromPerformance } : {}),
          ...(adjustMixAutomatically !== undefined ? { adjustMixAutomatically } : {}),
        })
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
      return toRecord(row);
    },

    async listForGenome(genomeId, orgId, limit) {
      const rows = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.orgId, orgId), eq(campaigns.genomeId, genomeId)))
        .orderBy(desc(campaigns.startAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows.map(toRecord);
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

    async setName(campaignId, orgId, name) {
      const result = await db
        .update(campaigns)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.orgId, orgId)))
        .returning({ name: campaigns.name });
      // Undefined rather than throwing, so the tool decides how a missing
      // campaign reads — the same split `get` already makes.
      return result[0];
    },
  };
}

/**
 * One row → one `CampaignRecord`.
 *
 * `get` and `listForGenome` had identical fifteen-line mappings, which is the
 * shape that drifts: the wizard added six fields and there were two places to
 * remember. Every nullable column is omitted rather than passed through as
 * `null`, because `CampaignRecord` distinguishes "never answered" from
 * "answered", and `null` would read as a third thing.
 */
function toRecord(row: typeof campaigns.$inferSelect): CampaignRecord {
  return {
    id: row.id,
    genomeId: row.genomeId,
    name: row.name,
    objective: row.objective,
    windowDays: row.windowDays,
    startAt: row.startAt,
    status: row.status,
    plan: row.plan,
    ...(row.targetCount !== null ? { targetCount: row.targetCount } : {}),
    ...(row.targetLabel !== null ? { targetLabel: row.targetLabel } : {}),
    ...(row.platforms ? { platforms: row.platforms } : {}),
    ...(row.approvalMode ? { approvalMode: row.approvalMode as ApprovalMode } : {}),
    ...(row.campaignType ? { campaignType: row.campaignType as CampaignType } : {}),
    ...(row.primaryCta ? { primaryCta: row.primaryCta } : {}),
    ...(row.weight ? { weight: row.weight as CampaignWeight } : {}),
    ...(row.engagementRung ? { engagementRung: row.engagementRung as EngagementRung } : {}),
    ...(row.learnFromPerformance !== null ? { learnFromPerformance: row.learnFromPerformance } : {}),
    ...(row.adjustMixAutomatically !== null ? { adjustMixAutomatically: row.adjustMixAutomatically } : {}),
  };
}
