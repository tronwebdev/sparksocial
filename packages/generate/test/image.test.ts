import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeContentGenerateImage } from '../src/image.js';
import type { ImageClient } from '../src/types.js';

const draftBeats = [
  { kind: 'text' as const, beatId: 'hook', text: 'a card about our numbers' },
  { kind: 'asset' as const, beatId: 'proof', assetId: 'a1', role: 'social_proof' as const, caption: null },
];

function ctx(over: {
  get?: ScopedDb['content']['get'];
  updateDraft?: ScopedDb['content']['updateDraft'];
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_saas',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get:
          over.get ??
          (async () => ({
            id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_generated_quote_card', mode: 'synthesize',
            status: 'draft', copy: draftBeats, createdAt: new Date(),
          })),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
            status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
          })),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubImage(url = 'https://fal.example/img.png'): ImageClient {
  return { generate: vi.fn(async () => ({ url })) };
}

describe('content.generate_image — the registry contract', () => {
  const tool = makeContentGenerateImage(stubImage());

  it('is not idempotent — each call is a new, non-deterministic generation', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external', () => {
    expect(tool.effect).toBe('write');
  });
});

describe('content.generate_image', () => {
  it('replaces the named beat with a generated_image beat, leaving the rest untouched', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const image = stubImage('https://fal.example/card.png');
    const tool = makeContentGenerateImage(image);

    const res = await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a bold quote card', aspectRatio: '1:1' },
      ctx({ updateDraft }),
    );

    expect(res.url).toBe('https://fal.example/card.png');
    expect(image.generate).toHaveBeenCalledWith({ prompt: 'a bold quote card', aspectRatio: '1:1' });

    const savedCopy = updateDraft.mock.calls[0]![0].copy as typeof draftBeats;
    expect(savedCopy[0]).toEqual({ kind: 'generated_image', beatId: 'hook', url: 'https://fal.example/card.png', prompt: 'a bold quote card' });
    expect(savedCopy[1]).toEqual(draftBeats[1]); // the asset beat is untouched
  });

  /**
   * Generating media into a scene must not undo the scene.
   *
   * This replaces the beat wholesale — the beat *becomes* the image — which was
   * harmless while a beat held nothing but its id and its content. Since the
   * draft owns its structure it is not harmless: writing the new object without
   * `durationSec`/`label`/`voice` silently reset a retimed scene to the
   * playbook's length and dropped its badge. `keepStructure` is spread first for
   * exactly this, and the same fix applies to `_avatar_video`, `_broll`,
   * `_voiceover` and `_dub`.
   */
  it('carries the scene’s duration, label and voice across the change of kind', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const edited = [
      { kind: 'text' as const, beatId: 'hook', text: 'a card', durationSec: 7, label: 'Cover', voice: 'brand' as const },
    ];
    const tool = makeContentGenerateImage(stubImage('https://fal.example/card.png'));

    await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a bold quote card', aspectRatio: '1:1' },
      ctx({
        updateDraft,
        get: async () => ({
          id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_generated_quote_card', mode: 'synthesize',
          status: 'draft', copy: edited, createdAt: new Date(),
        }) as Awaited<ReturnType<ScopedDb['content']['get']>>,
      }),
    );

    expect((updateDraft.mock.calls[0]![0].copy as unknown[])[0]).toEqual({
      kind: 'generated_image',
      beatId: 'hook',
      url: 'https://fal.example/card.png',
      prompt: 'a bold quote card',
      durationSec: 7,
      label: 'Cover',
      voice: 'brand',
    });
  });

  it('404s when the draft does not exist or is out of scope', async () => {
    const tool = makeContentGenerateImage(stubImage());
    await expect(
      tool.handler(
        { contentItemId: 'ci_gone', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '1:1' },
        ctx({ get: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the beat does not exist on the draft', async () => {
    const tool = makeContentGenerateImage(stubImage());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'nope', prompt: 'x', aspectRatio: '1:1' },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the draft became unwritable between the read and the save (e.g. published)', async () => {
    const tool = makeContentGenerateImage(stubImage());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '1:1' },
        ctx({ updateDraft: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates the image client failure rather than saving a broken beat', async () => {
    const failing: ImageClient = { generate: vi.fn(async () => { throw new ToolError('UPSTREAM_FAILED', 'fal down'); }) };
    const updateDraft = vi.fn();
    const tool = makeContentGenerateImage(failing);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '1:1' },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
