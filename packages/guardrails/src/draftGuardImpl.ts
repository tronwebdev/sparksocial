import type { DraftGuard } from '@sparksocial/generate';
import { gatherAndEvaluate, ALL_GUARDRAILS, type EmbedClient } from './gather.js';

/**
 * `DraftGuard` over the full guardrail set — the concrete implementation of the
 * seam `packages/generate/src/draft.ts` declares, for PRD §8.6's *"governance
 * checks set status to Needs Review or Blocked"*.
 *
 * ── Why all eight here, unlike the reply guard ─────────────────────────────
 *
 * `createReplyGuard` runs five, because a reply has no playbook and no
 * referenced assets so three of the checks have nothing to evaluate. A draft has
 * both: it is the exact `GuardrailableDraft` shape the layer was built for, and
 * it is the same set `publish.now` will run again on the way out. Running a
 * *subset* here would be worse than running none — a draft that passed at draft
 * time and then failed at publish time teaches people to distrust the earlier
 * verdict.
 *
 * ── The first non-pass wins ───────────────────────────────────────────────
 *
 * `gatherAndEvaluate` returns every verdict; a person fixing a draft acts on one
 * thing at a time, and a block outranks a flag because it is the one that stops
 * the post. So blocks are reported ahead of flags, and within each the first in
 * `ALL_GUARDRAILS` order — which puts grounding and compliance ahead of
 * stylistic checks, matching what actually matters.
 */
export function createDraftGuard(embed: EmbedClient): DraftGuard {
  return {
    async check({ genomeId, playbookId, platform, text, referencedAssetIds }, ctx) {
      const results = await gatherAndEvaluate(
        { genomeId, playbookId, platform, text, referencedAssetIds },
        ctx,
        embed,
        ALL_GUARDRAILS,
      );

      const entries = ALL_GUARDRAILS.map((guard) => ({ guard, result: results[guard] })).filter(
        (e) => e.result && e.result.verdict !== 'pass',
      );

      const worst =
        entries.find((e) => e.result!.verdict === 'block') ?? entries.find((e) => e.result!.verdict === 'flag');

      if (!worst) return { verdict: 'pass' };

      return {
        verdict: worst.result!.verdict,
        guard: worst.guard,
        ...(worst.result!.rule ? { rule: worst.result!.rule } : {}),
        ...(worst.result!.fixAction ? { fixAction: worst.result!.fixAction } : {}),
      };
    },
  };
}
