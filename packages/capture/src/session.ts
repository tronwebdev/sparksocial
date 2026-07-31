import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { resolve } from '@sparksocial/playbooks';
import type { AssetInventory } from '@sparksocial/playbooks';
import { generateValidatedBrief, type BriefWriter } from './writer.js';
import { CaptureBrief } from './schema.js';

/**
 * `direct.session.batch` — engine spec §6.3.
 *
 *   *"Never send briefs one at a time. Send a weekly capture session: 3–5
 *   briefs, ~5 minutes total, one sitting. Local business owners will not
 *   respond to daily nags."*
 *
 * This is the tool that actually reaches the owner (over WhatsApp, once that
 * channel is wired) — `direct.brief.generate` produces one brief in isolation,
 * this bundles the resolver's unlockable playbooks into one weekly ask and
 * enforces the ~5-minute budget as a real constraint, not a comment: briefs are
 * added highest-impact first (most playbooks unlocked) and stop the moment the
 * running total would exceed it, rather than being trimmed after the fact.
 */

const SESSION_BUDGET_SEC = 5 * 60;
const MIN_BRIEFS = 3;
const MAX_BRIEFS = 5;

export const SessionBatchInput = z.object({
  genomeId: z.string(),
});

export const SessionBatchOutput = z.object({
  genomeId: z.string(),
  briefs: z.array(CaptureBrief),
  totalEffortSec: z.number(),
  /** Unlockable playbooks that didn't make this week's session — next week's candidates. */
  deferred: z.array(z.string()),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export function makeSessionBatch(deps: BriefWriter) {
  return defineTool({
    name: 'direct.session.batch',
    version: 1,

    summary:
      'Build this week\'s capture session: 3-5 briefs bundled into one ask, budgeted to about five ' +
      'minutes of filming total. Never call direct.brief.generate in a loop instead of this — one at ' +
      'a time is what makes owners stop responding.',

    input: SessionBatchInput,
    output: SessionBatchOutput,

    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    surfaces: ['CMP-01.3'],
    estimateCents: () => MAX_BRIEFS,

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });

      const assets: AssetInventory = await ctx.db.assets.inventory(input.genomeId, ctx.orgId);
      const { ranked } = resolve(genome, assets);

      // Highest-impact first: an unlockable playbook that's also the top-ranked
      // format is worth more of the owner's five minutes than a low-priority one.
      const candidates = ranked.filter((r) => r.unlockable);

      const briefs: z.infer<typeof CaptureBrief>[] = [];
      const deferred: string[] = [];
      let totalEffortSec = 0;

      for (const candidate of candidates) {
        if (briefs.length >= MAX_BRIEFS) {
          deferred.push(candidate.playbook.playbook_id);
          continue;
        }
        const { brief } = await generateValidatedBrief(deps, candidate.playbook, genome);
        if (totalEffortSec + brief.estimated_effort_sec > SESSION_BUDGET_SEC && briefs.length >= MIN_BRIEFS) {
          deferred.push(candidate.playbook.playbook_id);
          continue;
        }
        briefs.push(brief);
        totalEffortSec += brief.estimated_effort_sec;
      }

      ctx.logger.info('capture session batched', {
        genomeId: input.genomeId,
        briefs: briefs.length,
        totalEffortSec,
        deferred: deferred.length,
      });

      return {
        genomeId: input.genomeId,
        briefs,
        totalEffortSec,
        deferred,
        why: {
          summary:
            briefs.length === 0
              ? 'Nothing is unlockable by filming right now — every gap needs a different kind of asset.'
              : `${briefs.length} brief(s), about ${Math.round(totalEffortSec / 60)} min total — ` +
                `one sitting, not ${briefs.length} separate asks.`,
          factors: briefs.map((b) => ({ label: b.playbook_id, detail: `${b.duration_sec}s: ${b.subject}` })),
          evidence: [
            { kind: 'rule' as const, id: 'engine_spec.§6.3', note: 'Weekly batches, never one brief at a time.' },
          ],
          alternatives: deferred.map((id) => ({ option: id, rejectedBecause: 'deferred to next week\'s session' })),
        },
      };
    },
  });
}
