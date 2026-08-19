import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeContentGenerateBroll } from '../src/broll.js';
import type { VideoClient } from '../src/types.js';

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

function stubVideo(url = 'https://fal.example/clip.mp4'): VideoClient {
  return { generate: vi.fn(async () => ({ url })) };
}

describe('content.generate_broll — the registry contract', () => {
  const tool = makeContentGenerateBroll(stubVideo());

  it('is not idempotent — each call is a new, non-deterministic generation', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external', () => {
    expect(tool.effect).toBe('write');
  });

  it('defaults durationSec to 5 and aspectRatio to 9:16', () => {
    const parsed = tool.input.parse({ contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a factory floor' });
    expect(parsed.durationSec).toBe(5);
    expect(parsed.aspectRatio).toBe('9:16');
  });
});

describe('content.generate_broll', () => {
  it('replaces the named beat with a generated_broll beat, leaving the rest untouched', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_workflow_clip', mode: 'assemble',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const video = stubVideo('https://fal.example/factory.mp4');
    const tool = makeContentGenerateBroll(video);

    const res = await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a factory floor at dawn', aspectRatio: '9:16', durationSec: 4 },
      ctx({ updateDraft }),
    );

    expect(res.url).toBe('https://fal.example/factory.mp4');
    expect(video.generate).toHaveBeenCalledWith({ prompt: 'a factory floor at dawn', aspectRatio: '9:16', durationSec: 4 });

    const savedCopy = updateDraft.mock.calls[0]![0].copy as typeof draftBeats;
    expect(savedCopy[0]).toEqual({ kind: 'generated_broll', beatId: 'hook', url: 'https://fal.example/factory.mp4', prompt: 'a factory floor at dawn' });
    expect(savedCopy[1]).toEqual(draftBeats[1]); // the asset beat is untouched
  });

  it('carries no script and needs no consent — this is not a likeness clone', async () => {
    // Distinguishing test: content.generate_avatar_video checks genome.consent
    // before calling its vendor; this tool's ctx has no `consent` store stubbed
    // at all, and the call must still succeed.
    const tool = makeContentGenerateBroll(stubVideo());
    const res = await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '9:16', durationSec: 5 },
      ctx(),
    );
    expect(res.url).toBeTruthy();
  });

  it('404s when the draft does not exist or is out of scope', async () => {
    const tool = makeContentGenerateBroll(stubVideo());
    await expect(
      tool.handler(
        { contentItemId: 'ci_gone', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '9:16', durationSec: 5 },
        ctx({ get: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the beat does not exist on the draft', async () => {
    const tool = makeContentGenerateBroll(stubVideo());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'nope', prompt: 'x', aspectRatio: '9:16', durationSec: 5 },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the draft became unwritable between the read and the save (e.g. published)', async () => {
    const tool = makeContentGenerateBroll(stubVideo());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '9:16', durationSec: 5 },
        ctx({ updateDraft: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates the video client failure rather than saving a broken beat', async () => {
    const failing: VideoClient = { generate: vi.fn(async () => { throw new ToolError('UPSTREAM_FAILED', 'fal down'); }) };
    const updateDraft = vi.fn();
    const tool = makeContentGenerateBroll(failing);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '9:16', durationSec: 5 },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
