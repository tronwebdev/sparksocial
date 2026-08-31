import { z } from 'zod';
import { defineTool, type PolicySubject, type ToolCtx } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation, rungAutonomy } from '@sparksocial/shared';
import type { ReplySender } from './replySender.js';
import { enforceReplyGuard, type ReplyGuard } from './replyGuard.js';
import { resolveEngagementEligibility, engagementTypeAllows } from './eligibility.js';
import { applyPlatformOverride, tripsComplaintRule } from '@sparksocial/shared/engagementConfig';
import { listPlatformOverrides, pickPlatformOverride } from './platformOverride.js';

/**
 * `engage.autohandle` â€” SPARK sending a reply with nobody in the loop.
 *
 * â”€â”€ Not a general-purpose send â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * There is no `text` input. This tool only ever delivers the message's own
 * stored `suggestedReply`, and only for a message the classifier has already
 * put in the `auto_handled` category â€” the one category `engage.classify`
 * (`packages/engage/src/classify.ts`) reserves for replies it judged safe to
 * send unattended. A caller that wants to send something else, or send to a
 * message in any other category, must go through the human loop
 * (`engage.reply.draft` â†’ `.send`). Letting this tool accept an arbitrary
 * `text` would turn "SPARK's own vetted suggestion" into "whatever the caller
 * hands it, tagged `auto`" â€” the exact bypass this tool exists to not be.
 *
 * â”€â”€ Governance, not built here â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * `effect: 'publish'` puts this under `packages/tools/src/policy.ts` rule 6
 * (`family === 'engage' && effect === 'publish'` â†’ deny unless the campaign
 * is eligible, approval unless autonomy is configured) exactly the same way
 * `engage.reply.send` is gated â€” rule 6 does not read `tool.autonomy` at all,
 * so tagging this tool `autonomy: 'auto'` changes nothing about whether the
 * policy engine lets it through. `auto` here only means "no *additional*
 * confirm step beyond what rule 6 already requires" â€” the same distinction
 * `policy.ts`'s own comment on rule 8 draws for `reply.send`'s `confirm`.
 * CLAUDE.md invariant 3: policy stays a pure function fed by its caller: this
 * handler does not, and could not, decide its own eligibility.
 *
 * `idempotent: false` for the same reason `engage.reply.send` is â€” a second
 * successful call is a second message in someone's inbox, not a duplicate
 * row. Requires an idempotency key at the `invoke.ts` layer.
 */

/**
 * The policy context `policy.ts` rules 6 and 7 evaluate for an outbound reply.
 *
 * â”€â”€ Why the engagement gate moved here â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * `engagement` used to arrive on `InvokeRequest`, forwarded verbatim from the
 * HTTP request body (`app.ts`). So a client could post
 * `engagement: { eligible: true, autonomyConfigured: true }` and send unattended
 * replies for a campaign that had never published anything â€” PRD Â§8.8's entire
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
 *     exposes as a tool. One rule, two readers â€” a second implementation is how
 *     the screen and the gate come to disagree.
 *   - `autonomyConfigured` is the *campaign's* engagement rung, mapped through
 *     `rungAutonomy`. It was `brands.engagementAutonomy !== 'off'` until
 *     22 August, when autonomy became a property of the campaign; the brand's
 *     value is now the template a new campaign is seeded from. A campaign that
 *     has never chosen reads as `observe`, which leaves SPARK suggesting replies
 *     for a person to send — what rule 6's `approval` outcome does with it.
 *
 * Rule 6 runs before rule 7, so an ineligible brand is denied before the
 * platform and content-type restrictions are even consulted.
 */
async function replyPolicySubject(
  input: { messageId: string; genomeId: string },
  ctx: ToolCtx,
): Promise<PolicySubject> {
  /**
   * The brand comes back into this read, having been removed when the rung moved
   * to the campaign. It is needed again for one field: `engagementTypes`, which
   * decides whether SPARK may answer *this kind* of message at all. Parallel with
   * the other two, so it costs latency only on the slowest of the three.
   */
  const [message, eligibility, brand, platformRows] = await Promise.all([
    ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId),
    resolveEngagementEligibility(ctx, input.genomeId),
    ctx.brandId ? ctx.db.brands.get(ctx.brandId, ctx.orgId) : Promise.resolve(undefined),
    // Fourth in the same round trip. It needs only the brand, so making it wait
    // for the message would cost every reply a hop for a usually-empty table.
    listPlatformOverrides(ctx),
  ]);

  const override = pickPlatformOverride(platformRows, message?.platform);

  return {
    ...(message?.platform ? { platform: message.platform } : {}),
    // Not a media type: a workspace that wants replies reviewed while posts
    // flow freely (or the reverse) has to be able to name them separately, and
    // nothing else in the system produces this string.
    contentType: 'engagement_reply',
    engagement: {
      eligible: eligibility.eligible,
      /**
       * The *campaign's* rung, not the brand's setting.
       *
       * Autonomy became a property of the campaign on 22 August, and answering
       * the audience is autonomy. `brands.engagementAutonomy` remains as the
       * template a new campaign is seeded from â€” `calendar.generate` widens its
       * three values onto the four rungs â€” but the value that governs a given
       * reply is the one on the campaign that reply belongs to.
       *
       * `rungAutonomy` maps the four rungs onto the three-value vocabulary rule
       * 6 already reads, so there is still one definition of "may it reply"
       * rather than two that can disagree.
       */
      /**
       * Two conditions, one field, because rule 6 asks one question: may SPARK
       * answer unattended? A disabled message kind and an `observe` rung are
       * different reasons for the same "no", and folding them here keeps the
       * decision in the policy engine rather than adding a second gate in a
       * handler (CLAUDE.md invariant 3).
       *
       * The consequence is the right one: SPARK still drafts a reply and a person
       * still sends it. Unchecking "Direct messages" stops the automation, not the
       * conversation.
       */
      /**
       * Three conditions now, still one field, still because rule 6 asks one
       * question: may SPARK answer unattended?
       *
       * The third is `never_auto_reply_to_complaints`. It cannot be a prompt
       * instruction — by the time a prompt runs, the decision to reply unattended
       * has been taken — so it is enforced here, where that decision is made. An
       * unhappy customer is exactly the case where a false negative is expensive
       * and a false positive costs one human glance, which is why the marker list
       * is deliberately blunt rather than a model call.
       */
      /**
       * Four conditions now. The fourth is the platform override.
       *
       * `applyPlatformOverride` can only *narrow* what the rung granted — see
       * there for why it deliberately does not fall back to the brand's
       * `engagementAutonomy` the way the settings screen does. An `engagementTypes`
       * override replaces the brand's list for this platform only; absent, the
       * brand's list still applies, so a brand with no rows is gated exactly as
       * it was before this table existed.
       */
      autonomyConfigured:
        applyPlatformOverride({ granted: rungAutonomy(eligibility.rung), row: override }) !== 'off' &&
        engagementTypeAllows(override?.engagementTypes ?? brand?.engagementTypes, message?.kind) &&
        !tripsComplaintRule(brand?.hardRules, message?.text ?? ''),
    },
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
   * Checks the reply before it goes out unattended â€” see `replyGuard.ts`. This
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
      'unattended. Only fires for messages already in the auto_handled category â€” gated by the engagement ' +
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
       * here â€” see `enforceReplyGuard`. The message stays in the inbox needing
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

      // The reply is already delivered by this point â€” same trade-off
      // `engage.reply.send` makes: a store failure here must not be reported
      // as a send failure, which would invite a retry that sends a second one.
      const updated = await ctx.db.engagement.markAutoHandled({
        id: message.id,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        // The outbound half of `ENG-02.4`'s transcript, and it matters more here
        // than on the attended path: nobody read this before it went out, so the
        // thread is the only place a person can see what SPARK actually said.
        sentReply: message.suggestedReply,
      });
      if (!updated) {
        ctx.logger.error('auto-reply sent but engagement_messages was not updated â€” status may show stale', {
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

