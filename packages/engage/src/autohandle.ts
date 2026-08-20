import { z } from 'zod';
import { defineTool, type PolicySubject, type ToolCtx } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';
import type { ReplySender } from './replySender.js';
import { enforceReplyGuard, type ReplyGuard } from './replyGuard.js';

/**
 * `engage.autohandle` — SPARK sending a reply with nobody in the loop.
 *
 * ── Not a general-purpose send ──────────────────────────────────────────────
 * There is no `text` input. This tool only ever delivers the message's own
 * stored `suggestedReply`, and only for a message the classifier has already
 * put in the `auto_handled` category — the one category `engage.classify`
 * (`packages/engage/src/classify.ts`) reserves for replies it judged safe to
 * send unattended. A caller that wants to send something else, or send to a
 * message in any other category, must go through the human loop
 * (`engage.reply.draft` → `.send`). Letting this tool accept an arbitrary
 * `text` would turn "SPARK's own vetted suggestion" into "whatever the caller
 * hands it, tagged `auto`" — the exact bypass this tool exists to not be.
 *
 * ── Governance, not built here ──────────────────────────────────────────────
 * `effect: 'publish'` puts this under `packages/tools/src/policy.ts` rule 6
 * (`family === 'engage' && effect === 'publish'` → deny unless the campaign
 * is eligible, approval unless autonomy is configured) exactly the same way
 * `engage.reply.send` is gated — rule 6 does not read `tool.autonomy` at all,
 * so tagging this tool `autonomy: 'auto'` changes nothing about whether the
 * policy engine lets it through. `auto` here only means "no *additional*
 * confirm step beyond what rule 6 already requires" — the same distinction
 * `policy.ts`'s own comment on rule 8 draws for `reply.send`'s `confirm`.
 * CLAUDE.md invariant 3: policy stays a pure function fed by its caller: this
 * handler does not, and could not, decide its own eligibility.
 *
 * `idempotent: false` for the same reason `engage.reply.send` is — a second
 * successful call is a second message in someone's inbox, not a duplicate
 * row. Requires an idempotency key at the `invoke.ts` layer.
 */

/**
 * The publish context `policy.ts` rule 7 evaluates for an outbound reply — see
 * `PolicySubject` in `defineTool.ts` on why the tool derives this.
 *
 * Rule 6 already gates the whole `engage.*` publish family on eligibility and
 * autonomy configuration, and it runs first. This adds the platform and content
 * type on top, so that "Instagram requires review" covers what SPARK *says* on
 * Instagram and not only what it posts there. `contentType` is
 * `engagement_reply` rather than a media type: a workspace that wants replies
 * reviewed while posts flow freely (or the reverse) needs to be able to name
 * them separately, and nothing else in the system produces that string.
 */
async function replyPolicySubject(
  input: { messageId: string; genomeId: string },
  ctx: ToolCtx,
): Promise<PolicySubject> {
  const message = await ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId);
  return {
    ...(message?.platform ? { platform: message.platform } : {}),
    contentType: 'engagement_reply',
  };
}

export const EngageAutohandleInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
});

export const EngageAutohandleOutput = z.object({
  messageId: z.string(),
  status: z.string(),
  externalId: z.string(),
  via: z.string(),
  sentAt: z.string(),
  why: Explanation,
});

export interface EngageAutohandleDeps {
  sender: ReplySender;
  /**
   * Checks the reply before it goes out unattended — see `replyGuard.ts`. This
   * tool sent model-written text with nobody in the loop and no check of any
   * kind on it, which is the half of the prompt-injection story that fencing
   * the prompt does not close.
   */
  guard?: ReplyGuard;
}

export function makeEngageAutohandle(deps: EngageAutohandleDeps) {
  return defineTool({
    name: 'engage.autohandle',
    version: 1,

    summary:
      'Send the classifier\'s own suggested reply to a message it already judged safe to auto-handle, ' +
      'unattended. Only fires for messages already in the auto_handled category — gated by the engagement ' +
      'eligibility rule and workspace autonomy, same as engage.reply.send.',

    input: EngageAutohandleInput,
    output: EngageAutohandleOutput,

    effect: 'publish',
    policySubject: replyPolicySubject,
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

      if (message.category !== 'auto_handled') {
        throw new ToolError(
          'INVALID_INPUT',
          'This tool only sends for messages the classifier put in the auto_handled category.',
          { messageId: message.id, category: message.category ?? null },
        );
      }
      if (!message.suggestedReply) {
        throw new ToolError(
          'INVALID_INPUT',
          'This message has no suggested reply on file to send.',
          { messageId: message.id },
        );
      }

      /**
       * Nobody will read this before the audience does, so a *flag* is fatal
       * here — see `enforceReplyGuard`. The message stays in the inbox needing
       * review rather than going out unseen.
       */
      await enforceReplyGuard(
        deps.guard,
        {
          genomeId: input.genomeId,
          platform: message.platform,
          text: message.suggestedReply,
          unattended: true,
        },
        ctx,
      );

      const receipt = await deps.sender.send({
        platform: message.platform,
        kind: message.kind,
        externalId: message.externalId,
        authorHandle: message.authorHandle,
        text: message.suggestedReply,
      });

      // The reply is already delivered by this point — same trade-off
      // `engage.reply.send` makes: a store failure here must not be reported
      // as a send failure, which would invite a retry that sends a second one.
      const updated = await ctx.db.engagement.markAutoHandled({
        id: message.id,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
      });
      if (!updated) {
        ctx.logger.error('auto-reply sent but engagement_messages was not updated — status may show stale', {
          messageId: message.id,
        });
      }

      return {
        messageId: message.id,
        status: updated?.status ?? 'auto_handled',
        externalId: receipt.externalId,
        via: receipt.via,
        sentAt: receipt.sentAt.toISOString(),
        why: {
          summary: `Sent the classifier's suggested reply to ${message.authorHandle} on ${message.platform}, unattended.`,
          factors: [
            { label: 'Classified auto_handled', weight: 1 },
            { label: 'Eligibility and autonomy cleared by policy.ts before this ran', weight: 1 },
          ],
          evidence: [{ kind: 'metric' as const, id: message.id, note: message.suggestedReply.slice(0, 200) }],
          alternatives: [{ option: 'Route to a human for approve-and-send', rejectedBecause: 'Classifier judged this safe to send unattended.' }],
        },
      };
    },
  });
}
