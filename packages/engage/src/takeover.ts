import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';

/**
 * `engage.takeover` — `engage.escalate`'s counterpart: a human is taking
 * direct control of this conversation themselves, right now, rather than
 * asking SPARK to flag it for later attention.
 *
 * ── Why it reuses `escalated` rather than getting its own status value ─────
 * The schema comment on `engagement_messages.status` (`packages/db/src/schema.ts`)
 * documents that a new value is safe to add here — no DB CHECK constraint, no
 * migration required. This tool doesn't take that option, on purpose: the one
 * consumer that cares about "is a human now handling this, not SPARK" is
 * `engage.audit.query`, and its spec fixes the resolved-status set at exactly
 * `replied | auto_handled | escalated | dismissed | converted`. A sixth value
 * here (e.g. `taken_over`) would silently drop every takeover from that sweep
 * — the opposite of what an oversight query is for. `escalated` already means
 * "a human, not SPARK, is now the one acting on this message" at the level of
 * granularity anything downstream queries on; *why* a human is now on it
 * (SPARK flagged it vs. a human grabbed it directly) is exactly what this
 * tool's own `why`/notification text carries, the same way `engage.escalate`'s
 * `reason` does, rather than needing a second status to say the same thing.
 * If a product need for that distinction shows up later, it's a one-line
 * status value plus adding it to `engage.audit.query`'s list — not a
 * migration, per the schema comment above.
 *
 * `effect: 'write'`, `autonomy: 'auto'`, `idempotent: true` — same reasoning
 * as `engage.escalate`: nothing leaves the workspace, taking over is always
 * safe to allow, and taking over an already-taken-over thread is a no-op.
 */

export const EngageTakeoverInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
});

export const EngageTakeoverOutput = z.object({
  messageId: z.string(),
  status: z.string(),
  why: Explanation,
});

export const engageTakeover = defineTool({
  name: 'engage.takeover',
  version: 1,

  summary:
    'Take direct control of one inbox conversation — stops SPARK from drafting, auto-handling, or acting ' +
    'on this message further. Always allowed; costs nothing to call.',

  input: EngageTakeoverInput,
  output: EngageTakeoverOutput,

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

    const message = await ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId);
    if (!message) {
      throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');
    }

    const updated = await ctx.db.engagement.markEscalated({
      id: message.id,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
    });
    if (!updated) {
      throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');
    }

    ctx.logger.info('a human took over an engagement conversation', { messageId: message.id, by: ctx.userId ?? 'unknown' });

    return {
      messageId: message.id,
      status: updated.status,
      why: {
        summary: 'A human took direct control of this conversation — SPARK will not draft, auto-handle, or act on it further.',
        factors: [{ label: 'Human takeover requested', weight: 1 }],
        evidence: [{ kind: 'metric' as const, id: message.id, note: message.text.slice(0, 200) }],
        alternatives: [{ option: 'Leave SPARK handling it', rejectedBecause: 'A human chose to take this conversation over directly.' }],
      },
    };
  },
});
