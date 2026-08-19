import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * THE KILL SWITCH — plan §4.4, PRD §6; `policy.ts` rule 1 (`agent.paused`).
 *
 * That rule has existed since P1:
 *
 *   `if (brand.agentPaused && caller === 'agent' && tool.effect !== 'read')`
 *
 * and until now nothing could set `agentPaused`. There was no column, no tool
 * and no control — the field was permanently `undefined`, so the one thing that
 * stops a misbehaving agent was unreachable and the only real remedy was
 * killing the API process.
 *
 * For a product whose entire pitch is unattended autonomy, "you can let it run
 * unsupervised" is only credible alongside "and you can stop it in one click".
 *
 * ── Two deliberate asymmetries ─────────────────────────────────────────────
 *
 * **Reads keep working while paused.** The rule already exempts `effect: read`,
 * and that is right: someone investigating *why* they paused the agent needs
 * the Timeline, the calendar and the queue to still load. Pausing stops the
 * agent from acting, not the owner from looking.
 *
 * **Pausing is easier than resuming.** `agent.pause` is available to editors;
 * `agent.resume` is not. Stopping something that looks wrong should be the
 * least gated action in the product, and restarting it is the decision that
 * deserves a second thought.
 */

const AgentStatus = z.object({
  brandId: z.string(),
  paused: z.boolean(),
  pausedAt: z.string().optional(),
  pausedBy: z.string().optional(),
  reason: z.string().optional(),
  /** Plain-language summary of what the agent may currently do. */
  effect: z.string(),
  /** The Command Center's frequency control needs a current value to show, not just a setter. */
  postsPerWeek: z.number(),
});

function describe(paused: boolean): string {
  return paused
    ? 'Paused. SPARK cannot publish, spend or send anything for this brand. Reading still works.'
    : 'Running. SPARK acts within this brand’s approval mode.';
}

/* ── agent.status ────────────────────────────────────────────────────── */

export const agentStatus = defineTool({
  name: 'agent.status',
  version: 1,

  summary: 'Whether SPARK is running or paused for this brand, and who paused it. Read-only, free.',

  input: z.object({}),
  output: AgentStatus,

  effect: 'read',
  autonomy: 'auto',
  // Everyone, including the agent itself: SPARK asking "am I paused?" is a
  // reasonable question and the answer is not sensitive.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(_input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const g = await ctx.db.brands.get(brandId, ctx.orgId);
    return {
      brandId,
      paused: g.agentPaused,
      ...(g.pausedAt ? { pausedAt: g.pausedAt.toISOString() } : {}),
      ...(g.pausedBy ? { pausedBy: g.pausedBy } : {}),
      ...(g.pauseReason ? { reason: g.pauseReason } : {}),
      effect: describe(g.agentPaused),
      postsPerWeek: g.postsPerWeek,
    };
  },
});

/* ── agent.pause ─────────────────────────────────────────────────────── */

export const agentPause = defineTool({
  name: 'agent.pause',
  version: 1,

  summary:
    'Stop SPARK acting for this brand — no publishing, spending or outbound messages. Reading keeps ' +
    'working. Takes effect on the next call.',

  input: z.object({ reason: z.string().max(280).optional() }),
  output: AgentStatus,

  effect: 'write',
  /**
   * `human_only`. An agent that could pause itself is harmless; one that could
   * pause a *different* brand's agent, or unpause itself later in the same run,
   * is not — and the simplest rule that forecloses both is that the kill switch
   * is never the agent's to touch.
   */
  autonomy: 'human_only',
  // Editors included, deliberately. Whoever notices the problem should be able
  // to stop it without finding an admin first.
  scopes: ['owner', 'admin', 'editor', 'approver'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const by = ctx.userId;
    if (!by) throw new ToolError('FORBIDDEN', 'Pausing must be attributable to a person.');

    const g = await ctx.db.brands.setAgentPaused({
      brandId,
      orgId: ctx.orgId,
      paused: true,
      by,
      ...(input.reason ? { reason: input.reason } : {}),
    });

    ctx.logger.warn('agent paused', { brandId, by, reason: input.reason });

    return {
      brandId,
      paused: g.agentPaused,
      ...(g.pausedAt ? { pausedAt: g.pausedAt.toISOString() } : {}),
      ...(g.pausedBy ? { pausedBy: g.pausedBy } : {}),
      ...(g.pauseReason ? { reason: g.pauseReason } : {}),
      effect: describe(g.agentPaused),
      postsPerWeek: g.postsPerWeek,
    };
  },
});

/* ── agent.resume ────────────────────────────────────────────────────── */

export const agentResume = defineTool({
  name: 'agent.resume',
  version: 1,

  summary: 'Let SPARK act for this brand again, under its current approval mode.',

  input: z.object({}),
  output: AgentStatus,

  effect: 'write',
  autonomy: 'human_only',
  // Narrower than pause on purpose — see the file header.
  scopes: ['owner', 'admin', 'approver'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(_input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const by = ctx.userId;
    if (!by) throw new ToolError('FORBIDDEN', 'Resuming must be attributable to a person.');

    const g = await ctx.db.brands.setAgentPaused({ brandId, orgId: ctx.orgId, paused: false, by });
    ctx.logger.warn('agent resumed', { brandId, by });

    return { brandId, paused: g.agentPaused, effect: describe(g.agentPaused), postsPerWeek: g.postsPerWeek };
  },
});

/**
 * The kill switch is per brand, not per org: in an agency workspace one
 * client's agent going wrong is not a reason to freeze the other thirty-nine.
 * So a brand has to be selected, and guessing one would be the wrong kind of
 * helpful.
 */
function requireBrand(brandId: string | undefined): string {
  if (!brandId) throw new ToolError('INVALID_INPUT', 'A brand must be selected.');
  return brandId;
}

/* ── agent.frequency.set ─────────────────────────────────────────────── */

/**
 * The bounds on how loud an account can be.
 *
 * `1` because zero is not a frequency — an owner who wants nothing published
 * wants `agent.pause`, and encoding "off" twice means the Command Center can
 * show a running agent set to post nothing, which reads as a bug.
 *
 * `14` because twice a day is past the point where the mix engine can keep a
 * week varied from a realistic Asset Graph: beyond it every additional slot is
 * filled by repeating a format, which is the specific failure the calendar's
 * spacing floor exists to prevent. An owner who genuinely wants more is telling
 * us the capture loop is under-supplied, and the honest answer is the gap
 * report, not a bigger number.
 */
const MIN_POSTS_PER_WEEK = 1;
const MAX_POSTS_PER_WEEK = 14;

const FrequencyOutput = z.object({
  brandId: z.string(),
  postsPerWeek: z.number(),
  /** Plain-language reading of the cadence, for the control's caption. */
  effect: z.string(),
  why: Explanation,
});

export const agentFrequencySet = defineTool({
  name: 'agent.frequency.set',
  version: 1,

  summary:
    'Set how many posts a week SPARK aims to publish for this brand. Shapes every calendar ' +
    'generated afterwards. Does not stop the agent — use agent.pause for that.',

  input: z.object({
    postsPerWeek: z.number().int().min(MIN_POSTS_PER_WEEK).max(MAX_POSTS_PER_WEEK),
  }),
  output: FrequencyOutput,

  effect: 'write',
  /**
   * `auto`, unlike pause and resume.
   *
   * Frequency is a content decision, and SPARK lowering it because the Asset
   * Graph cannot supply the current cadence is exactly the kind of judgement
   * the product is for. The kill switch is `human_only` because it is a *safety*
   * control; conflating the two would either make the agent unable to do its
   * job or able to un-stop itself.
   */
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const before = await ctx.db.brands.get(brandId, ctx.orgId);

    const g = await ctx.db.brands.setFrequency({
      brandId,
      orgId: ctx.orgId,
      postsPerWeek: input.postsPerWeek,
      by: ctx.userId ?? 'agent',
    });

    ctx.logger.info('frequency set', {
      brandId,
      from: before.postsPerWeek,
      to: g.postsPerWeek,
    });

    return {
      brandId,
      postsPerWeek: g.postsPerWeek,
      effect: describeFrequency(g.postsPerWeek),
      why: explainFrequency(before.postsPerWeek, g.postsPerWeek),
    };
  },
});

function describeFrequency(n: number): string {
  if (n === 1) return 'One post a week.';
  if (n === 7) return 'One post a day.';
  if (n > 7) return `${n} posts a week — more than one a day.`;
  return `${n} posts a week.`;
}

/**
 * Invariant 4: this is a decision a user sees SPARK make, so it carries a `why`.
 *
 * The alternative worth naming is the one people actually reach for — turning
 * the number down when they mean stop. Those are different actions with
 * different consequences (a quieter account still publishes; a paused one does
 * not), and the Command Center puts them side by side.
 */
function explainFrequency(from: number, to: number): Explanation {
  const direction = to > from ? 'more often' : to < from ? 'less often' : 'unchanged';

  return {
    summary:
      to === from
        ? `Still ${to} post${to === 1 ? '' : 's'} a week.`
        : `Posting ${direction} — ${from} → ${to} a week.`,
    factors: [
      { label: 'was', detail: `${from}/week` },
      { label: 'now', detail: `${to}/week` },
      { label: 'applies to', detail: 'calendars generated from now on, not slots already scheduled' },
    ],
    evidence: [
      { kind: 'rule', id: 'brand.posts_per_week', note: 'read by calendar generation' },
    ],
    alternatives:
      to < from
        ? [
            {
              option: 'Pause the agent',
              rejectedBecause: 'you asked for fewer posts, not none — a quieter account still publishes',
            },
          ]
        : [],
  };
}
