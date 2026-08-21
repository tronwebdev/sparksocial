import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import type { EmbedClient } from '@sparksocial/assemble';
import { resolvePlan, resolveBeat, buildOutline, ResolvedBeat, type ContentDraftDeps } from './draft.js';
import type { TextWriter } from './types.js';

/**
 * `draft.variants` / `draft.repurpose` — both reuse `content.draft`'s own
 * plan-then-write pipeline (`resolvePlan`/`resolveBeat`, exported from
 * `draft.ts` for exactly this). Neither reimplements beat resolution.
 */

/* ── draft.variants ──────────────────────────────────────────────────── */

export const DraftVariantsInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
  count: z.number().int().min(2).max(4).default(2),
});

const Variant = z.object({ beats: z.array(ResolvedBeat) });

export const DraftVariantsOutput = z.object({
  contentItemId: z.string(),
  variants: z.array(Variant),
  why: Explanation,
});

export function makeDraftVariants(deps: ContentDraftDeps) {
  return defineTool({
    name: 'draft.variants',
    version: 1,

    summary:
      'Generate several alternative takes on an existing draft’s written copy — same playbook, same assets, ' +
      'different phrasing — to compare before committing one. A preview: nothing is saved. Pass the chosen ' +
      'variant’s text back through content.draft to keep it.',

    input: DraftVariantsInput,
    output: DraftVariantsOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    // One LLM call per written beat, per variant.
    estimateCents: (raw) => {
      const parsed = DraftVariantsInput.safeParse(raw);
      return parsed.success ? parsed.data.count : 1;
    },

    async handler(input, ctx) {
      const draft = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!draft) throw new ToolError('NOT_FOUND', 'No such draft.', { contentItemId: input.contentItemId });

      const playbook = byId(draft.playbookId);
      if (!playbook) throw new ToolError('NOT_FOUND', `No playbook "${draft.playbookId}".`, { playbookId: draft.playbookId });

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      // Resolved once: for an assemble playbook this is also the asset
      // retrieval, which is deterministic given the same embedding — variants
      // differ in their *written* beats, not in which of the brand's own
      // assets get used.
      const plan = await resolvePlan(playbook, genome, { genomeId: input.genomeId, playbookId: playbook.playbook_id, intent: '' }, ctx, deps.embed);

      const variants = await Promise.all(
        Array.from({ length: input.count }, () =>
          Promise.all(plan.beats.map((beat) => resolveBeat(beat, { genome, playbook, intent: '', outline: buildOutline(plan.beats) }, deps.text))).then((beats) => ({ beats })),
        ),
      );

      return {
        contentItemId: draft.id,
        variants,
        why: {
          summary: `${input.count} alternative takes on the same ${playbook.name} — same assets, different copy.`,
          factors: [{ label: 'playbook', detail: playbook.name }, { label: 'variants', detail: String(input.count) }],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}

/* ── draft.repurpose ─────────────────────────────────────────────────── */

export const DraftRepurposeInput = z.object({
  genomeId: z.string().min(1),
  sourceContentItemId: z.string().min(1),
  targetPlaybookId: z.string().min(1),
  /** Defaults to the source draft's own written copy, concatenated — "what this post was about". */
  intent: z.string().max(500).optional(),
});

export const DraftRepurposeOutput = z.object({
  contentItemId: z.string(),
  sourceContentItemId: z.string(),
  playbookId: z.string(),
  mode: z.enum(['synthesize', 'assemble']),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']),
  beats: z.array(ResolvedBeat),
  why: Explanation,
});

export interface DraftRepurposeDeps {
  text: TextWriter;
  embed: EmbedClient;
}

export function makeDraftRepurpose(deps: DraftRepurposeDeps) {
  return defineTool({
    name: 'draft.repurpose',
    version: 1,

    summary:
      'Turn an existing draft into a different format — a Text Update into a Teaching Carousel, a testimonial ' +
      'into a quote card — by resolving a new playbook against the same underlying topic. Creates a new draft; ' +
      'the source is untouched.',

    input: DraftRepurposeInput,
    output: DraftRepurposeOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,

    estimateCents: (raw) => {
      const parsed = DraftRepurposeInput.safeParse(raw);
      const playbook = parsed.success ? byId(parsed.data.targetPlaybookId) : undefined;
      if (!playbook) return 1;
      return Math.max(1, playbook.structure.beats.filter((b) => !b.source).length);
    },

    async handler(input, ctx) {
      const source = await ctx.db.content.get(input.sourceContentItemId, input.genomeId, ctx.orgId);
      if (!source) throw new ToolError('NOT_FOUND', 'No such source draft.', { contentItemId: input.sourceContentItemId });

      const targetPlaybook = byId(input.targetPlaybookId);
      if (!targetPlaybook) {
        throw new ToolError('NOT_FOUND', `No playbook "${input.targetPlaybookId}".`, { playbookId: input.targetPlaybookId });
      }
      if (targetPlaybook.mode === 'direct_finish') {
        throw new ToolError('INVALID_INPUT', `${targetPlaybook.playbook_id} is filmed, not drafted.`, { playbookId: targetPlaybook.playbook_id });
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const sourceBeats = Array.isArray(source.copy) ? (source.copy as { kind: string; text?: string }[]) : [];
      const derivedIntent =
        input.intent ?? sourceBeats.filter((b) => b.kind === 'text' && b.text).map((b) => b.text).join(' ').slice(0, 500);

      const plan = await resolvePlan(
        targetPlaybook,
        genome,
        { genomeId: input.genomeId, playbookId: targetPlaybook.playbook_id, intent: derivedIntent },
        ctx,
        deps.embed,
      );

      const beats = await Promise.all(
        plan.beats.map((beat) => resolveBeat(beat, { genome, playbook: targetPlaybook, intent: derivedIntent, outline: buildOutline(plan.beats) }, deps.text)),
      );

      const why: Explanation = {
        summary: `Repurposed as a ${targetPlaybook.name}, carrying forward the same topic as the original.`,
        factors: [
          { label: 'source', detail: input.sourceContentItemId },
          { label: 'target playbook', detail: targetPlaybook.name },
        ],
        evidence: [],
        alternatives: [],
      };

      const draft = await ctx.db.content.createDraft({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        playbookId: targetPlaybook.playbook_id,
        mode: targetPlaybook.mode,
        ...(targetPlaybook.content_pillar ? { pillar: targetPlaybook.content_pillar } : {}),
        copy: beats,
        why,
      });

      ctx.logger.info('draft repurposed', {
        genomeId: input.genomeId,
        sourceContentItemId: input.sourceContentItemId,
        contentItemId: draft.id,
        targetPlaybookId: targetPlaybook.playbook_id,
      });

      return {
        contentItemId: draft.id,
        sourceContentItemId: input.sourceContentItemId,
        playbookId: targetPlaybook.playbook_id,
        mode: targetPlaybook.mode as 'synthesize' | 'assemble',
        mediaType: plan.mediaType,
        beats,
        why,
      };
    },
  });
}
