import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentPillar, Explanation, Objective, ToolError, genomeRequirement, genomeRequirementWordList } from '@sparksocial/shared';
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
  /**
   * What the brand has not told us yet, and what saying it would buy.
   *
   * Surfaced on the *proposal* rather than discovered at draft time, which is the
   * whole point of the field. `planBeat` has always refused a beat whose genome
   * path is empty — correctly, since rendering a blank CTA frame is worse than
   * refusing — but it refuses at the moment somebody opens a post, one week and
   * three screens after the campaign that scheduled it. This is the same fact,
   * moved to where it is still cheap.
   */
  answers: z
    .object({
      missingPaths: z.array(z.string()),
      /** Ready for a screen: "a call to action". */
      missing: z.array(
        z.object({ path: z.string(), label: z.string(), hint: z.string(), fixWith: z.string() }),
      ),
      unlocksPosts: z.number(),
      blockedPlaybooks: z.number(),
    })
    .nullable(),
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

    return {
      ...plan,
      // Words attached here rather than in the component, because the campaign
      // wizard, the calendar's empty state and the draft panel all have to say
      // the same thing, and three copies of "a call to action" is three chances
      // to disagree about it.
      answers: plan.answers
        ? {
            ...plan.answers,
            missing: plan.answers.missingPaths.map((path) => ({ path, ...genomeRequirement(path) })),
          }
        : null,
      why: explain(plan),
    };
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

  const { answers } = plan;

  /**
   * The answers gap leads, ahead of the capture ask.
   *
   * Not for emphasis — for sequence. It is the cheapest thing to fix and it
   * blocks the most formats, so a summary that opened with "film four sittings"
   * while an empty CTA was holding fourteen posts would be telling somebody to
   * spend a Saturday on the second-most-useful thing they could do.
   */
  const summary = answers
    ? `${buildableNow} posts from what you have now. Add ${genomeRequirementWordList(answers.missingPaths)} ` +
      `and that becomes ${buildableNow + answers.unlocksPosts} — ${answers.blockedPlaybooks} formats are ` +
      `waiting on it.`
    : capture
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
      ...(answers
        ? [
            {
              label: 'waiting on you',
              detail:
                `${genomeRequirementWordList(answers.missingPaths)} — ${answers.blockedPlaybooks} formats read it ` +
                `directly and cannot be built until it is set (${answers.missingPaths.map((p) => genomeRequirement(p).fixWith).join(', ')})`,
            },
          ]
        : []),
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
    alternatives: answers
      ? [
          {
            option: `Start now with ${buildableNow} posts`,
            rejectedBecause:
              `${answers.blockedPlaybooks} formats read ${genomeRequirementWordList(answers.missingPaths)} ` +
              `straight from your brand and would be refused at draft time`,
          },
        ]
      : capture
      ? [
          {
            option: `Post ${potentialWithCapture} without filming`,
            rejectedBecause: `${capture.playbookIds.length} of those formats need assets that do not exist yet`,
          },
        ]
      : [],
  };
}
