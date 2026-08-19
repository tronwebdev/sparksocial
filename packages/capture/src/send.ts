import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { CaptureBrief } from './schema.js';
import type { MessageTransport } from './transport.js';

/**
 * `direct.session.send` — the last hop of the capture loop (§6.3).
 *
 *   `direct.session.batch → **direct.session.send** → owner films → media.ingest`
 *
 * Everything before this is planning; this is the step that costs an owner
 * their attention. Two consequences shape the contract:
 *
 * **It is `effect: 'external'` and NOT idempotent.** Sending the same weekly
 * session twice is not a duplicate row in a table, it is nagging a small
 * business owner — which §6.3 names as the specific behaviour that makes them
 * stop responding. So it declares `idempotent: false` and requires an
 * idempotency key, and `invokeTool` replays the first result instead of
 * sending again.
 *
 * **Autonomy is `auto`.** A weekly capture ask is the product working as
 * intended; routing it through an approval queue would mean the owner has to
 * approve being asked to do the thing they subscribed for.
 */

export const SessionSendInput = z.object({
  genomeId: z.string().min(1),
  /**
   * Where to reach the owner. Passed in rather than read from the genome
   * because the genome has no contact field yet, and inventing one here would
   * put personal data in a record whose schema is set by §3.2.
   */
  to: z.string().min(3).max(64),
  briefs: z.array(CaptureBrief).min(1).max(5),
  totalEffortSec: z.number().min(1),
});

export const SessionSendOutput = z.object({
  messageId: z.string(),
  channel: z.string(),
  /** Never the raw number: this lands in `tool_calls`. */
  toRedacted: z.string(),
  briefCount: z.number(),
});

/** §6.3's five-minute budget, enforced at the point of sending, not only when batching. */
const SESSION_BUDGET_SEC = 5 * 60;

export function makeSessionSend(transport: MessageTransport) {
  return defineTool({
    name: 'direct.session.send',
    version: 1,

    summary:
      'Send this week’s capture session to the owner over WhatsApp. Costs their attention, so it runs ' +
      'once a week — never per brief. Requires an idempotency key.',

    input: SessionSendInput,
    output: SessionSendOutput,

    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // The whole point: a retried call must not re-nag.
    idempotent: false,

    async handler(input, ctx) {
      // Re-checked here even though `direct.session.batch` already budgets, because
      // this tool is reachable on its own — by SPARK, or by a caller assembling
      // briefs another way — and the budget is the promise the product makes to
      // the owner, not an implementation detail of the batcher.
      if (input.totalEffortSec > SESSION_BUDGET_SEC) {
        throw new ToolError(
          'INVALID_INPUT',
          `Session asks for ${input.totalEffortSec}s of filming, over the ${SESSION_BUDGET_SEC}s weekly budget.`,
          { totalEffortSec: input.totalEffortSec, budgetSec: SESSION_BUDGET_SEC },
        );
      }

      const result = await transport.sendSession({
        to: input.to,
        genomeId: input.genomeId,
        briefs: input.briefs,
        totalEffortSec: input.totalEffortSec,
      });

      // Logged with the redacted recipient — the raw number must not reach logs
      // any more than it reaches the audit row.
      ctx.logger.info('capture session sent', {
        genomeId: input.genomeId,
        channel: result.channel,
        to: result.toRedacted,
        briefCount: input.briefs.length,
      });

      return {
        messageId: result.messageId,
        channel: result.channel,
        toRedacted: result.toRedacted,
        briefCount: input.briefs.length,
      };
    },
  });
}
