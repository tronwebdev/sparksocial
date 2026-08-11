import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

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

    return { brandId, paused: g.agentPaused, effect: describe(g.agentPaused) };
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
