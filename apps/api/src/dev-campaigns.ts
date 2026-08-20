import { randomUUID } from 'node:crypto';
import { ToolError } from '@sparksocial/shared';
import type { CampaignRecord, CampaignStore } from '@sparksocial/tools/defineTool';

/**
 * In-memory `campaigns` + calendar slots — the dev counterpart to
 * `packages/db/src/campaignRepository.ts`.
 *
 * Scoping mirrors Postgres exactly: every read filters on `orgId`, and an
 * out-of-scope campaign reads as absent. A dev store that skipped that would
 * train the wrong habits into every handler written against it.
 */
export function createDevCampaignStore(): CampaignStore & { size(): number } {
  const rows = new Map<string, CampaignRecord & { orgId: string }>();
  const slots = new Map<
    string,
    Array<{
      id: string;
      playbookId: string | null;
      mode: string | null;
      pillar: string | null;
      status: string;
      scheduledAt: Date | null;
    }>
  >();

  return {
    size: () => rows.size,

    async create({ orgId, genomeId, name, objective, windowDays, startAt, plan, targetCount, targetLabel, platforms, approvalMode }) {
      const id = randomUUID();
      rows.set(id, {
        id,
        orgId,
        genomeId,
        name,
        objective,
        windowDays,
        startAt,
        status: 'draft',
        plan,
        ...(targetCount !== undefined ? { targetCount } : {}),
        ...(targetLabel !== undefined ? { targetLabel } : {}),
        ...(platforms?.length ? { platforms } : {}),
        ...(approvalMode ? { approvalMode } : {}),
      });
      slots.set(id, []);
      return { id };
    },

    async get(campaignId, orgId) {
      const row = rows.get(campaignId);
      return row && row.orgId === orgId ? row : undefined;
    },

    async listForGenome(genomeId, orgId, limit) {
      return [...rows.values()]
        .filter((r) => r.orgId === orgId && r.genomeId === genomeId)
        .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
        .slice(0, Math.min(Math.max(limit, 1), 100));
    },

    async replaceSlots({ campaignId, orgId, slots: next }) {
      const row = rows.get(campaignId);
      if (!row || row.orgId !== orgId) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId });

      // Published slots survive regeneration — same rule as Postgres. A
      // published post is a fact, and the guardrail layer reads that history.
      const kept = (slots.get(campaignId) ?? []).filter((s) => s.status === 'published');
      slots.set(campaignId, [
        ...kept,
        ...next.map((s) => ({
          id: randomUUID(),
          playbookId: s.playbookId,
          mode: s.mode,
          pillar: s.pillar,
          status: 'scheduled',
          scheduledAt: s.scheduledAt,
        })),
      ]);
      return next.length;
    },

    async slots(campaignId, orgId) {
      const row = rows.get(campaignId);
      if (!row || row.orgId !== orgId) return [];
      return [...(slots.get(campaignId) ?? [])].sort(
        (a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0),
      );
    },

    async setStatus(campaignId, orgId, status) {
      const row = rows.get(campaignId);
      if (!row || row.orgId !== orgId) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId });
      row.status = status;
    },
  };
}
