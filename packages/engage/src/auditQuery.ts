import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `engage.audit.query` — a compliance/oversight sweep: every engagement
 * action actually *taken* within a range, newest first. Deliberately close
 * in shape to `engage.list` (same row shape, same store underneath) but its
 * own tool rather than a mode of `list`: the query intent is different.
 * `engage.list` answers "what's in my feed right now" against one `status`
 * chosen by a UI tab; this answers "what happened" against a fixed set of
 * *resolved* statuses plus an optional date range `list` has no caller for.
 * Folding both into one tool would mean every `list` caller's input schema
 * grows a `since`/`until`/`statuses` it never uses, for a query shape it
 * never needs.
 *
 * "Resolved" = `status` is `replied | auto_handled | escalated | dismissed |
 * converted` — i.e. not `new`/`classified`, which are still open. Note
 * `engage.takeover` intentionally reuses `escalated` rather than minting its
 * own status value (see that tool's own comment), so takeovers are already
 * covered by this set without a sixth entry.
 *
 * No `why` on the tool itself — an audit query is an enumeration, not a
 * decision, the same reasoning `engage.list`/`genome.list` give for skipping
 * one. Each row still carries whatever `why` was set when it was classified.
 */

export const RESOLVED_ENGAGEMENT_STATUSES = ['replied', 'auto_handled', 'escalated', 'dismissed', 'converted'] as const;

export const EngageAuditQueryInput = z.object({
  genomeId: z.string().min(1),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const EngageAuditItem = z.object({
  id: z.string(),
  platform: z.string(),
  kind: z.string(),
  authorHandle: z.string(),
  authorName: z.string().optional(),
  text: z.string(),
  receivedAt: z.string(),
  status: z.string(),
  category: z.string().optional(),
  intentScore: z.number().optional(),
  suggestedReply: z.string().optional(),
  why: Explanation.optional(),
});

export const EngageAuditQueryOutput = z.object({ items: z.array(EngageAuditItem) });

export const engageAuditQuery = defineTool({
  name: 'engage.audit.query',
  version: 1,

  summary:
    'Every resolved engagement action (replied, auto-handled, escalated, dismissed, or converted) within an ' +
    'optional date range, newest first — the oversight sweep, distinct from the live feed engage.list reads. Free.',

  input: EngageAuditQueryInput,
  output: EngageAuditQueryOutput,

  effect: 'read',
  autonomy: 'auto',
  // Same read scopes as `engage.list`/`engage.eligibility.check`: an audit
  // sweep is not gated tighter than the feed it summarizes.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const rows = await ctx.db.engagement.audit(input.genomeId, ctx.orgId, {
      statuses: [...RESOLVED_ENGAGEMENT_STATUSES],
      ...(input.since ? { since: new Date(input.since) } : {}),
      ...(input.until ? { until: new Date(input.until) } : {}),
      limit: input.limit,
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        platform: r.platform,
        kind: r.kind,
        authorHandle: r.authorHandle,
        ...(r.authorName ? { authorName: r.authorName } : {}),
        text: r.text,
        receivedAt: r.receivedAt.toISOString(),
        status: r.status,
        ...(r.category ? { category: r.category } : {}),
        ...(r.intentScore !== undefined ? { intentScore: r.intentScore } : {}),
        ...(r.suggestedReply ? { suggestedReply: r.suggestedReply } : {}),
        ...(r.why ? { why: r.why } : {}),
      })),
    };
  },
});
