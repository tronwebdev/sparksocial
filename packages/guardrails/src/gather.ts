import type { ToolCtx } from '@sparksocial/tools/defineTool';
import { byId } from '@sparksocial/playbooks';
import type { GuardrailId } from './types.js';
import { PASS, type CheckResult } from './types.js';
import { claimGrounding } from './claimGrounding.js';
import { complianceProfile } from './compliance.js';
import { restrictedTopics } from './restrictedTopics.js';
import { brandVoice } from './brandVoice.js';
import { avatarSaturation } from './avatarSaturation.js';
import { duplicate } from './duplicate.js';
import { platformPolicy } from './platformPolicy.js';
import { rights } from './rights.js';
import type { GuardrailableDraft } from './draft.js';

/**
 * The non-pure half of the guardrail layer: gathers exactly what each pure
 * check in this package needs from the repository, then calls it. This is the
 * only module in `packages/guardrails` that touches `ctx.db` — every check
 * function stays pure and independently testable, mirroring how
 * `packages/tools/src/policy.ts` stays pure while `invoke.ts` does the I/O
 * around it.
 */

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

const DUPLICATE_WINDOW_DAYS = 90; // §10: "trailing 90 days"
const SATURATION_WINDOW_DAYS = 30;

export async function gatherAndEvaluate(
  draft: GuardrailableDraft,
  ctx: ToolCtx,
  embed: EmbedClient,
  guards: readonly GuardrailId[],
): Promise<Record<GuardrailId, CheckResult>> {
  const genome = await ctx.db.genomes.get(draft.genomeId, ctx.orgId);
  const playbook = byId(draft.playbookId);

  const results = {} as Record<GuardrailId, CheckResult>;
  const run = (id: GuardrailId, fn: () => CheckResult | Promise<CheckResult>) => {
    if (!guards.includes(id)) return Promise.resolve();
    return Promise.resolve(fn()).then((r) => {
      results[id] = r;
    });
  };

  const missingContext = (what: string): CheckResult => ({
    verdict: 'block',
    rule: 'missing_context',
    fixAction: `Cannot evaluate — ${what} not found.`,
  });

  await Promise.all([
    run('claim_grounding', async () => {
      if (!genome) return missingContext('genome');
      // Two sources, both genuine grounding: asset captions carry proof
      // embedded in what was actually shot (a testimonial's own words, a
      // spec sheet photographed at the counter); `knowledge_chunks` carries
      // text attached directly — `brand.knowledge.attach`,
      // `knowledge.ingest_site`, `knowledge.ingest_docs`. Reading only the
      // first meant every knowledge-ingestion write was inert: nothing here
      // ever consulted it, so a business that pasted its entire FAQ in still
      // had every specific claim rejected as ungrounded.
      const [captions, chunks] = await Promise.all([
        ctx.db.assets.captionsByRole(draft.genomeId, ctx.orgId, ['knowledge', 'social_proof']),
        ctx.db.knowledge.listAll(draft.genomeId, ctx.orgId),
      ]);
      const groundingCorpus = [...captions, ...chunks.map((c) => c.text)].join('\n');
      return claimGrounding({ text: draft.text, groundingCorpus });
    }),

    run('compliance_profile', () => {
      if (!genome) return missingContext('genome');
      return complianceProfile({
        text: draft.text,
        profile: genome.constraints.compliance_profile,
        extraRequiredDisclaimers: genome.voice.required_disclaimers,
      });
    }),

    /**
     * PRD §9's restricted topics and claims-to-avoid. Read off `brands`, not
     * the genome: the genome is inferred from a website and re-inferred when
     * that site changes, and a human's statement of what the brand will not say
     * must not be silently overwritten by a crawl.
     *
     * A brand with nothing configured passes, which is why this can be declared
     * unconditionally on every publish path.
     */
    run('restricted_topics', async () => {
      const brand = ctx.brandId ? await ctx.db.brands.get(ctx.brandId, ctx.orgId) : undefined;
      if (!brand) return PASS;
      return restrictedTopics({
        text: draft.text,
        ...(brand.restrictedTopics ? { restrictedTopics: brand.restrictedTopics } : {}),
        ...(brand.claimsToAvoid ? { claimsToAvoid: brand.claimsToAvoid } : {}),
        strictMode: brand.strictMode,
      });
    }),

    run('brand_voice', async () => {
      if (!genome) return missingContext('genome');
      // Brand-level banned phrases are additive to the genome's, not a
      // replacement: the genome's came from the site's own copy, and ONB-03's
      // are what a person typed. Both are things this brand does not say.
      const brand = ctx.brandId ? await ctx.db.brands.get(ctx.brandId, ctx.orgId) : undefined;
      const bannedPhrases = [
        ...(genome.voice.banned_phrases ?? []),
        ...(brand?.bannedPhrases ?? []),
      ];
      return brandVoice({ text: draft.text, bannedPhrases });
    }),

    run('avatar_saturation', async () => {
      if (!genome || !playbook) return missingContext('genome or playbook');
      const recent = await ctx.db.content.recent(draft.genomeId, ctx.orgId, SATURATION_WINDOW_DAYS);
      return avatarSaturation({
        isAvatarFormat: playbook.preconditions.requires_likeness_license,
        recentAvatarCount: recent.filter((r) => r.isAvatarFormat).length,
        recentTotalCount: recent.length,
      });
    }),

    run('duplicate', async () => {
      const [recent, embedding, assetInfo] = await Promise.all([
        ctx.db.content.recent(draft.genomeId, ctx.orgId, DUPLICATE_WINDOW_DAYS),
        embed.embed(draft.text),
        ctx.db.assets.info(draft.referencedAssetIds, draft.genomeId, ctx.orgId),
      ]);
      return duplicate({
        draftEmbedding: embedding,
        recentPublishedEmbeddings: recent.map((r) => r.embedding).filter((e): e is number[] => e !== null),
        referencedAssetIds: draft.referencedAssetIds,
        assetLastUsedDaysAgo: Object.fromEntries(
          draft.referencedAssetIds.map((id) => [id, assetInfo[id]?.lastUsedDaysAgo]),
        ),
      });
    }),

    run('platform_policy', () => {
      if (!playbook) return missingContext('playbook');
      return platformPolicy({
        platform: draft.platform,
        text: draft.text,
        requiresDisclosure: playbook.requires_disclosure,
      });
    }),

    run('rights', async () => {
      if (!genome || !playbook) return missingContext('genome or playbook');
      const [info, avatarEnabled] = await Promise.all([
        ctx.db.assets.info(draft.referencedAssetIds, draft.genomeId, ctx.orgId),
        ctx.db.consent.hasActive(draft.genomeId, ctx.orgId, 'avatar_clone'),
      ]);
      return rights({
        referencedAssetRights: draft.referencedAssetIds.map((id) => ({
          assetId: id,
          rightsStatus: info[id]?.rightsStatus ?? 'pending',
        })),
        requiresLikenessLicense: playbook.preconditions.requires_likeness_license,
        avatarEnabled,
      });
    }),
  ]);

  // Any guard requested but not among the seven implemented above defaults to
  // pass rather than silently vanishing — keeps the caller's `guards` list and
  // `results`'s keys in exact correspondence.
  for (const g of guards) if (!(g in results)) results[g] = PASS;

  return results;
}

export const ALL_GUARDRAILS: readonly GuardrailId[] = [
  'claim_grounding',
  'compliance_profile',
  'restricted_topics',
  'brand_voice',
  'avatar_saturation',
  'duplicate',
  'platform_policy',
  'rights',
];
