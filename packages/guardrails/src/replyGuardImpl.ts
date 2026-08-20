import type { ReplyGuard, ReplyGuardVerdict } from '@sparksocial/engage';
import { restrictedTopics } from './restrictedTopics.js';
import { brandVoice } from './brandVoice.js';
import { complianceProfile } from './compliance.js';
import { claimGrounding } from './claimGrounding.js';
import { platformPolicy } from './platformPolicy.js';

/**
 * `ReplyGuard` over the checks that make sense for a reply — the concrete
 * implementation of the seam `packages/engage/src/replyGuard.ts` declares.
 *
 * ── Why a subset, and which one ────────────────────────────────────────────
 *
 * `gatherAndEvaluate` is built for a *post*: it needs a playbook (for format,
 * disclosure and avatar rules) and a set of referenced assets (for rights and
 * reuse). A reply has neither — it is text, on a platform, in a conversation.
 * Forcing it through the post path would mean inventing a fake playbook, and a
 * fake playbook is how `avatar_saturation` starts refusing replies for having
 * used an avatar too often this month.
 *
 * So the five checks that are genuinely about *words* are run, and the three
 * that are about *media* are not:
 *
 *   - `restricted_topics` — the brand's own topics and claims (PRD §9). The
 *     single most important one here: a prompt-injected reply promising a refund
 *     is exactly what this catches.
 *   - `compliance_profile` — regulated-vertical phrases and disclaimers. A
 *     health brand may not say "cures" in a DM either.
 *   - `brand_voice` — banned phrases, brand-level and genome-level.
 *   - `claim_grounding` — a reply that invents a price or a guarantee.
 *   - `platform_policy` — per-platform text rules.
 *
 * Not run: `rights`, `duplicate`, `avatar_saturation`. A reply references no
 * assets, and two similar replies to two similar questions is correct behaviour
 * rather than duplication.
 *
 * ── Severity ──────────────────────────────────────────────────────────────
 *
 * Whatever the check says. `enforceReplyGuard` decides what a `flag` *means*
 * per caller (fatal unattended, advisory with a human present); this module
 * only reports. Checks run in order of how specific and how cheap they are, and
 * the first non-pass wins — a reply has one thing wrong with it worth telling
 * somebody about.
 */
export function createReplyGuard(): ReplyGuard {
  return {
    async check({ genomeId, platform, text }, ctx) {
      const genome = await ctx.db.genomes.get(genomeId, ctx.orgId);
      const brand = ctx.brandId ? await ctx.db.brands.get(ctx.brandId, ctx.orgId) : undefined;

      const checks: Array<{ guard: string; run: () => Promise<ReplyGuardVerdict> | ReplyGuardVerdict }> = [
        {
          guard: 'restricted_topics',
          run: () =>
            brand
              ? restrictedTopics({
                  text,
                  ...(brand.restrictedTopics ? { restrictedTopics: brand.restrictedTopics } : {}),
                  ...(brand.claimsToAvoid ? { claimsToAvoid: brand.claimsToAvoid } : {}),
                  strictMode: brand.strictMode,
                })
              : { verdict: 'pass' as const },
        },
        {
          guard: 'compliance_profile',
          run: () =>
            genome
              ? complianceProfile({
                  text,
                  profile: genome.constraints.compliance_profile,
                  extraRequiredDisclaimers: genome.voice.required_disclaimers,
                })
              : { verdict: 'pass' as const },
        },
        {
          guard: 'brand_voice',
          run: () =>
            brandVoice({
              text,
              bannedPhrases: [...(genome?.voice.banned_phrases ?? []), ...(brand?.bannedPhrases ?? [])],
            }),
        },
        {
          guard: 'claim_grounding',
          run: async () => {
            if (!genome) return { verdict: 'pass' as const };
            const [captions, chunks] = await Promise.all([
              ctx.db.assets.captionsByRole(genomeId, ctx.orgId, ['knowledge', 'social_proof']),
              ctx.db.knowledge.listAll(genomeId, ctx.orgId),
            ]);
            return claimGrounding({
              text,
              groundingCorpus: [...captions, ...chunks.map((c) => c.text)].join('\n'),
            });
          },
        },
        {
          guard: 'platform_policy',
          // A reply is never AI-generated-UGC requiring disclosure — that is a
          // property of a produced video, not of a sentence in an inbox.
          run: () => platformPolicy({ platform, text, requiresDisclosure: false }),
        },
      ];

      for (const { guard, run } of checks) {
        const result = await run();
        if (result.verdict !== 'pass') {
          return {
            verdict: result.verdict,
            guard,
            ...(result.rule ? { rule: result.rule } : {}),
            ...(result.fixAction ? { fixAction: result.fixAction } : {}),
          };
        }
      }

      return { verdict: 'pass' };
    },
  };
}
