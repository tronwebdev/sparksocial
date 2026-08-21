import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { resolve, type ResolvedPlaybook } from './resolver.js';
import { deriveMix } from './mix.js';
import type { AssetInventory } from './golden.js';

/**
 * `playbook.resolve` — master plan §3.2, engine spec §5.2.
 *
 * Ranks the playbooks a genome can actually run, and reports the ones it *could*
 * run if someone filmed 90 seconds. Both halves matter: the ranked list drives the
 * calendar, and the unlockable list drives the capture loop.
 *
 * Registered as a tool rather than called directly from a screen because of
 * CLAUDE.md invariant 1 — SPARK plans a month by calling exactly what the Calendar
 * UI calls. Pure compute, so it is `read`/`auto` and costs nothing.
 */

const RankedPlaybook = z.object({
  playbook_id: z.string(),
  name: z.string(),
  mode: z.enum(['synthesize', 'assemble', 'direct_finish']),
  content_pillar: z.enum(['educational', 'product', 'proof', 'personality', 'community']),
  score: z.number(),
  unlockable: z.boolean(),
  missing_roles: z.array(z.string()),
  /**
   * How `missing_roles` gets closed, absent when nothing is missing.
   *
   * The Draft Panel needs this to know whether to offer a format as pickable, or
   * to say what file would unlock it. Without it the panel could only ask "is
   * this direct_finish?", which is why an upload-unlockable format had no way to
   * appear at all.
   */
  unlocked_by: z.enum(['upload', 'capture']).optional(),
});

export const playbookResolve = defineTool({
  name: 'playbook.resolve',
  version: 1,

  summary:
    'Rank which content playbooks this brand can run, given its genome and the assets it ' +
    'already has. Also returns playbooks that are unlockable if the owner films something, ' +
    'plus the pillar mix. Free, instant. Call before planning a campaign or filling a calendar.',

  input: z.object({
    genomeId: z.string(),
    /** Override the live Asset Graph counts — used for "what if I filmed X?" planning. */
    assumeAssets: z.record(z.string(), z.number().int().min(0)).optional(),
  }),

  output: z.object({
    genomeId: z.string(),
    profile: z.string(),
    ranked: z.array(RankedPlaybook),
    /** The subset needing a capture brief — this is what the capture loop consumes. */
    unlockable: z.array(RankedPlaybook),
    mix: z.object({
      source: z.enum(['cold_start', 'learned']),
      weights: z.record(z.string(), z.number()),
    }),
    why: z.object({
      summary: z.string(),
      factors: z.array(z.object({ label: z.string(), detail: z.string().optional(), weight: z.number().optional() })),
      evidence: z
        .array(z.object({ kind: z.enum(['rule', 'asset']), id: z.string(), note: z.string().optional() }))
        .default([]),
      alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
    }),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['CAL-03', 'CMP-01.2', 'CC-01'],

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
    }

    const live = await ctx.db.assets.inventory(input.genomeId, ctx.orgId);
    const assets = (input.assumeAssets ?? live) as AssetInventory;

    const { ranked, rejected } = resolve(genome, assets);
    const mix = deriveMix(genome);

    const shape = (r: (typeof ranked)[number]) => ({
      playbook_id: r.playbook.playbook_id,
      name: r.playbook.name,
      mode: r.playbook.mode,
      content_pillar: r.playbook.content_pillar,
      score: Number(r.score.toFixed(4)),
      unlockable: r.unlockable,
      missing_roles: r.missingRoles,
      ...(r.unlockedBy ? { unlocked_by: r.unlockedBy } : {}),
    });

    /**
     * Still only the capture route, because this field is what the capture loop
     * consumes — its own comment above says so, and `direct.brief.generate`
     * cannot write a brief for "upload your logo".
     *
     * `r.unlockable` alone would now include upload-unlockable playbooks and
     * quietly hand the capture loop work it cannot brief.
     */
    const unlockable = ranked.filter((r) => r.unlockable && r.unlockedBy === 'capture');
    ctx.logger.info('playbooks resolved', {
      genomeId: input.genomeId,
      ranked: ranked.length,
      unlockable: unlockable.length,
    });

    return {
      genomeId: input.genomeId,
      profile: mix.profile,
      ranked: ranked.map(shape),
      unlockable: unlockable.map(shape),
      mix: { source: mix.source, weights: mix.weights as Record<string, number> },
      why: {
        summary: resolveSummary(mix.profile, ranked),
        factors: [
          ...(ranked[0] ? ranked[0].factors : []),
          { label: 'mix', detail: mix.why },
          // Naming what was ruled out and why is what makes the gap honest —
          // the outcomes doc §3.3 is explicit that exposing the gap is what converts.
          {
            label: 'ruled out',
            detail: rejected
              .slice(0, 4)
              .map((r) => `${r.playbook_id}: ${r.because}`)
              .join('; '),
          },
        ],
        evidence: [
          { kind: 'rule' as const, id: 'engine_spec.§5.2', note: 'Preconditions over genome dimensions.' },
          { kind: 'rule' as const, id: 'engine_spec.§7.1', note: 'Cold-start pillar weights.' },
        ],
        alternatives: rejected.slice(0, 3).map((r) => ({ option: r.playbook_id, rejectedBecause: r.because })),
      },
    };
  },
});

/**
 * The one sentence every format picker leads with.
 *
 * Three states, not two, and the count of each is the whole message: what is
 * postable now, what one upload away, and what needs filming. Getting this
 * wrong is how the product ends up recommending the most expensive action
 * available.
 *
 * Its history is the argument for spelling all three out. It began as
 * "N formats fit this X, M of them once something gets filmed", which had no
 * case for *everything* needing assets and so told a brand-new brand that some
 * subset was ready when none was. Narrowing `unlockable` to the capture route —
 * correct, because the capture loop cannot brief an upload — then broke it the
 * other way: with 14 upload-unlockable and 7 filmable it read "21 formats fit
 * this local business, 7 of them once something gets filmed", which reads as
 * fourteen ready to go. Zero were.
 */
function resolveSummary(profile: string, ranked: readonly ResolvedPlaybook[]): string {
  const subject = profile.replace('_', ' ');
  const now = ranked.filter((r) => !r.unlockable).length;
  const uploads = ranked.filter((r) => r.unlockedBy === 'upload').length;
  const films = ranked.filter((r) => r.unlockedBy === 'capture').length;

  if (uploads === 0 && films === 0) {
    return `${ranked.length} formats fit this ${subject} from assets already on hand.`;
  }

  // Named in ascending order of effort, so the cheapest thing to do next is the
  // first thing read.
  const parts: string[] = [];
  if (now > 0) parts.push(`${now} ready to post now`);
  if (uploads > 0) parts.push(`${uploads} one upload away`);
  if (films > 0) parts.push(`${films} needing something filmed`);

  // No index arithmetic on `parts`: the "ready now" clause is only pushed when
  // there is something ready, so there is never a leading entry to drop. An
  // earlier attempt to strip one dropped the *uploads* clause instead, and the
  // sentence lost the only cheap route it had to offer.
  const head =
    now === 0
      ? `${ranked.length} formats fit this ${subject}, none ready to post yet`
      : `${ranked.length} formats fit this ${subject}`;
  return `${head} — ${parts.join(', ')}.`;
}
