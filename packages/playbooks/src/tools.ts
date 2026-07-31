import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { resolve } from './resolver.js';
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
    });

    const unlockable = ranked.filter((r) => r.unlockable);
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
        summary:
          `${ranked.length} formats fit this ${mix.profile.replace('_', ' ')}` +
          (unlockable.length
            ? `, ${unlockable.length} of them once something gets filmed.`
            : ' from assets already on hand.'),
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
