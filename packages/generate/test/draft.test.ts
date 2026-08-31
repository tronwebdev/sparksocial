import { describe, expect, it, vi } from 'vitest';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { makeContentDraft } from '../src/draft.js';
import type { TextWriter } from '../src/types.js';

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const withCta = { ...genome, offer: { ...genome.offer, primary_cta: 'Start a free trial' } };

const embed = { embed: async () => Array.from({ length: 8 }, () => 0.1) };

function echoWriter(): TextWriter {
  return { write: async ({ promptRef }) => `written: ${promptRef}` };
}

function ctx(over: {
  retrieve?: ScopedDb['assets']['retrieve'];
  genomeGet?: ScopedDb['genomes']['get'];
  createDraft?: ScopedDb['content']['createDraft'];
  updateDraft?: ScopedDb['content']['updateDraft'];
  contentGet?: ScopedDb['content']['get'];
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
        retrieve:
          over.retrieve ??
          (async () => [
            { assetId: 'a1', role: 'product_screen', caption: 'the scheduler', score: 0.9,
              usageCount: 0, lastUsedAt: null, rightsStatus: 'cleared' },
          ]),
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: {
        recent: async () => [],
        createDraft: over.createDraft ?? (async (args) => ({
          id: 'ci_1', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
          status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
        })),
        get: over.contentGet ?? (async () => undefined),
        updateDraft: over.updateDraft ?? (async (args) => ({
          id: args.id, genomeId: args.genomeId, playbookId: 'pb_offer_announcement', mode: 'assemble',
          status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
        })),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('content.draft — the registry contract', () => {
  const tool = makeContentDraft({ text: echoWriter(), embed });

  it('is not idempotent — regeneration is the point, not a safe replay', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external — nothing leaves the workspace', () => {
    expect(tool.effect).toBe('write');
  });

  it('estimates cost from the number of copy beats the chosen playbook needs', () => {
    // pb_text_update: one beat, no source.
    expect(tool.estimateCents?.({ genomeId: 'g', playbookId: 'pb_text_update', intent: '' })).toBe(1);
    // pb_offer_announcement: one prompt_ref beat + one genome: beat + one asset: beat.
    expect(
      tool.estimateCents?.({ genomeId: 'g', playbookId: 'pb_offer_announcement', intent: '' }),
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('content.draft — synthesize mode', () => {
  it('writes every copy beat via the text writer and creates a new draft', async () => {
    const createDraft = vi.fn<ScopedDb['content']['createDraft']>(async (args) => ({
      id: 'ci_new', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentDraft({ text: echoWriter(), embed });

    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' },
      ctx({ createDraft }),
    );

    expect(res.mode).toBe('synthesize');
    expect(res.mediaType).toBe('text');
    // `durationSec` and `label` are part of the beat as of the draft owning its
    // own structure, and they are asserted here rather than loosened away with
    // `toMatchObject`: the whole point of that change is that a beat records its
    // own timing, so a draft that stopped stamping it would be the regression.
    expect(res.beats).toEqual([
      { kind: 'text', beatId: 'copy', text: 'written: text.update', durationSec: 0, label: 'Copy' },
    ]);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
});

describe('content.draft — assemble mode', () => {
  it('retrieves assets, writes copy beats, and resolves genome: beats to literal text', async () => {
    const tool = makeContentDraft({ text: echoWriter(), embed });

    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', intent: '' },
      ctx(),
    );

    expect(res.mode).toBe('assemble');
    // pb_offer_announcement's only beat is a prompt_ref ('offer.scarcity'); no asset/genome beats.
    expect(res.beats.some((b) => b.kind === 'text')).toBe(true);
  });

  it('regenerates an existing slot via contentItemId, calling updateDraft not createDraft', async () => {
    const createDraft = vi.fn();
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_offer_announcement', mode: 'assemble',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentDraft({ text: echoWriter(), embed });

    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', contentItemId: 'ci_existing', intent: '' },
      ctx({ createDraft, updateDraft }),
    );

    expect(res.contentItemId).toBe('ci_existing');
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the slot is out of scope, published, or gone', async () => {
    const tool = makeContentDraft({ text: echoWriter(), embed });
    await expect(
      tool.handler(
        { genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', contentItemId: 'ci_gone', intent: '' },
        ctx({ updateDraft: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('content.draft — guard rails', () => {
  const tool = makeContentDraft({ text: echoWriter(), embed });

  it('404s on an unknown playbook', async () => {
    await expect(
      tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_nope', intent: '' }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a direct_finish playbook — that pipeline is direct.brief.generate', async () => {
    await expect(
      tool.handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture', intent: '' }, ctx()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('404s on an unknown genome', async () => {
    await expect(
      tool.handler(
        { genomeId: 'gen_x', playbookId: 'pb_text_update', intent: '' },
        ctx({ genomeGet: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * THE REDRAFT GUARD.
 *
 * Regenerating an existing slot rebuilds the beat list from the playbook, which
 * is the point — "another take" is the Draft Panel's most-used button. Since the
 * draft owns its structure that rebuild also discards whatever `content.scene.*`
 * did, and the response looks like an ordinary draft either way, so the loss is
 * invisible without a gate.
 */
describe('content.draft — hand-edited storyboards', () => {
  const tool = makeContentDraft({ text: echoWriter(), embed });

  /** As `content.draft` itself writes it: `pb_offer_announcement`'s one beat, untouched. */
  const asDrafted = (over: Record<string, unknown> = {}) => [
    { kind: 'text', beatId: 'offer', text: 'Two weeks left.', durationSec: 0, label: 'Offer', ...over },
  ];

  const existing = (copy: unknown): ScopedDb['content']['get'] =>
    async () => ({
      id: 'ci_existing', genomeId: 'gen_saas', playbookId: 'pb_offer_announcement',
      mode: 'assemble' as const, status: 'draft', copy, createdAt: new Date(),
    });

  const redraft = (contentGet: ScopedDb['content']['get'], discardSceneEdits?: boolean) =>
    tool.handler(
      {
        genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', contentItemId: 'ci_existing',
        intent: '', ...(discardSceneEdits === undefined ? {} : { discardSceneEdits }),
      },
      ctx({ contentGet }),
    );

  it('regenerates freely over a draft nobody has touched', async () => {
    // Nearly every call. The guard must not make the ordinary path ask permission.
    await expect(redraft(existing(asDrafted()))).resolves.toMatchObject({ contentItemId: 'ci_existing' });
  });

  it('refuses when a scene has been inserted', async () => {
    const withScene = [...asDrafted(), { kind: 'text', beatId: 'scene_1', text: 'Added.', durationSec: 4 }];
    await expect(redraft(existing(withScene))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses when a scene has been retimed', async () => {
    await expect(redraft(existing(asDrafted({ durationSec: 9 })))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses when a scene carries a voice override', async () => {
    await expect(redraft(existing(asDrafted({ voice: 'brand' })))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('proceeds when the caller says to discard the edits', async () => {
    const withScene = [...asDrafted(), { kind: 'text', beatId: 'scene_1', text: 'Added.', durationSec: 4 }];
    const res = await redraft(existing(withScene), true);
    // Rebuilt from the playbook, so the added scene is gone — which is what was confirmed.
    expect(res.beats.map((b) => b.beatId)).not.toContain('scene_1');
  });

  it('does not fire on a legacy draft with no durations of its own', async () => {
    // Pre-24-August rows carry neither `durationSec` nor `label`. Absent is not
    // an edit, and treating it as one would lock every old draft out of redrafting.
    await expect(
      redraft(existing([{ kind: 'text', beatId: 'offer', text: 'Two weeks left.' }])),
    ).resolves.toMatchObject({ contentItemId: 'ci_existing' });
  });

  it('does not fire on an empty slot', async () => {
    // A calendar slot from `calendar.generate` has no copy at all; filling it is
    // the first draft, not a regeneration over somebody's work.
    await expect(redraft(existing([]))).resolves.toMatchObject({ contentItemId: 'ci_existing' });
  });
});
