import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `campaign.duplicate` / `.pause` / `.resume` — the campaign lifecycle §6.8's
 * own tool list names, closing the same shape of gap `asset.reuse` did:
 * `CampaignStore.setStatus` has existed since the calendar tools shipped, and
 * nothing anywhere ever called it — a campaign, once created, had no way to
 * stop or restart short of editing Postgres by hand.
 */

/* ── campaign.pause / campaign.resume ───────────────────────────────── */

function makeStatusTool(name: 'campaign.pause' | 'campaign.resume', status: 'paused' | 'active', verb: string) {
  return defineTool({
    name,
    version: 1,

    summary:
      name === 'campaign.pause'
        ? "Pause a campaign — stops it being the genome's active outcome to plan against, without touching content already scheduled or published."
        : 'Resume a paused campaign, marking it active again.',

    input: z.object({ campaignId: z.string().min(1) }),
    output: z.object({ campaignId: z.string(), status: z.string() }),

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Setting the same status twice is a no-op, not a new decision each time.
    idempotent: true,

    async handler(input, ctx) {
      await ctx.db.campaigns.setStatus(input.campaignId, ctx.orgId, status);
      ctx.logger.info(`campaign ${verb}`, { campaignId: input.campaignId, status });
      return { campaignId: input.campaignId, status };
    },
  });
}

export const campaignPause = makeStatusTool('campaign.pause', 'paused', 'paused');
export const campaignResume = makeStatusTool('campaign.resume', 'active', 'resumed');

/* ── campaign.duplicate ──────────────────────────────────────────────── */

export const CampaignDuplicateInput = z.object({
  genomeId: z.string().min(1),
  campaignId: z.string().min(1),
  /** Defaults to "<original name> (copy)". */
  name: z.string().min(1).max(120).optional(),
  /** Defaults to now — a duplicate is a new run of the same plan, not a backdated one. */
  startAt: z.string().datetime().optional(),
});

export const CampaignDuplicateOutput = z.object({
  campaignId: z.string(),
  name: z.string(),
  objective: z.string(),
  windowDays: z.number(),
  startAt: z.string(),
});

export const campaignDuplicate = defineTool({
  name: 'campaign.duplicate',
  version: 1,

  summary:
    "Clone an existing campaign's objective, window, and approved plan into a new one — for running the " +
    'same outcome again, not for editing (create a fresh one via campaign.propose_plan for that). ' +
    'Slots are not copied; run calendar.generate on the new campaign to lay out dates.',

  input: CampaignDuplicateInput,
  output: CampaignDuplicateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: false,

  async handler(input, ctx) {
    const source = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!source) {
      throw new ToolError('NOT_FOUND', `No campaign ${input.campaignId}.`, { campaignId: input.campaignId });
    }
    if (source.genomeId !== input.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That campaign belongs to a different genome.', {
        campaignId: input.campaignId,
        genomeId: input.genomeId,
      });
    }

    const startAt = input.startAt ? new Date(input.startAt) : new Date();
    const name = input.name ?? `${source.name} (copy)`;

    // The plan is copied as-is, the same snapshot-not-recompute reasoning
    // `campaign.create` gives its own plan field: duplicating means "run this
    // exact approved plan again," not "re-plan against however the Asset
    // Graph and resolver look right now."
    const { id } = await ctx.db.campaigns.create({
      orgId: ctx.orgId,
      genomeId: input.genomeId,
      name,
      objective: source.objective,
      windowDays: source.windowDays,
      startAt,
      plan: source.plan,
      ...(source.targetCount !== undefined ? { targetCount: source.targetCount } : {}),
      ...(source.targetLabel !== undefined ? { targetLabel: source.targetLabel } : {}),
    });

    ctx.logger.info('campaign duplicated', { sourceCampaignId: input.campaignId, campaignId: id, genomeId: input.genomeId });

    return {
      campaignId: id,
      name,
      objective: source.objective,
      windowDays: source.windowDays,
      startAt: startAt.toISOString(),
    };
  },
});
