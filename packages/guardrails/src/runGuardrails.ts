import type { InvokeDeps, GuardrailVerdict } from '@sparksocial/tools';
import type { GuardrailId } from '@sparksocial/tools/defineTool';
import { GuardrailableDraft } from './draft.js';
import { gatherAndEvaluate, type EmbedClient } from './gather.js';

/**
 * The `InvokeDeps.runGuardrails` adapter — what a *future* tool declaring
 * `guardrails: [...]` on itself (e.g. a `publish.now`, once §8 lands) would be
 * checked by inside `invokeTool`'s middleware chain. Calls the exact same
 * `gatherAndEvaluate` core as `guard.evaluate_draft`, just reshaped into
 * `invoke.ts`'s `GuardrailVerdict[]`.
 *
 * No currently-registered tool declares `guardrails` yet — nothing in this
 * repo produces publishable copy. Wired here and exported so the moment such a
 * tool exists, enforcement is a one-line `guardrails: [...]` on its
 * `defineTool` call, not new plumbing.
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
