import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { makeDraftVariants, makeDraftRepurpose } from '../src/variants.js';
import type { TextWriter } from '../src/types.js';

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const withCta = { ...genome, offer: { ...genome.offer, primary_cta: 'Start a free trial' } };

const embed = { embed: async () => Array.from({ length: 8 }, () => 0.1) };

/** Unlike an echo writer, returns different text each call — the natural
 * model-sampling variety `draft.variants` relies on, made deterministic for
 * assertions instead of actually hitting a model. */
function sequencedWriter(): TextWriter {
  let n = 0;
  return { write: async ({ promptRef }) => `take ${++n} of ${promptRef}` };
}

function existingDraft(over: Partial<{ playbookId: string; copy: unknown }> = {}) {
  return {
    id: 'ci_1',
    genomeId: 'gen_saas',
    playbookId: over.playbookId ?? 'pb_text_update',
    mode: 'synthesize' as const,
    status: 'draft',
    copy: over.copy ?? [{ kind: 'text', beatId: 'b1', text: 'original copy' }],
    createdAt: new Date(),
  };
}

function ctx(over: {
  get?: ScopedDb['content']['get'];
  createDraft?: ScopedDb['content']['createDraft'];
  genomeGet?: ScopedDb['genomes']['get'];
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_gen_saas',
    genomeId: 'gen_saas',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        get: over.genomeGet ?? (async () => withCta),
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: {
        recent: async () => [],
        createDraft: over.createDraft ?? (async (args) => ({
          id: 'ci_new', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
          status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
        })),
        get: over.get ?? (async () => existingDraft()),
        updateDraft: async () => undefined,
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('draft.variants', () => {
  it('generates the requested number of independent takes, nothing persisted', async () => {
    const createDraft = vi.fn();
    const tool = makeDraftVariants({ text: sequencedWriter(), embed });

    const out = await tool.handler({ genomeId: 'gen_saas', contentItemId: 'ci_1', count: 3 }, ctx({ createDraft: createDraft as never }));

    expect(out.variants).toHaveLength(3);
    // Each variant's copy beat actually differs — real variety, not the same
    // text returned three times.
    const texts = out.variants.map((v) => (v.beats[0] as { text: string }).text);
    expect(new Set(texts).size).toBe(3);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('defaults to 2 variants', async () => {
    const tool = makeDraftVariants({ text: sequencedWriter(), embed });
    // `.parse()`'s own default, exercised the same way `invokeTool` would —
    // calling `.handler()` directly bypasses that parse step.
    const parsed = tool.input.parse({ genomeId: 'gen_saas', contentItemId: 'ci_1' });
    const out = await tool.handler(parsed, ctx());
    expect(out.variants).toHaveLength(2);
  });

  it('is read effect and idempotent — a preview, not a mutation', () => {
    const tool = makeDraftVariants({ text: sequencedWriter(), embed });
    expect(tool.effect).toBe('read');
    expect(tool.idempotent).toBe(true);
  });

  it('throws NOT_FOUND for an unknown content item', async () => {
    const tool = makeDraftVariants({ text: sequencedWriter(), embed });
    await expect(
      tool.handler({ genomeId: 'gen_saas', contentItemId: 'ci_missing', count: 2 }, ctx({ get: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });
});

describe('draft.repurpose', () => {
  it('creates a new draft under the target playbook, leaving the source untouched', async () => {
    const createDraft = vi.fn(async (args: Parameters<ScopedDb['content']['createDraft']>[0]) => ({
      id: 'ci_repurposed', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
      status: 'draft' as const, copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeDraftRepurpose({ text: sequencedWriter(), embed });

    const out = await tool.handler(
      { genomeId: 'gen_saas', sourceContentItemId: 'ci_1', targetPlaybookId: 'pb_text_update' },
      ctx({ createDraft }),
    );

    expect(out.contentItemId).toBe('ci_repurposed');
    expect(out.sourceContentItemId).toBe('ci_1');
    expect(out.playbookId).toBe('pb_text_update');
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it('derives intent from the source draft’s own written copy when none is given', async () => {
    const createDraft = vi.fn(async (args: Parameters<ScopedDb['content']['createDraft']>[0]) => ({
      id: 'ci_new', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
      status: 'draft' as const, copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const get = async () => existingDraft({ copy: [{ kind: 'text', beatId: 'b1', text: 'our new scheduler ships this week' }] });
    const tool = makeDraftRepurpose({ text: sequencedWriter(), embed });

    await tool.handler({ genomeId: 'gen_saas', sourceContentItemId: 'ci_1', targetPlaybookId: 'pb_text_update' }, ctx({ get, createDraft }));

    // Not asserting the exact derived string (that's an implementation
    // detail) — asserting the pipeline ran at all without a caller-supplied
    // intent, which is the actual behavior being tested.
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it('refuses a direct_finish target playbook — that pipeline is filmed, not drafted', async () => {
    const tool = makeDraftRepurpose({ text: sequencedWriter(), embed });
    await expect(
      tool.handler({ genomeId: 'gen_saas', sourceContentItemId: 'ci_1', targetPlaybookId: 'pb_craft_capture' }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('throws NOT_FOUND for an unknown source draft', async () => {
    const tool = makeDraftRepurpose({ text: sequencedWriter(), embed });
    await expect(
      tool.handler({ genomeId: 'gen_saas', sourceContentItemId: 'ci_missing', targetPlaybookId: 'pb_text_update' }, ctx({ get: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('throws NOT_FOUND for an unknown target playbook', async () => {
    const tool = makeDraftRepurpose({ text: sequencedWriter(), embed });
    await expect(
      tool.handler({ genomeId: 'gen_saas', sourceContentItemId: 'ci_1', targetPlaybookId: 'pb_does_not_exist' }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('is not idempotent — repurposing again creates a second draft, not a replay', () => {
    const tool = makeDraftRepurpose({ text: sequencedWriter(), embed });
    expect(tool.idempotent).toBe(false);
  });
});
