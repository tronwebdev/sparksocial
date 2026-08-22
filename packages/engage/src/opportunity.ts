import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation, resolveSalesHandoff, salesRouteFor } from '@sparksocial/shared';

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
    const destination = salesRouteFor(input.temperature, handoff, brand?.salesDestination);

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
            detail: destination
              ? `sent to ${destination}`
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
