import { PASS, type CheckResult } from './types.js';

/**
 * DUPLICATE / REPETITION — engine spec §10: "Semantic similarity check against
 * the trailing 90 days of that genome's published posts. Also enforce asset
 * reuse cooldown."
 *
 * Two independent checks:
 *
 *  1. **Text similarity** against recent published copy. Real similarity is
 *     computed on embeddings (same model as the Asset Graph); this module takes
 *     the embeddings as input rather than computing them, so it stays a pure
 *     function and the caller decides which embedding client to use — same
 *     seam as `asset.retrieve`.
 *  2. **Asset reuse cooldown** — a stricter, deterministic sibling of the
 *     *penalty* applied in `packages/db/src/scoped.ts`'s retrieval ranking.
 *     Ranking discourages reuse; this guardrail can outright block it inside a
 *     cooldown window, because a photo that resurfaces days apart reads as
 *     automated in a way ranking alone doesn't fully prevent.
 */

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface DuplicateInput {
  draftEmbedding: number[];
  /** Embeddings of that genome's posts published in the trailing 90 days. */
  recentPublishedEmbeddings: number[][];
  similarityThreshold?: number;
  /** Ids of assets this draft references. */
  referencedAssetIds: string[];
  /** assetId -> days since it was last used; absent/undefined = never used. */
  assetLastUsedDaysAgo: Record<string, number | undefined>;
  cooldownDays?: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.92; // near-restatement, not merely the same topic
/** Exported for `asset.cooldown.check` (packages/assetgraph) — same reuse-cooldown concept, exposed as a pre-flight read instead of buried in a block verdict. */
export const DEFAULT_COOLDOWN_DAYS = 7;

export function duplicate(input: DuplicateInput): CheckResult {
  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const mostSimilar = input.recentPublishedEmbeddings.reduce(
    (max, e) => Math.max(max, cosineSimilarity(input.draftEmbedding, e)),
    0,
  );
  if (mostSimilar >= threshold) {
    return {
      verdict: 'flag',
      rule: 'duplicate',
      evidence: { similarity: Number(mostSimilar.toFixed(3)), threshold },
      fixAction: 'This restates a post from the trailing 90 days — rewrite the hook or angle before scheduling.',
    };
  }

  const cooldownDays = input.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;
  const withinCooldown = input.referencedAssetIds.filter((id) => {
    const days = input.assetLastUsedDaysAgo[id];
    return days !== undefined && days < cooldownDays;
  });
  if (withinCooldown.length > 0) {
    return {
      verdict: 'flag',
      rule: 'duplicate',
      evidence: { assetsInCooldown: withinCooldown, cooldownDays },
      fixAction: `Asset(s) ${withinCooldown.join(', ')} were used within the last ${cooldownDays} days — pick a different asset or wait.`,
    };
  }

  return PASS;
}
