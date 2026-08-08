import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, GenerationMode, ToolError } from '@sparksocial/shared';
import { resolve, type AssetInventory, type ResolvedPlaybook } from '@sparksocial/playbooks';

/**
 * `direct.fallback.degrade` — engine spec §6.5.
 *
 *   *"**Fallbacks are mandatory.** If no capture arrives inside the window,
 *   `direct.fallback.degrade` substitutes an Assemble or Synthesize playbook.
 *   The calendar must never go empty because a human did not film."*
 *
 * This is the failure the capture loop is guaranteed to hit. A local business
 * owner *will* miss a week — that is not an edge case, it is Tuesday. What
 * decides whether they stay subscribed is whether the account goes quiet when
 * they do.
 *
 * ── Why this is a filter, not a ranker ─────────────────────────────────────
 * It calls `resolve()` and takes the best result that needs no filming. It does
 * not re-score anything. A second ranking implementation would drift from the
 * first, and then "what SPARK would post" and "what SPARK posts when you're
 * busy" would answer to different rules — which is exactly the inconsistency
 * that makes an account read as automated.
 *
 * Nothing here branches on niche or category (invariant 5). The substitution is
 * decided by generation mode and by what the Asset Graph actually holds.
 */

/** Modes that need no new footage. Deliberately not "everything except direct_finish":
 *  a mode added later should have to opt in to being a fallback, not inherit it. */
const NO_FILMING_REQUIRED: ReadonlyArray<z.infer<typeof GenerationMode>> = ['assemble', 'synthesize'];

export const FallbackDegradeInput = z.object({
  genomeId: z.string().min(1),
  /**
   * The playbook that was briefed and not filmed. Excluded from the
   * substitutes, and reported in the `why` so the swap is legible rather than
   * looking like SPARK changed its mind for no reason.
   */
  missedPlaybookId: z.string().min(1),
});

export const FallbackDegradeOutput = z.object({
  /** Null when nothing can run without filming — a real answer, not an error. */
  substitute: z
    .object({
      playbookId: z.string(),
      name: z.string(),
      mode: GenerationMode,
      score: z.number(),
    })
    .nullable(),
  missedPlaybookId: z.string(),
  why: Explanation,
});

export const fallbackDegrade = defineTool({
  name: 'direct.fallback.degrade',
  version: 1,

  summary:
    'Pick a replacement post when a capture brief was not filmed in time — something buildable from ' +
    'assets the brand already has, so the calendar never goes empty. Read-only, free.',

  input: FallbackDegradeInput,
  output: FallbackDegradeOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

    const inventory = (await ctx.db.assets.inventory(input.genomeId, ctx.orgId)) as AssetInventory;
    const { ranked } = resolve(genome, inventory);

    const candidates = eligibleSubstitutes(ranked, input.missedPlaybookId);
    const best = candidates[0];

    ctx.logger.info('fallback resolved', {
      genomeId: input.genomeId,
      missed: input.missedPlaybookId,
      substitute: best?.playbook.playbook_id ?? null,
      candidates: candidates.length,
    });

    return {
      substitute: best
        ? {
            playbookId: best.playbook.playbook_id,
            name: best.playbook.name,
            mode: best.playbook.mode,
            score: Number(best.score.toFixed(4)),
          }
        : null,
      missedPlaybookId: input.missedPlaybookId,
      why: explain(best, candidates, input.missedPlaybookId),
    };
  },
});

/**
 * Substitutes that can actually run today, best first.
 *
 * Two filters, both load-bearing:
 *
 * - `!unlockable` — an unlockable playbook is one whose assets *do not exist
 *   yet*. Substituting one for a missed shoot would answer "you didn't film" with
 *   "then film something else", which is the same empty calendar with extra steps.
 * - mode — the replacement must need no new footage, or it is not a fallback.
 */
export function eligibleSubstitutes(ranked: ResolvedPlaybook[], missedPlaybookId: string): ResolvedPlaybook[] {
  return ranked.filter(
    (r) =>
      r.playbook.playbook_id !== missedPlaybookId &&
      !r.unlockable &&
      NO_FILMING_REQUIRED.includes(r.playbook.mode),
  );
}

/**
 * Invariant 4: swapping the week's post is a decision the owner watches SPARK
 * make, and it happens on a day they already feel behind. The `why` has to read
 * as "here is what I did instead", not as an error.
 */
function explain(
  best: ResolvedPlaybook | undefined,
  candidates: ResolvedPlaybook[],
  missedPlaybookId: string,
): Explanation {
  if (!best) {
    return {
      summary:
        'Nothing can be posted without new footage this week — every available format needs assets that ' +
        'do not exist yet.',
      factors: [
        { label: 'missed brief', detail: missedPlaybookId },
        { label: 'substitutes available', detail: '0' },
      ],
      evidence: [],
      // The honest alternative, stated plainly: the fix is filming, and saying
      // so beats silently posting nothing.
      alternatives: [{ option: 'post anyway', rejectedBecause: 'no format can be built from existing assets' }],
    };
  }

  return {
    summary: `Posting ${best.playbook.name} instead — it builds from assets you already have.`,
    factors: [
      { label: 'missed brief', detail: missedPlaybookId },
      { label: 'mode', detail: `${best.playbook.mode} — needs no filming` },
      { label: 'pillar', detail: best.playbook.content_pillar },
      { label: 'substitutes considered', detail: String(candidates.length) },
    ],
    evidence: [{ kind: 'rule', id: 'fallback.degrade', note: 'calendar must not go empty on a missed capture' }],
    alternatives: candidates.slice(1, 4).map((c) => ({
      option: c.playbook.name,
      rejectedBecause: `scored ${c.score.toFixed(2)} against ${best.score.toFixed(2)}`,
    })),
  };
}
