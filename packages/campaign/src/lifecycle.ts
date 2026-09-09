import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { CampaignStatus, Objective, ToolError } from '@sparksocial/shared';

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
        : /**
           * Both transitions into `active`, deliberately one tool.
           *
           * A campaign is created as `draft`, and draft → active is the same write
           * as paused → active: it becomes the genome's active outcome. A separate
           * `campaign.activate` would be a second name for one state change, and
           * the two would drift the first time either grew a guard. What did need
           * fixing is this sentence, which said "paused" and so read as forbidding
           * the draft case it has always handled.
           */
          'Make a campaign active — activating one that has never run, or resuming one that was paused. ' +
          'Both mean it becomes the outcome SPARK plans against.',

    input: z.object({ campaignId: z.string().min(1) }),
    output: z.object({ campaignId: z.string(), status: CampaignStatus }),

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

/* ── campaign.rename ─────────────────────────────────────────────────── */

export const CampaignRenameInput = z.object({
  campaignId: z.string().min(1),
  /**
   * Trimmed and length-capped, and it may not be blank.
   *
   * A campaign with an empty name is unreachable on any screen that lists
   * campaigns by name, which is now every screen that lists them at all.
   */
  name: z.string().trim().min(1).max(120),
});

export const CampaignRenameOutput = z.object({ campaignId: z.string(), name: z.string() });

/**
 * The only field of a live campaign that is safe to edit.
 *
 * Everything else is either a term the owner approved — objective, window,
 * autonomy, accounts — or a snapshot taken under those terms (`plan`). Editing
 * one of those in place would leave the calendar it already produced
 * unexplained, which is why `campaign.duplicate` exists instead: running a
 * changed plan means a new campaign, not a mutated one.
 *
 * The name is the exception, and it needed a tool because campaigns were being
 * auto-named `"August campaign"` from the month at creation. Two campaigns
 * started in the same month were then indistinguishable in a list, which is the
 * point at which "I can't have multiple campaigns" stops being about storage.
 */
export const campaignRename = defineTool({
  name: 'campaign.rename',
  version: 1,

  summary:
    "Rename a campaign. Only the name changes — objective, window, autonomy and the approved plan are the " +
    'terms it was created under and are not editable (duplicate it instead). Free.',

  input: CampaignRenameInput,
  output: CampaignRenameOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Renaming to the same name twice is one outcome, not two decisions.
  idempotent: true,
  surfaces: ['CAL-01'],

  async handler(input, ctx) {
    const renamed = await ctx.db.campaigns.setName(input.campaignId, ctx.orgId, input.name);
    if (!renamed) {
      // Absent rather than forbidden, so probing an id cannot confirm a campaign
      // exists in another org.
      throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });
    }
    ctx.logger.info('campaign renamed', { campaignId: input.campaignId, by: ctx.userId ?? 'unknown' });
    return { campaignId: input.campaignId, name: renamed.name };
  },
});

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
  objective: Objective,
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
      /**
       * The copy keeps the original's autonomy.
       *
       * It was not copied before, which was survivable while the brand was the
       * fallback and is not now: an absent campaign mode means "requires
       * review", so duplicating an autopublishing campaign would have quietly
       * produced one that queues everything. "Run this exact approved plan
       * again" has to include the terms it was approved under.
       */
      ...(source.approvalMode ? { approvalMode: source.approvalMode } : {}),
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
