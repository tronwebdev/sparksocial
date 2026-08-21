import type { InvokeDeps, GuardrailVerdict } from '@sparksocial/tools';
import type { GuardrailId } from '@sparksocial/tools/defineTool';
import { GuardrailableDraft } from './draft.js';
import { gatherAndEvaluate, type EmbedClient } from './gather.js';

/**
 * The `InvokeDeps.runGuardrails` adapter — how a tool declaring
 * `guardrails: [...]` on itself gets checked inside `invokeTool`'s middleware
 * chain. Calls the exact same `gatherAndEvaluate` core as
 * `guard.evaluate_draft`, reshaped into `invoke.ts`'s `GuardrailVerdict[]`.
 *
 * `publish.now` declares all eight, which makes this the enforcement path for
 * every post that reaches a feed. It is the *only* tool that declares any, and
 * that is a real constraint rather than an oversight: the checks need
 * draft-shaped input (`GuardrailableDraft`), and `publish.now` is shaped that
 * way on purpose. Outbound *replies* take a parallel route —
 * `packages/engage/src/replyGuard.ts` — because a reply has no playbook and no
 * referenced assets, so three of the eight checks have nothing to evaluate.
 */
export function makeRunGuardrails(embed: EmbedClient): NonNullable<InvokeDeps['runGuardrails']> {
  return async (guards, rawInput, ctx) => {
    const parsed = GuardrailableDraft.safeParse(rawInput);
    if (!parsed.success) {
      // A tool that declares guardrails but doesn't produce a GuardrailableDraft
      // shape is a wiring bug, not a content problem — block loudly rather than
      // silently skipping enforcement.
      return guards.map((g) => ({
        guard: g,
        verdict: 'block' as const,
        rule: 'wiring_error',
        fixAction: `Tool input is not draft-shaped: ${parsed.error.message}`,
      }));
    }

    const results = await gatherAndEvaluate(parsed.data, ctx, embed, guards);
    return Object.entries(results).map(
      ([guard, r]): GuardrailVerdict => ({ guard: guard as GuardrailId, ...r }),
    );
  };
}
