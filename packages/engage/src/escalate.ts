import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';

/**
 * `engage.escalate` — a message needs a human's attention beyond the normal
 * review queue: hostile, sensitive, legally loaded, or something the
 * classifier flagged as ambiguous rather than confidently sorted.
 *
 * `effect: 'write'`, not `'publish'`: nothing leaves the workspace, so
 * `policy.ts` rule 6 (engagement replies) does not apply — this is a status
 * flip plus a notification, not a send. `autonomy: 'auto'`: escalating is
 * always the safe direction to err in, the opposite of the risk the
 * autonomy ladder exists to gate.
 *
 * `idempotent: true`: escalating the same message twice is a no-op, not a
 * second distinct action the way sending a second reply would be — the
 * message is either already flagged for a human or it isn't.
 *
 * Reuses `HumanLoopStore` (`ctx.db.humanLoop`, the same store `human.notify`
 * writes to in `packages/campaign/src/humanLoop.ts`) rather than only
 * flipping the row's `status` column — a status change nobody is told about
 * is not an escalation, it's a silent flag on a row nobody is looking at.
 */

export const EngageEscalateInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
  reason: z.string().min(1).max(600),
});

export const EngageEscalateOutput = z.object({
  messageId: z.string(),
  status: z.string(),
  notified: z.boolean(),
  why: Explanation,
});

export const engageEscalate = defineTool({
  name: 'engage.escalate',
  version: 1,

  summary:
    'Flag one inbox message for a human beyond the normal review queue — hostile, sensitive, or ambiguous. ' +
    'Notifies the owner and marks the message escalated. Always allowed; costs nothing to call.',

  input: EngageEscalateInput,
  output: EngageEscalateOutput,

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

    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', 'No genome with that id in this org.');
    }

    const notification = await ctx.db.humanLoop.create({
      brandId: genome.workspace_id,
      orgId: ctx.orgId,
      kind: 'notify',
      body: `Escalated a message from ${message.authorHandle} on ${message.platform}: ${input.reason}`,
      urgency: 'normal',
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    });

    const updated = await ctx.db.engagement.markEscalated({
      id: message.id,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
    });
    if (!updated) {
      ctx.logger.error('escalation notified but engagement_messages was not updated — status may show stale', {
        messageId: message.id,
      });
    }

    ctx.logger.info('escalated an engagement message', { messageId: message.id, notificationId: notification.id });

    return {
      messageId: message.id,
      status: updated?.status ?? 'escalated',
      notified: true,
      why: {
        summary: `Escalated to the owner: ${input.reason}`,
        factors: [{ label: 'Escalation reason', weight: 1, detail: input.reason }],
        evidence: [{ kind: 'metric' as const, id: message.id, note: message.text.slice(0, 200) }],
        alternatives: [{ option: 'Leave in the normal review queue', rejectedBecause: input.reason }],
      },
    };
  },
});
