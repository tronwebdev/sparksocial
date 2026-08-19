import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, AssetRole } from '@sparksocial/shared';
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
    // `rejected` is deliberately not consulted here: resolve() only rejects a
    // direct_finish playbook on dimension/talent grounds, never on missing
    // assets, so every genuinely closeable gap is already in `unlockable`.
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
        suggestedBriefId: null,
      }))
      .sort((a, b) => b.playbooksBlocked.length - a.playbooksBlocked.length);

    ctx.logger.info('asset gaps computed', { genomeId: input.genomeId, gaps: gaps.length });

    return {
      genomeId: input.genomeId,
      gaps,
      producibleNow,
      producibleIfFilmed: ranked.length,
      why: {
        summary:
          gaps.length === 0
            ? `Every resolvable format is producible from assets already on hand.`
            : `${producibleNow} posts are ready now; ${ranked.length} are possible if you film ` +
              `to close ${gaps.length} gap(s) — ${gaps[0]!.missingRole} would unlock the most.`,
        factors: gaps.map((g) => ({
          label: g.missingRole,
          detail: `blocks ${g.playbooksBlocked.join(', ')}`,
        })),
        evidence: [{ kind: 'rule' as const, id: 'engine_spec.§4.4', note: 'Gap detection drives the capture loop.' }],
        alternatives: [],
      },
    };
  },
});
