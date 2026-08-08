import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { AssetRole, Explanation, ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import { buildRenderPlan, parseBeatSource, PlannedBeat, RenderPlan, type RetrievedAsset } from './plan.js';

/**
 * `assemble.plan` — the Assemble pipeline's planning step (plan §6.5).
 *
 * Takes a playbook the resolver has already chosen and produces the concrete
 * render plan for it: every beat filled with a real asset id, a real CTA, or a
 * prompt key. Read-only and idempotent — it decides *what* to render, never
 * renders anything and never mutates the Asset Graph.
 *
 * Retrieval happens here rather than being passed in, because the roles to
 * retrieve are a property of the playbook's beats, not something a caller
 * should have to work out and could get wrong. The caller says "plan this
 * playbook"; the tool works out what that needs.
 */

export const AssemblePlanInput = z.object({
  genomeId: z.string().min(1),
  playbookId: z.string().min(1),
  /**
   * What this specific post is about, used to rank assets. Optional: without it
   * the plan still works and simply ranks on role and freshness alone.
   */
  intent: z.string().max(500).default(''),
});

export const AssemblePlanOutput = z.object({
  plan: RenderPlan,
  why: Explanation,
});

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

/** Retrieval breadth per role. Enough alternatives to avoid reusing one asset
 *  across beats without pulling a brand's whole library into memory. */
const CANDIDATES_PER_ROLE = 4;

export function makeAssemblePlan(deps: EmbedClient) {
  return defineTool({
    name: 'assemble.plan',
    version: 1,

    summary:
      'Plan an Assemble post: fill a playbook’s beats with the brand’s own assets and CTA, ready to render. ' +
      'Fails with the missing asset roles when the Asset Graph cannot fill a beat — those are what to film next. ' +
      'Read-only, cheap.',

    input: AssemblePlanInput,
    output: AssemblePlanOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,

    async handler(input, ctx) {
      const playbook = byId(input.playbookId);
      if (!playbook) {
        throw new ToolError('NOT_FOUND', `No playbook "${input.playbookId}".`, { playbookId: input.playbookId });
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) {
        // Out of scope reads as absent, same rule as everywhere else.
        throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });
      }

      // Which roles do this playbook's beats actually ask for? Derived from the
      // beats rather than from `preconditions.required_asset_roles`: the
      // preconditions say what makes the playbook *eligible*, the beats say what
      // rendering it *consumes*, and only the second is what we must retrieve.
      const roles = requiredRoles(playbook.structure.beats);

      let assets: RetrievedAsset[] = [];
      if (roles.length > 0) {
        const embedding = await deps.embed(input.intent || playbook.description);
        const results = await ctx.db.assets.retrieve({
          genomeId: input.genomeId,
          orgId: ctx.orgId,
          embedding,
          requiredRoles: roles,
          k: roles.length * CANDIDATES_PER_ROLE,
        });
        assets = results.map((r) => ({
          assetId: r.assetId,
          role: r.role,
          caption: r.caption,
          score: r.score,
        }));
      }

      const { plan } = buildRenderPlan({ playbook, genome, assets });

      ctx.logger.info('assemble plan built', {
        genomeId: input.genomeId,
        playbookId: input.playbookId,
        beats: plan.beats.length,
        durationSec: plan.totalDurationSec,
      });

      return { plan, why: explain(plan, playbook.name, assets.length) };
    },
  });
}

/** The distinct asset roles a beat list consumes, in first-appearance order. */
export function requiredRoles(beats: Array<{ source?: string | undefined }>): AssetRole[] {
  const roles: AssetRole[] = [];
  for (const beat of beats) {
    if (!beat.source) continue;
    const parsed = parseBeatSource(beat.source);
    if (parsed.kind === 'asset' && !roles.includes(parsed.role)) roles.push(parsed.role);
  }
  return roles;
}

/**
 * CLAUDE.md invariant 4: which asset SPARK put in which beat is a decision the
 * user watches it make, so it carries a structured `why` rather than a log line.
 * Evidence lists the chosen assets by id, which is what `<WhyPopover />` needs
 * to link back to the library.
 */
function explain(plan: RenderPlan, playbookName: string, candidateCount: number): Explanation {
  const chosen = plan.beats.filter((b): b is Extract<PlannedBeat, { kind: 'asset' }> => b.kind === 'asset');
  const copy = plan.beats.filter((b) => b.kind === 'copy').length;

  return {
    // Reads in the Why popover, so it is written as a sentence rather than
    // assembled from counts: "1 of your own asset" is what the obvious
    // pluralisation produces, and it is wrong.
    summary:
      `Built a ${plan.totalDurationSec}s ${playbookName} from ` +
      `${chosen.length} ${chosen.length === 1 ? 'asset' : 'assets'} you already own` +
      `${copy ? ` and ${copy} written beat${copy === 1 ? '' : 's'}` : ''}.`,
    factors: [
      { label: 'playbook', detail: playbookName },
      { label: 'beats', detail: `${plan.beats.length} (${plan.totalDurationSec}s total)` },
      ...(chosen.length
        ? [{ label: 'assets used', detail: chosen.map((b) => b.role).join(', ') }]
        : []),
      ...(candidateCount > chosen.length
        ? [
            {
              label: 'ranked against',
              detail: `${candidateCount} candidates; best-scoring unused asset per beat`,
            },
          ]
        : []),
    ],
    evidence: chosen.map((b) => ({
      kind: 'asset' as const,
      id: b.assetId,
      note: b.caption ?? `${b.role} in "${b.beatId}"`,
    })),
    alternatives: [],
  };
}
