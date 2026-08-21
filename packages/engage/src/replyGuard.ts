import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools/defineTool';

/**
 * GUARDRAILS ON AN OUTBOUND REPLY — PRD §8.8 ("Maintain brand voice and
 * safety"), §9 ("restricted topics/claims trigger… Blocked").
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 *
 * `engage.autohandle` sent text with nobody in the loop and no check of any
 * kind on what it was sending. The text came from a model prompted with a
 * stranger's message, and until that prompt was fenced (`reply-writer.ts`,
 * `engage-classifier.ts`) an injected message could dictate it outright.
 *
 * Fencing is the first half and it is not sufficient — `containment.ts` says so
 * itself: *"Delimiters reduce the odds a model obeys injected text; they do not
 * make it impossible."* The second half has to be a check on the *output*: a
 * reply promising a refund the brand does not offer, or naming a restricted
 * topic, must not leave the building however it came to be written. That check
 * already exists for posts. It simply was not on this path.
 *
 * ── Injected, not imported ─────────────────────────────────────────────────
 *
 * `@sparksocial/guardrails` sits after `engage` in the build order, so this is
 * a seam rather than a direct call — the same shape `ReplySender` and
 * `ReplyWriter` already use in this package. `apps/api/src/tools.ts` supplies
 * the real implementation over `gatherAndEvaluate`.
 *
 * Optional, and that is a deliberate risk trade rather than an oversight: a
 * deployment with no guard wired must still be able to reply to its audience.
 * `index.ts` warns at boot when it is absent, matching how every other
 * unconfigured seam in this codebase behaves.
 */

export interface ReplyGuardVerdict {
  verdict: 'pass' | 'flag' | 'block';
  /** Which check fired, e.g. `restricted_topics`. */
  guard?: string;
  rule?: string;
  fixAction?: string;
}

export interface ReplyGuard {
  /**
   * Evaluate reply text about to be sent. A `block` must stop the send; a
   * `flag` is reported but does not, because the human sending it has already
   * seen the words — see {@link enforceReplyGuard}.
   */
  check(args: { genomeId: string; platform: string; text: string }, ctx: ToolCtx): Promise<ReplyGuardVerdict>;
}

/**
 * Run the guard and throw on a block.
 *
 * `unattended` is the whole of the difference between the two callers, and it is
 * not about severity but about who has read the text:
 *
 *   - `engage.reply.send` is a person clicking send on words they can see. A
 *     *flag* there is noise — they have already made the judgement the flag is
 *     asking for. A *block* still stops them, because a block is "this must not
 *     go out", not "are you sure".
 *   - `engage.autohandle` has nobody in the loop, so a flag is the only signal
 *     there will ever be. It is therefore escalated to a refusal: the message
 *     drops back to needing review rather than going out unread.
 *
 * Returns the verdict so a caller can put it in its `why`.
 */
export async function enforceReplyGuard(
  guard: ReplyGuard | undefined,
  args: { genomeId: string; platform: string; text: string; unattended: boolean },
  ctx: ToolCtx,
): Promise<ReplyGuardVerdict> {
  if (!guard) return { verdict: 'pass' };

  const result = await guard.check({ genomeId: args.genomeId, platform: args.platform, text: args.text }, ctx);

  const fatal = result.verdict === 'block' || (args.unattended && result.verdict === 'flag');
  if (fatal) {
    throw new ToolError(
      'GUARDRAIL_BLOCKED',
      result.rule ?? `This reply was stopped by ${result.guard ?? 'a guardrail'}.`,
      {
        guard: result.guard,
        fixAction:
          result.fixAction ??
          (args.unattended
            ? 'Handle this message manually — SPARK will not send it unattended.'
            : 'Edit the reply and try again.'),
        unattended: args.unattended,
      },
    );
  }

  return result;
}
