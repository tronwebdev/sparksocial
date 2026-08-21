import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, AssetRole, ASSET_ROLE_WORDS, ASSET_ROLE_SUPPLY } from '@sparksocial/shared';
import { resolve } from '@sparksocial/playbooks';
import type { AssetInventory } from '@sparksocial/playbooks';

/**
 * `asset.gaps` — engine spec §4.4.
 *
 *   GET /v1/assets/gaps?workspace_id=…&horizon_days=30
 *   → [{ missing_role, playbook_blocked, impact, suggested_brief_id }]
 *
 * This is what drives the capture loop, and it is meant to be surfaced
 * conversationally rather than as an error state (§4.4):
 *
 *   *"I can plan your month, but I only have four usable photos. Give me 90
 *   seconds of filming and I can build 12 posts instead of 4."*
 *
 * The tool is a thin wrapper over the resolver: `resolve()` already computes,
 * for every playbook, whether it is producible now or blocked on missing assets
 * (`rejected` for hard blocks, `unlockable` ranked entries for direct_finish
 * playbooks that could be filmed). `asset.gaps` groups that by missing role and
 * quantifies the impact — "8 of 12 resolvable posts" — which is the number that
 * makes the ask concrete instead of vague.
 *
 * `suggestedBriefId` is null until `direct.brief.generate` exists; this tool
 * reports the gap, brief generation closes it.
 */

export const AssetGapsInput = z.object({
  genomeId: z.string(),
  /** Reserved for the plan's `horizon_days` — unused until campaigns exist to bound it. */
  horizonDays: z.number().int().min(1).max(90).default(30),
});

const Gap = z.object({
  missingRole: AssetRole,
  playbooksBlocked: z.array(z.string()),
  impact: z.string(),
  /**
   * `'upload'` — a file the owner already has. `'capture'` — the Direct+Finish
   * loop, which costs them an afternoon.
   *
   * Reported per gap because the effort is the deciding fact and the count alone
   * hides it. A brand with nothing has a 7-format filming gap and a 7-format
   * brand-kit gap; ranked on count they tie, and the honest recommendation is
   * unambiguous only once the screen can say which one is a logo file.
   */
  unlockedBy: z.enum(['upload', 'capture']),
  suggestedBriefId: z.string().nullable(),
});

export const AssetGapsOutput = z.object({
  genomeId: z.string(),
  gaps: z.array(Gap),
  /** Playbooks producible right now, for contrast with what filming would unlock. */
  producibleNow: z.number().int(),
  producibleIfFilmed: z.number().int(),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export const assetGaps = defineTool({
  name: 'asset.gaps',
  version: 1,

  summary:
    'Report which content formats are blocked on missing footage or photos, and how many more posts ' +
    'filming would unlock. Use this to make the capture ask concrete — "N posts now, M if you film ' +
    'for a few minutes" — never as a bare error.',

  input: AssetGapsInput,
  output: AssetGapsOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['LIB-01', 'CMP-01.5'],

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
    }

    const assets: AssetInventory = await ctx.db.assets.inventory(input.genomeId, ctx.orgId);
    const { ranked } = resolve(genome, assets);

    const unlockable = ranked.filter((r) => r.unlockable);
    const producibleNow = ranked.length - unlockable.length;

    // Group unlockable playbooks by the roles they're missing — one role can
    // block several playbooks, and a business only needs to hear about it once.
    //
    // `rejected` is deliberately not consulted, and that is only now safe:
    // resolve() rejects on dimensions and talent alone, never on a missing
    // asset, so every closeable gap really is in `unlockable`. It used to reject
    // any non-direct_finish playbook whose assets were absent, which made this
    // comment's claim false and cost this tool most of its answer — a brand with
    // an empty library was told to film, because filming was the only route the
    // resolver had bothered to keep.
    const byRole = new Map<string, string[]>();
    for (const r of unlockable) {
      for (const role of r.missingRoles) {
        byRole.set(role, [...(byRole.get(role) ?? []), r.playbook.playbook_id]);
      }
    }

    const gaps = [...byRole.entries()]
      .map(([role, playbooks]) => ({
        missingRole: role as z.infer<typeof AssetRole>,
        playbooksBlocked: playbooks,
        impact: `${playbooks.length} of ${ranked.length} resolvable posts`,
        unlockedBy: ASSET_ROLE_SUPPLY[role as z.infer<typeof AssetRole>],
        suggestedBriefId: null,
      }))
      /**
       * Cheapest route first, then impact within it.
       *
       * Sorting on impact alone put filming at the top of a brand-new brand's
       * list, tied on count with a gap that is one logo file. Ordering by effort
       * first is what makes the list a sequence of next actions rather than a
       * league table: do the uploads, then book the shoot.
       */
      .sort((a, b) =>
        a.unlockedBy === b.unlockedBy
          ? b.playbooksBlocked.length - a.playbooksBlocked.length
          : a.unlockedBy === 'upload'
            ? -1
            : 1,
      );

    ctx.logger.info('asset gaps computed', { genomeId: input.genomeId, gaps: gaps.length });

    return {
      genomeId: input.genomeId,
      gaps,
      producibleNow,
      producibleIfFilmed: ranked.length,
      why: {
        /**
         * Leads with the cheapest real next action, not the biggest number.
         *
         * The old sentence was built entirely around filming — *"7 are possible
         * if you film to close 1 gap — physical capture would unlock the most"* —
         * because filming was the only route the resolver kept. For a brand that
         * has uploaded nothing that was both the most expensive suggestion
         * available and, on count, not even the best one: a single brand-kit file
         * unlocked as many formats, one of which outscored everything reachable
         * without a camera.
         *
         * Both routes are named when both exist, uploads first, because they are
         * genuinely sequential — a logo takes a minute and a shoot takes an
         * afternoon, and someone who does the first is further along before they
         * have decided about the second.
         */
        summary: buildGapSummary(producibleNow, gaps),
        factors: gaps.map((g) => ({
          label: ASSET_ROLE_WORDS[g.missingRole],
          detail:
            `${g.unlockedBy === 'upload' ? 'a file you upload' : 'needs filming'} — ` +
            `blocks ${g.playbooksBlocked.join(', ')}`,
        })),
        evidence: [{ kind: 'rule' as const, id: 'engine_spec.§4.4', note: 'Gap detection drives the capture loop.' }],
        alternatives: [],
      },
    };
  },
});

/**
 * The one sentence the Assets Library leads with.
 *
 * Kept out of the handler because the branching is the substance: which routes
 * exist decides what the owner should do next, and that is worth reading in one
 * place rather than assembled inline inside a `why`.
 */
function buildGapSummary(
  producibleNow: number,
  gaps: ReadonlyArray<{ missingRole: z.infer<typeof AssetRole>; playbooksBlocked: string[]; unlockedBy: 'upload' | 'capture' }>,
): string {
  if (gaps.length === 0) return 'Every resolvable format is producible from assets already on hand.';

  const ready =
    producibleNow === 0
      ? 'Nothing is ready to post yet'
      : `${producibleNow} ${producibleNow === 1 ? 'post is' : 'posts are'} ready now`;

  // Counted per route rather than summed across gaps: one playbook can be
  // blocked by two roles, and adding the gaps up would promise it twice.
  const count = (route: 'upload' | 'capture') =>
    new Set(gaps.filter((g) => g.unlockedBy === route).flatMap((g) => g.playbooksBlocked)).size;

  const uploads = gaps.filter((g) => g.unlockedBy === 'upload');
  const films = gaps.filter((g) => g.unlockedBy === 'capture');

  const parts: string[] = [];
  if (uploads.length) {
    const best = uploads[0]!;
    parts.push(
      `uploading ${aOrAn(ASSET_ROLE_WORDS[best.missingRole])} unlocks ${best.playbooksBlocked.length} ` +
        `${best.playbooksBlocked.length === 1 ? 'format' : 'formats'} with no filming`,
    );
  }
  if (films.length) {
    parts.push(`filming opens ${count('capture')} more`);
  }

  return `${ready} — ${parts.join(', and ')}.`;
}

/** "a brand kit", "an audio clip" — the article the role's own words need. */
function aOrAn(words: string): string {
  return `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`;
}
