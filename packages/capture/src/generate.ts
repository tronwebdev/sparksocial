import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import { generateValidatedBrief, type BriefWriter } from './writer.js';
import { CaptureBrief } from './schema.js';

/**
 * `direct.brief.generate` — engine spec §6.1 step 2, §6.2.
 *
 * Produces exactly one capture brief and holds it to the quality bar
 * (`validateBrief`) before returning it — "generated briefs must pass a
 * validator before send" is not optional. A brief that fails after retries
 * throws `UPSTREAM_FAILED` rather than shipping something vague.
 *
 * Called directly for a one-off ask; `direct.session.batch` is what actually
 * reaches the owner, because §6.3 forbids sending briefs one at a time.
 */

export const BriefGenerateInput = z.object({
  genomeId: z.string(),
  playbookId: z.string(),
});

export const BriefGenerateOutput = z.object({
  brief: CaptureBrief,
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export function makeBriefGenerate(deps: BriefWriter) {
  return defineTool({
    name: 'direct.brief.generate',
    version: 1,

    summary:
      'Write one capture brief for a specific direct_finish playbook — exact camera position, ' +
      'orientation, duration, motion, audio, lighting, and what not to do. Validated before it is ' +
      'returned; never sends something vague. Cheap.',

    input: BriefGenerateInput,
    output: BriefGenerateOutput,

    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false, // each call mints a new brief with its own expiry
    surfaces: ['CMP-01.3'],
    estimateCents: () => 1,

    async handler(input, ctx) {
      const [genome, playbook] = await Promise.all([
        ctx.db.genomes.get(input.genomeId, ctx.orgId),
        Promise.resolve(byId(input.playbookId)),
      ]);
      if (!genome) throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
      if (!playbook) throw new ToolError('NOT_FOUND', `No playbook ${input.playbookId}.`, { playbookId: input.playbookId });
      if (playbook.mode !== 'direct_finish') {
        throw new ToolError(
          'INVALID_INPUT',
          `"${playbook.name}" is a ${playbook.mode} playbook — briefs are only for direct_finish.`,
          { playbookId: input.playbookId, mode: playbook.mode },
        );
      }

      const { brief, attempts } = await generateValidatedBrief(deps, playbook, genome);
      ctx.logger.info('brief generated', { genomeId: input.genomeId, playbookId: input.playbookId, attempts });

      return {
        brief,
        why: {
          summary: `A ${brief.duration_sec}s ${brief.orientation} clip of ${brief.subject}, for "${playbook.name}".`,
          factors: [
            { label: 'subject', detail: brief.subject },
            { label: 'framing', detail: brief.framing },
            ...(attempts > 1 ? [{ label: 'attempts', detail: `passed the validator on attempt ${attempts}` }] : []),
          ],
          evidence: [{ kind: 'rule' as const, id: 'engine_spec.§6.2', note: 'Vague briefs are rejected before send.' }],
          alternatives: [],
        },
      };
    },
  });
}
