import { z } from 'zod';
import { defineTool, type PolicySubject, type ToolCtx } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';
import type { ReplySender } from './replySender.js';
import { enforceReplyGuard, type ReplyGuard } from './replyGuard.js';
import { resolveEngagementEligibility } from './eligibility.js';

/**
 * `engage.reply.send` — the second half of the "approve & send" loop
 * (PRD §8.8): deliver exactly the text the caller hands in, never a
 * re-derived draft, so a hand-edited reply goes out edited.
 *
 * ── Governance, not built here ──────────────────────────────────────────────
 * `effect: 'publish'` and `autonomy: 'confirm'` are what put this call under
 * `packages/tools/src/policy.ts` rule 6 ("Engagement replies: gated until
 * eligible AND configured", keyed on `toolFamily('engage.reply.send') ===
 * 'engage'`) — already written and tested to 100% branch coverage in
 * `packages/tools/test/policy.test.ts` before this tool existed. Nothing
 * here re-implements or bypasses that gate; getting past it requires whoever
 * calls `invokeTool` to supply `PolicyInput.engagement` (eligibility +
 * autonomy configuration), which is out of this tool's hands by design —
 * CLAUDE.md invariant 3, policy is a pure function fed by its caller, not
 * something a tool computes about itself.
 *
 * `autonomy: 'confirm'` specifically means a human clicking the button in
 * the UI *is* the confirmation (`caller: 'user'` skips straight to `allow`
 * once eligibility/autonomy clear); only SPARK sending unattended needs the
 * extra `confirm` step. See `policy.ts`'s own comment on rule 8.
 *
 * `idempotent: false`: replying twice is not a duplicate row, it's a second
 * message in someone's inbox. Requires an idempotency key at the `invoke.ts`
 * layer; the natural key passed to `ReplySender` below is scoped to this one
 * message for the same reason `publish.now` keys on `contentItemId:platform`.
 */

/**
 * The policy context `policy.ts` rules 6 and 7 evaluate for an outbound reply.
 *
 * ── Why the engagement gate moved here ─────────────────────────────────────
 *
 * `engagement` used to arrive on `InvokeRequest`, forwarded verbatim from the
 * HTTP request body (`app.ts`). So a client could post
 * `engagement: { eligible: true, autonomyConfigured: true }` and send unattended
 * replies for a campaign that had never published anything — PRD §8.8's entire
 * eligibility gate, bypassed by two booleans the caller chose.
 *
 * It failed *closed* when the field was absent (rule 6 denies without it), which
 * is why nothing ever looked broken. Forgeable is worse than broken: broken gets
 * reported.
 *
 * Both halves are now facts the server owns:
 *
 *   - `eligible` is recomputed here from the genome's most recent campaign,
 *     using the same rule and the same two constants `engage.eligibility.check`
 *     exposes as a tool. One rule, two readers — a second implementation is how
 *     the screen and the gate come to disagree.
 *   - `autonomyConfigured` is `brands.engagementAutonomy !== 'off'`. A brand that
 *     has never chosen leaves SPARK suggesting replies for a person to send,
 *     which is what rule 6's `approval` outcome does with it.
 *
 * Rule 6 runs before rule 7, so an ineligible brand is denied before the
 * platform and content-type restrictions are even consulted.
 */
async function replyPolicySubject(
  input: { messageId: string; genomeId: string },
  ctx: ToolCtx,
): Promise<PolicySubject> {
  const [message, eligibility, brand] = await Promise.all([
    ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId),
    resolveEngagementEligibility(ctx, input.genomeId),
    ctx.brandId ? ctx.db.brands.get(ctx.brandId, ctx.orgId) : Promise.resolve(undefined),
  ]);

  return {
    ...(message?.platform ? { platform: message.platform } : {}),
    // Not a media type: a workspace that wants replies reviewed while posts
    // flow freely (or the reverse) has to be able to name them separately, and
    // nothing else in the system produces this string.
    contentType: 'engagement_reply',
    engagement: {
      eligible: eligibility.eligible,
      autonomyConfigured: (brand?.engagementAutonomy ?? 'off') !== 'off',
    },
  };
}

export const EngageReplySendInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
  /** The reply to send, exactly as given — a hand-edited draft, never re-derived from `suggestedReply`. */
  text: z.string().min(1).max(2_000),
});

export const EngageReplySendOutput = z.object({
  messageId: z.string(),
  status: z.string(),
  externalId: z.string(),
  via: z.string(),
  sentAt: z.string(),
  why: Explanation,
});

export interface EngageReplySendDeps {
  sender: ReplySender;
  /**
   * Checks the reply before it goes out — see `replyGuard.ts`. A person has read
   * these words, so only a hard *block* stops them; a flag is noise they have
   * already judged.
   */
  guard?: ReplyGuard;
}

export function makeEngageReplySend(deps: EngageReplySendDeps) {
  return defineTool({
    name: 'engage.reply.send',
    version: 1,

    summary:
      'Send a reply to one inbox comment/DM/story reply, exactly as written. Irreversible once delivered — ' +
      'gated by the engagement eligibility rule and workspace autonomy. Requires an idempotency key.',

    input: EngageReplySendInput,
    output: EngageReplySendOutput,

    effect: 'publish',
    policySubject: replyPolicySubject,
    autonomy: 'confirm',
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

      // A human is sending words they can see, so only a block stops this —
      // see `enforceReplyGuard` on why `unattended` is the whole difference
      // between this call site and `engage.autohandle`'s.
      await enforceReplyGuard(
        deps.guard,
        { genomeId: input.genomeId, platform: message.platform, text: input.text, unattended: false },
        ctx,
      );

      const receipt = await deps.sender.send({
        platform: message.platform,
        kind: message.kind,
        externalId: message.externalId,
        authorHandle: message.authorHandle,
        text: input.text,
      });

      const updated = await ctx.db.engagement.markReplied({
        id: message.id,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
      });
      // The reply is already delivered by this point — a store failure here
      // must not be reported as a send failure (that would invite a retry
      // that sends a second reply). Same trade-off `publish.now` makes for
      // `content.markPublished`; logged loudly instead of thrown.
      if (!updated) {
        ctx.logger.error('reply sent but engagement_messages was not updated — status may show stale', {
          messageId: message.id,
        });
      }

      return {
        messageId: message.id,
        status: updated?.status ?? 'replied',
        externalId: receipt.externalId,
        via: receipt.via,
        sentAt: receipt.sentAt.toISOString(),
        why: {
          summary: `Sent to ${message.authorHandle} on ${message.platform}, exactly as approved.`,
          factors: [{ label: 'Text sent exactly as supplied by the caller', weight: 1 }],
          evidence: [{ kind: 'metric' as const, id: message.id, note: input.text.slice(0, 200) }],
          alternatives: [],
        },
      };
    },
  });
}
