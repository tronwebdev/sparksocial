import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared';
import { makeMediaIngest, type MediaIngestDeps } from '../src/ingest.js';

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner' as Role,
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'gen_draft' }),
        patchDimensions: async () => ({ id: 'gen_1', version: 1 }),
        get: async () => undefined,
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async ({ url }) => ({ id: `asset_${url}` }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over,
  };
}

const cleanDeps: MediaIngestDeps = {
  analyze: async () => ({ blurScore: 0.1, exposureScore: 0.1, shakeScore: 0.1, durationSec: 20 }),
  detect: async () => ({ startSec: 2, endSec: 20 }),
  dimensions: async () => ({ width: 1920, height: 1080 }),
  run: async (_plan, _url) => ({ '9:16': 'https://cdn/clip-9x16.mp4', '1:1': 'https://cdn/clip-1x1.mp4' }),
  embed: async () => [0.1, 0.2],
};

const input = {
  genomeId: 'gen_barber',
  briefId: 'brief_1',
  mediaUrl: 'https://wa.example.com/raw.mp4',
  aspects: ['9:16', '1:1'] as ('9:16' | '1:1')[],
  captions: [{ text: 'The fade finishing.', startSec: 0, endSec: 2 }],
  hook: { text: 'Watch the finish', fontFile: 'Inter-Bold.ttf', colorHex: '#FFFFFF' },
};

describe('direct.media.ingest', () => {
  it('finishes clean footage into one asset per aspect', async () => {
    const tool = makeMediaIngest(cleanDeps);
    const res = await tool.handler(input, ctx());

    expect(res.status).toBe('finished');
    if (res.status !== 'finished') throw new Error('unreachable');
    expect(Object.keys(res.assetIds).sort()).toEqual(['1:1', '9:16']);
    expect(res.why.summary).toContain('2 aspect ratio');
  });

  it('creates each finished asset as physical_capture, rights-cleared', async () => {
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: `asset_${url}` }));
    const tool = makeMediaIngest(cleanDeps);
    await tool.handler(input, ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, create } } }));

    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      expect(call[0]).toMatchObject({ assetRole: 'physical_capture', mediaType: 'video', rightsStatus: 'cleared' });
    }
  });

  it('rejects poor-quality footage with a specific reason, and never touches ffmpeg or the Asset Graph', async () => {
    const run = vi.fn();
    const create = vi.fn();
    const deps: MediaIngestDeps = { ...cleanDeps, analyze: async () => ({ blurScore: 0.9, exposureScore: 0.1, shakeScore: 0.1, durationSec: 20 }), run };
    const tool = makeMediaIngest(deps);

    const res = await tool.handler(input, ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, create } } }));

    expect(res.status).toBe('reshoot_requested');
    if (res.status !== 'reshoot_requested') throw new Error('unreachable');
    expect(res.reasons[0]).toContain('too blurry');
    expect(run).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not fabricate an asset for an aspect the runner declined to produce', async () => {
    const deps: MediaIngestDeps = { ...cleanDeps, run: async () => ({ '9:16': 'https://cdn/clip.mp4' }) }; // '1:1' missing
    const tool = makeMediaIngest(deps);
    const res = await tool.handler(input, ctx());

    expect(res.status).toBe('finished');
    if (res.status !== 'finished') throw new Error('unreachable');
    expect(Object.keys(res.assetIds)).toEqual(['9:16']);
  });

  it('is not idempotent — each submission produces new assets, never a silent replay', () => {
    expect(makeMediaIngest(cleanDeps).idempotent).toBe(false);
  });
});
