import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import {
  EngagementPlatform,
  ToolError,
  Explanation,
  resolveSalesHandoff,
  salesAssistApplies,
  salesRouteFor,
} from '@sparksocial/shared';
import { resolveEngagementEligibility } from './eligibility.js';

/**
 * `engage.opportunity.create` / `.route` — the master plan's own schema
 * sketch (`docs/MASTER_BUILD_PLAN.md`, §3.2's "opportunities" table:
 * "inbox_item_id, temperature(hot|warm|cold), recommended_action,
 * routed_to"), built as a genuinely separate table
 * (`packages/db/src/schema.ts`'s `opportunities`) rather than columns on
 * `engagement_messages` — see that table's own comment for why.
 *
 * Both tools are `effect: 'write'` / `autonomy: 'auto'`: raising or routing a
 * lead changes nothing outside the workspace, so neither needs `policy.ts`
 * rule 6's engagement-publish gate. `create` is `idempotent: false` (calling
 * it twice makes two real leads against the same message, a genuine
 * duplicate, not a refresh); `route` is `idempotent: true` (routing again
 * just updates the destination — the same "re-pointing, not re-doing"
 * reasoning `content.schedule`'s move gets).
 *
 * `routedTo` is deliberately a free-text string, not a structured reference —
 * there is no CRM integration to build here yet, same "seam, not a system"
 * choice `ReplySender` makes for per-platform reply delivery.
 */

const Temperature = z.enum(['hot', 'warm', 'cold']);

/* ── engage.opportunity.create ───────────────────────────────────────── */

export const EngageOpportunityCreateInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
  temperature: Temperature,
  recommendedAction: z.string().min(1).max(600),
});

export const EngageOpportunityCreateOutput = z.object({
  opportunityId: z.string(),
  messageId: z.string(),
  temperature: Temperature,
  recommendedAction: z.string(),
  /**
   * Where this lead was sent, when the brand's Sales Assist handoff rule named a
   * destination. Absent means it is sitting in the Sales Opportunities tab, which
   * is the honest state for `save_notify` and `nurture_only`.
   */
  routedTo: z.string().optional(),
  /** Which handoff rule applied — `crm_notify` | `save_notify` | `nurture_only`. */
  handoff: z.string(),
  why: Explanation,
});

export const engageOpportunityCreate = defineTool({
  name: 'engage.opportunity.create',
  version: 1,

  summary:
    'Raise a sales opportunity from an inbox message already classified sales_opportunity — records ' +
    'temperature and a recommended next action for the Sales Opportunities tab.',

  input: EngageOpportunityCreateInput,
  output: EngageOpportunityCreateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: false,

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const message = await ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId);
    if (!message) {
      throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');
    }

    if (message.category !== 'sales_opportunity') {
      throw new ToolError(
        'INVALID_INPUT',
        'Only messages the classifier put in the sales_opportunity category can be raised as an opportunity.',
        { messageId: message.id, category: message.category ?? null },
      );
    }

    const opportunity = await ctx.db.opportunities.create({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      inboxItemId: message.id,
      temperature: input.temperature,
      recommendedAction: input.recommendedAction,
    });

    /**
     * `Settings WS EI Sales`'s handoff rule, applied.
     *
     * Before this, a raised opportunity always sat unrouted until somebody
     * called `.route` by hand — which made "Hot → send to CRM + notify me" a
     * sentence on a settings screen and nothing else.
     *
     * Routing reuses the existing `.route` write rather than taking a
     * `routedTo` on `create`: the row genuinely is created and *then* routed,
     * and keeping one writer for `routed_to` means re-routing later cannot
     * diverge from routing now.
     */
    const brand = ctx.brandId ? await ctx.db.brands.get(ctx.brandId, ctx.orgId) : undefined;
    const handoff = resolveSalesHandoff(brand?.salesHandoff);

    /**
     * The handoff rule applies only on the top rung — the narrow half of
     * "four rungs, config on top" (decided 22 August).
     *
     * A campaign set to `observe`, `suggest` or `auto_reply` has not asked the
     * agent to work leads, so routing one to a CRM on its behalf would be the
     * agent doing something the campaign declined. The opportunity is still
     * *raised* either way — recording that somebody sounded like a customer is
     * not sales assistance, it is bookkeeping — it simply waits in the tab.
     *
     * Note what is deliberately *not* gated: the escalation keyword list in
     * `engage.classify`. That is a floor rather than a feature, and a refund
     * demand is exactly as dangerous on `auto_reply` as on `sales_assist` — see
     * `salesAssistApplies` in `campaignAutonomy.ts`.
     */
    const eligibility = await resolveEngagementEligibility(ctx, input.genomeId);
    const assisting = salesAssistApplies(eligibility.rung);
    const destination = assisting
      ? salesRouteFor(input.temperature, handoff, brand?.salesDestination)
      : undefined;

    if (destination) {
      await ctx.db.opportunities.route({
        id: opportunity.id,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        routedTo: destination,
      });
    }

    ctx.logger.info('raised a sales opportunity', {
      opportunityId: opportunity.id,
      messageId: message.id,
      handoff: handoff[input.temperature],
      routed: Boolean(destination),
    });

    return {
      opportunityId: opportunity.id,
      messageId: message.id,
      temperature: input.temperature,
      recommendedAction: input.recommendedAction,
      ...(destination ? { routedTo: destination } : {}),
      handoff: handoff[input.temperature],
      why: {
        summary: destination
          ? `Raised as a ${input.temperature} opportunity and sent to ${destination}: ${input.recommendedAction}`
          : `Raised as a ${input.temperature} opportunity: ${input.recommendedAction}`,
        factors: [
          { label: 'Classified sales_opportunity', weight: message.intentScore ?? 1 },
          { label: `Temperature: ${input.temperature}`, weight: input.temperature === 'hot' ? 1 : input.temperature === 'warm' ? 0.5 : 0 },
          {
            label: `Handoff rule: ${handoff[input.temperature]}`,
            /**
             * The reason has to name the cause that actually applied, or
             * somebody will go and change a handoff rule and watch nothing
             * happen. Three distinct causes, in the order they are checked.
             */
            detail: destination
              ? `sent to ${destination}`
              : !assisting
                ? `this campaign is on the ${eligibility.rung ?? 'observe'} rung, so handoff rules do not apply yet`
                : handoff[input.temperature] === 'crm_notify'
                  ? 'no destination is set, so it waits in the Sales Opportunities tab'
                  : brand?.salesHandoff
                    ? 'kept in the Sales Opportunities tab'
                    : 'this brand has not set its own handoff rules, so the defaults applied',
          },
        ],
        evidence: [{ kind: 'metric' as const, id: message.id, note: message.text.slice(0, 200) }],
        alternatives: [],
      },
    };
  },
});

/* ── engage.opportunity.route ────────────────────────────────────────── */

/**
 * `engage.opportunity.list` — the read this table never had.
 *
 * `opportunities` shipped with `create` and `route` and no way to enumerate, so
 * the Sales Opportunities tab listed **messages the classifier put in the
 * category** instead. Those are different sets, and the difference is the point
 * of the table: a message can sit in `sales_opportunity` forever without anyone
 * judging it a real lead, and an opportunity carries the temperature and the
 * recommended action that a message does not.
 *
 * An enumeration, so no `why` on the tool itself — same reasoning `engage.list`
 * gives. The decisions here were made by `engage.classify` (the category) and by
 * whoever called `create` (the temperature), and each row carries the evidence of
 * both: the message text, the classifier's `intentScore`, and where the handoff
 * rule sent it.
 */

export const EngageOpportunityListInput = z.object({
  genomeId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(25),
  /** Narrow to one temperature — the cockpit's "hot leads only" read. */
  temperature: Temperature.optional(),
});

const OpportunityListItem = z.object({
  opportunityId: z.string(),
  messageId: z.string(),
  temperature: Temperature,
  recommendedAction: z.string(),
  routedTo: z.string().optional(),
  raisedAt: z.string(),
  /** From the message behind it. Absent only if that message is unreadable. */
  platform: EngagementPlatform.optional(),
  authorHandle: z.string().optional(),
  authorName: z.string().optional(),
  messageText: z.string().optional(),
  intentScore: z.number().optional(),
  receivedAt: z.string().optional(),
});

export const EngageOpportunityListOutput = z.object({
  items: z.array(OpportunityListItem),
  /** How many of each temperature exist — the badge counts, without a second pass. */
  counts: z.object({ hot: z.number().int(), warm: z.number().int(), cold: z.number().int() }),
});

export const engageOpportunityList = defineTool({
  name: 'engage.opportunity.list',
  version: 1,

  summary:
    'List sales opportunities raised for a genome, newest first, each with the inbox message behind it ' +
    'and where the handoff rule routed it. Free.',

  input: EngageOpportunityListInput,
  output: EngageOpportunityListOutput,

  effect: 'read',
  autonomy: 'auto',
  // Same scopes as `engage.list`: a lead is a message somebody judged, and
  // reading the judgement is not gated tighter than reading the message.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    /**
     * Filtered after the read rather than in SQL, deliberately: `counts` has to
     * describe the whole set, or the badges would report the filter back to
     * itself ("0 warm" while looking at the hot ones). The limit caps this at a
     * hundred rows, so it is a hundred-element filter and not a scan.
     */
    const rows = await ctx.db.opportunities.listForGenome(input.genomeId, ctx.orgId, input.limit);

    const counts = { hot: 0, warm: 0, cold: 0 };
    for (const row of rows) {
      if (row.temperature === 'hot') counts.hot += 1;
      else if (row.temperature === 'warm') counts.warm += 1;
      else counts.cold += 1;
    }

    const items = (input.temperature ? rows.filter((r) => r.temperature === input.temperature) : rows).map(
      (row) => ({
        opportunityId: row.id,
        messageId: row.inboxItemId,
        temperature: row.temperature,
        recommendedAction: row.recommendedAction,
        ...(row.routedTo ? { routedTo: row.routedTo } : {}),
        raisedAt: row.createdAt.toISOString(),
        ...(row.platform ? { platform: row.platform } : {}),
        ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
        ...(row.authorName ? { authorName: row.authorName } : {}),
        ...(row.messageText ? { messageText: row.messageText } : {}),
        ...(row.intentScore !== undefined ? { intentScore: row.intentScore } : {}),
        ...(row.receivedAt ? { receivedAt: row.receivedAt.toISOString() } : {}),
      }),
    );

    return { items, counts };
  },
});

export const EngageOpportunityRouteInput = z.object({
  genomeId: z.string().min(1),
  opportunityId: z.string().min(1),
  routedTo: z.string().min(1).max(200),
});

export const EngageOpportunityRouteOutput = z.object({
  opportunityId: z.string(),
  routedTo: z.string(),
  why: Explanation,
});

export const engageOpportunityRoute = defineTool({
  name: 'engage.opportunity.route',
  version: 1,

  summary:
    'Route a sales opportunity to a destination — a person, an email, a CRM reference. Free text; no CRM ' +
    'integration exists yet. Re-routing just updates the destination.',

  input: EngageOpportunityRouteInput,
  output: EngageOpportunityRouteOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const existing = await ctx.db.opportunities.get(input.opportunityId, input.genomeId, ctx.orgId);
    if (!existing) {
      throw new ToolError('NOT_FOUND', 'No opportunity with that id in this genome.');
    }

    const updated = await ctx.db.opportunities.route({
      id: input.opportunityId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      routedTo: input.routedTo,
    });
    if (!updated) {
      throw new ToolError('NOT_FOUND', 'No opportunity with that id in this genome.');
    }

    ctx.logger.info('routed a sales opportunity', { opportunityId: updated.id, routedTo: input.routedTo });

    return {
      opportunityId: updated.id,
      routedTo: input.routedTo,
      why: {
        summary: `Routed to ${input.routedTo}.`,
        factors: [{ label: 'Manual routing decision', weight: 1 }],
        evidence: [{ kind: 'metric' as const, id: updated.id, note: input.routedTo }],
        alternatives: [],
      },
    };
  },
});

