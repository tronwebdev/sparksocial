import { z } from 'zod';
import { ToolError } from '@sparksocial/shared';
import { defineTool } from './defineTool.js';
import type { InvokeResult } from './invoke.js';

/**
 * THE REVIEW QUEUE — PRD §7.5 ("queues are first-class"), plan §4.4.
 *
 * Before these existed, `review_first_week` and `review_everything` gated calls
 * into nothing: `invokeTool` wrote a `gated` audit row and returned, and there
 * was no way to see what was held or to let it through. The approval ladder was
 * a policy outcome with no product attached — a brand could be put into review
 * mode and then never review anything.
 *
 * These two tools close that loop, and they are tools rather than routes for the
 * usual reason (invariant 1): approving a held publish is a capability, and SPARK
 * needs to be able to *ask* about the queue even though it must never decide.
 */

/* ── queue.review.list ───────────────────────────────────────────────── */

export const QueueReviewListInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
});

export const QueueReviewListOutput = z.object({
  items: z.array(
    z.object({
      callId: z.string(),
      tool: z.string(),
      /** Why the policy engine held it. This is what the reviewer is deciding on. */
      ruleId: z.string().optional(),
      reason: z.string().optional(),
      requestedAt: z.string(),
      requestedBy: z.string().optional(),
      genomeId: z.string().optional(),
      input: z.unknown(),
    }),
  ),
});

export const queueReviewList = defineTool({
  name: 'queue.review.list',
  version: 1,

  summary:
    'Everything waiting for a human decision on this brand — what SPARK wanted to do, and which rule ' +
    'held it. Read-only, free.',

  input: QueueReviewListInput,
  output: QueueReviewListOutput,

  effect: 'read',
  autonomy: 'auto',
  // Readable by everyone. A queue only a decider can see is a queue nobody
  // knows is backing up, and the rows are already org-scoped by the store.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const items = await ctx.db.approvals.pending(ctx.orgId, ctx.brandId, input.limit);
    return {
      items: items.map((a) => ({
        callId: a.callId,
        tool: a.tool,
        requestedAt: a.requestedAt.toISOString(),
        input: a.input,
        ...(a.ruleId ? { ruleId: a.ruleId } : {}),
        ...(a.reason ? { reason: a.reason } : {}),
        ...(a.requestedBy ? { requestedBy: a.requestedBy } : {}),
        ...(a.genomeId ? { genomeId: a.genomeId } : {}),
      })),
    };
  },
});

/* ── approval.decide ─────────────────────────────────────────────────── */

export const ApprovalDecideInput = z.object({
  callId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  /** Optional note, recorded for the audit trail. */
  note: z.string().max(500).optional(),
});

export const ApprovalDecideOutput = z.object({
  callId: z.string(),
  decision: z.enum(['approve', 'reject']),
  /** Present only on approve — the outcome of actually running the held call. */
  executed: z
    .object({
      status: z.enum(['succeeded', 'gated', 'failed']),
      newCallId: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
});

/**
 * Replays the held call once a human has said yes.
 *
 * Injected rather than importing `invokeTool` directly, because executing needs
 * the *deps* — the audit sink, the guardrail runner — which only the
 * application layer has assembled. Handing this tool a function keeps
 * `packages/tools` free of any opinion about where those come from.
 */
export function makeApprovalDecide(deps: {
  execute: (args: { callId: string; grantedBy: string; ctx: unknown }) => Promise<InvokeResult>;
}) {
  return defineTool({
    name: 'approval.decide',
    version: 1,

    summary:
      'Approve or reject a held action. Approving runs the original call exactly as it was requested — ' +
      'nothing about it can be edited here.',

    input: ApprovalDecideInput,
    output: ApprovalDecideOutput,

    effect: 'write',
    // `human_only`: the whole point of a review queue is that a person decides.
    // An agent that could approve its own held calls would make every approval
    // mode a no-op — this is the single most important line in the file.
    autonomy: 'human_only',
    // Deciding is a governance act. Editors can create work; only these roles
    // can release it.
    scopes: ['owner', 'admin', 'approver'],
    idempotent: false,
    surfaces: ['CC-01'],

    async handler(input, ctx) {
      const userId = ctx.userId;
      if (!userId) {
        // `human_only` already blocks the agent, but a user session with no id
        // would leave the audit trail unable to say who approved it.
        throw new ToolError('FORBIDDEN', 'An approval must be attributable to a person.');
      }

      const pending = await ctx.db.approvals.get(input.callId, ctx.orgId);
      if (!pending) throw new ToolError('NOT_FOUND', 'No such approval.', { callId: input.callId });

      // Resolve first. If execution then fails, the item is still decided and
      // the failure is visible on the new audit row — the alternative leaves a
      // queue item that a reviewer keeps re-approving into the same error.
      await ctx.db.approvals.resolve(
        input.callId,
        ctx.orgId,
        input.decision === 'approve' ? 'approved' : 'rejected',
        userId,
      );

      ctx.logger.info('approval decided', {
        callId: input.callId,
        decision: input.decision,
        decidedBy: userId,
        tool: pending.tool,
      });

      /**
       * ── PRD §7.4's `Approved` / back-to-`Draft` transitions ───────────────
       *
       * The held call's *own* status ladder is the `approvals` row above. This
       * is the content item's, which is a different object and was not being
       * moved at all: a post held for review sat at `needs_review` (or, before
       * that state existed, at `scheduled`) whatever a reviewer decided.
       *
       * Kept to publish-effect calls that name a `contentItemId`, and read off
       * the held input rather than asked for — a reviewer approves a *call*, and
       * nothing here should let them redirect the decision onto a different
       * post. A rejected post returns to `draft`: it is editable again, which is
       * the state a reviewer saying no actually leaves it in.
       */
      const heldItemId = publishedContentItemId(pending);

      if (input.decision === 'reject') {
        if (heldItemId) {
          await ctx.db.content.markRejected({
            id: heldItemId,
            orgId: ctx.orgId,
            reason: `Rejected in review by ${userId}.`,
          });
        }
        return { callId: input.callId, decision: input.decision };
      }

      if (heldItemId) {
        // Set before the replay, not after. A replay that fails leaves the item
        // showing `approved` with no publish — which is exactly the state it is
        // in, and is otherwise indistinguishable from "nobody has looked at it".
        await ctx.db.content.markApproved({ id: heldItemId, orgId: ctx.orgId });
      }

      const result = await deps.execute({ callId: input.callId, grantedBy: userId, ctx });

      return {
        callId: input.callId,
        decision: input.decision,
        executed: {
          status: result.status,
          ...(result.status !== 'gated' ? { newCallId: result.call.id } : { newCallId: result.call.id }),
          ...(result.status === 'failed' ? { error: result.error.message } : {}),
        },
      };
    },
  });
}

/**
 * The content item a held publish call was about, if it was about one.
 *
 * Narrow by design: only `publish.*`, and only from the held input's own
 * `contentItemId`. `approval.decide` is generic over every tool in the registry
 * and must not grow a branch per tool — this is the one shape where the content
 * item's own PRD §7.4 status is a consequence of the decision.
 */
function publishedContentItemId(pending: { tool: string; input: unknown }): string | undefined {
  if (!pending.tool.startsWith('publish.')) return undefined;
  const input = pending.input;
  if (!input || typeof input !== 'object') return undefined;
  const id = (input as { contentItemId?: unknown }).contentItemId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
