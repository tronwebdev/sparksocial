import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentPillar, Explanation, Objective, ToolError } from '@sparksocial/shared';
import type { AssetInventory } from '@sparksocial/playbooks';
import { planCampaign, type CampaignPlan } from './plan.js';

/**
 * `campaign.propose_plan` — engine spec §6.8, Steps 2–3; PRD `CMP-01.2`/`CMP-01.3`.
 *
 * The user states an outcome; this answers with a plan and, crucially, with the
 * gap. Read-only: proposing is not committing, and the calendar is written by a
 * later step the user reaches only after reviewing this.
 */

const CAMPAIGN_MIN_DAYS = 7;
const CAMPAIGN_MAX_DAYS = 90;

export const ProposePlanInput = z.object({
  genomeId: z.string().min(1),
  /** The campaign's own objective, which need not match the genome's standing one. */
  objective: Objective,
  windowDays: z.number().int().min(CAMPAIGN_MIN_DAYS).max(CAMPAIGN_MAX_DAYS).default(30),
});

export const ProposePlanOutput = z.object({
  objective: Objective,
  windowDays: z.number(),
  buildableNow: z.number(),
  potentialWithCapture: z.number(),
  mix: z.array(z.object({ pillar: ContentPillar, count: z.number() })),
  mixSource: z.enum(['cold_start', 'learned']),
  capture: z
    .object({
      playbookIds: z.array(z.string()),
      missingRoles: z.array(z.string()),
      sittings: z.number(),
      minutesPerSitting: z.number(),
    })
    .nullable(),
  readyPlaybookIds: z.array(z.string()),
  why: Explanation,
});

export const campaignProposePlan = defineTool({
  name: 'campaign.propose_plan',
  version: 1,

  summary:
    'Propose a campaign for an outcome: how many posts are possible now, how many more if the owner ' +
    'films, the pillar mix and the reasoning. Proposes only — schedules nothing. Free.',

  input: ProposePlanInput,
  output: ProposePlanOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver'],
  idempotent: true,
  surfaces: ['CMP-01.2', 'CMP-01.3'],

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

    const inventory = (await ctx.db.assets.inventory(input.genomeId, ctx.orgId)) as AssetInventory;
    const plan = planCampaign({ genome, inventory, objective: input.objective, windowDays: input.windowDays });

    ctx.logger.info('campaign plan proposed', {
      genomeId: input.genomeId,
      objective: input.objective,
      buildableNow: plan.buildableNow,
      potentialWithCapture: plan.potentialWithCapture,
    });

    return { ...plan, why: explain(plan) };
  },
});

/**
 * Invariant 4. This particular `why` does more work than most: §6.8 Step 3 says
 * *"stating the reasoning, exposing the gap honestly, and quantifying human
 * effort is what converts"* — so the explanation is the feature, not commentary
 * on it. It leads with the gap rather than burying it under the good news.
 */
function explain(plan: CampaignPlan): Explanation {
  const { capture, buildableNow, potentialWithCapture } = plan;

  const summary = capture
    ? `${buildableNow} posts from what you have now — ${potentialWithCapture} if you film ` +
      `${capture.sittings} × ${capture.minutesPerSitting} minutes, one sitting a week.`
    : `${buildableNow} posts, all buildable from assets you already have. No filming needed.`;

  return {
    summary,
    factors: [
      { label: 'objective', detail: plan.objective },
      { label: 'window', detail: `${plan.windowDays} days` },
      { label: 'mix', detail: plan.mix.filter((s) => s.count > 0).map((s) => `${s.pillar} ${s.count}`).join(' · ') },
      { label: 'mix source', detail: plan.mixSource === 'learned' ? "this account's own results" : 'cold-start ratio' },
      ...(capture
        ? [{ label: 'unlocked by filming', detail: capture.missingRoles.join(', ') || `${capture.playbookIds.length} formats` }]
        : []),
    ],
    evidence: [
      { kind: 'rule', id: 'mix.derive', note: plan.mixWhy },
      ...plan.readyPlaybookIds.slice(0, 5).map((id) => ({ kind: 'rule' as const, id, note: 'buildable today' })),
    ],
    // The rejected option is the one the user is implicitly weighing: post more
    // by filming nothing. Naming it, with the real cost, is the honest framing
    // Step 3 asks for.
    alternatives: capture
      ? [
          {
            option: `Post ${potentialWithCapture} without filming`,
            rejectedBecause: `${capture.playbookIds.length} of those formats need assets that do not exist yet`,
          },
        ]
      : [],
  };
}
