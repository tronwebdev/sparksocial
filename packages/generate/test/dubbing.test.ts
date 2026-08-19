import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeContentGenerateDub } from '../src/dubbing.js';
import type { DubbingClient } from '../src/types.js';

const draftBeats = [
  { kind: 'generated_broll' as const, beatId: 'hook', url: 'https://gen/hook.mp4', prompt: 'a factory floor' },
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
            id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_workflow_clip', mode: 'assemble',
            status: 'draft', copy: draftBeats, createdAt: new Date(),
          })),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id, genomeId: args.genomeId, playbookId: 'pb_workflow_clip', mode: 'assemble',
            status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
          })),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubDubbing(url = 'https://elevenlabs.example/dubbed.mp4'): DubbingClient {
  return { dub: vi.fn(async () => ({ url })) };
}

describe('content.generate_dub — the registry contract', () => {
  const tool = makeContentGenerateDub(stubDubbing());

  it('is not idempotent — each call is a new, non-deterministic generation', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external', () => {
    expect(tool.effect).toBe('write');
  });

  it('rejects an invalid source URL at the schema, before the tool runs', () => {
    expect(tool.input.safeParse({ contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', sourceUrl: 'not a url', mediaType: 'video', targetLanguage: 'es' }).success).toBe(false);
  });
});

describe('content.generate_dub', () => {
  it('replaces the named beat with a dubbed_media beat, leaving the rest untouched', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_workflow_clip', mode: 'assemble',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const dubbing = stubDubbing('https://elevenlabs.example/hook-es.mp4');
    const tool = makeContentGenerateDub(dubbing);

    const res = await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', sourceUrl: 'https://gen/hook.mp4', mediaType: 'video', targetLanguage: 'es' },
      ctx({ updateDraft }),
    );

    expect(res.url).toBe('https://elevenlabs.example/hook-es.mp4');
    expect(dubbing.dub).toHaveBeenCalledWith({ sourceUrl: 'https://gen/hook.mp4', targetLanguage: 'es', mediaType: 'video' });

    const savedCopy = updateDraft.mock.calls[0]![0].copy as typeof draftBeats;
    expect(savedCopy[0]).toEqual({ kind: 'dubbed_media', beatId: 'hook', url: 'https://elevenlabs.example/hook-es.mp4', targetLanguage: 'es', mediaType: 'video' });
    expect(savedCopy[1]).toEqual(draftBeats[1]); // the asset beat is untouched
  });

  it('404s when the draft does not exist or is out of scope', async () => {
    const tool = makeContentGenerateDub(stubDubbing());
    await expect(
      tool.handler(
        { contentItemId: 'ci_gone', genomeId: 'gen_saas', beatId: 'hook', sourceUrl: 'https://gen/hook.mp4', mediaType: 'video', targetLanguage: 'es' },
        ctx({ get: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the beat does not exist on the draft', async () => {
    const tool = makeContentGenerateDub(stubDubbing());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'nope', sourceUrl: 'https://gen/hook.mp4', mediaType: 'video', targetLanguage: 'es' },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the draft became unwritable between the read and the save (e.g. published)', async () => {
    const tool = makeContentGenerateDub(stubDubbing());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', sourceUrl: 'https://gen/hook.mp4', mediaType: 'video', targetLanguage: 'es' },
        ctx({ updateDraft: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates the dubbing client failure rather than saving a broken beat', async () => {
    const failing: DubbingClient = { dub: vi.fn(async () => { throw new ToolError('UPSTREAM_FAILED', 'elevenlabs down'); }) };
    const updateDraft = vi.fn();
    const tool = makeContentGenerateDub(failing);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', sourceUrl: 'https://gen/hook.mp4', mediaType: 'video', targetLanguage: 'es' },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
