import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeComposeRender, type RenderRunner } from '../src/tool.js';

// pb_workflow_clip (assemble, video, ['9:16','1:1']), pb_offer_announcement isn't used here —
// pick a real assemble-mode video playbook with two beats and two aspect ratios so both the
// per-aspect loop and beat-duration lookup are exercised for real, not against a fixture playbook.
const PLAYBOOK_ID = 'pb_workflow_clip';

function runner(over: Partial<RenderRunner> = {}): RenderRunner {
  return {
    renderVideo: vi.fn(async () => 'https://blob/video.mp4'),
    renderStill: vi.fn(async () => 'https://blob/still.png'),
    ...over,
  };
}

function ctx(over: { get?: ReturnType<typeof vi.fn>; info?: ReturnType<typeof vi.fn>; recordRender?: ReturnType<typeof vi.fn> } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: over.info ?? (async () => ({})),
      },
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not stubbed'); },
        get:
          over.get ??
          (async () => ({
            id: 'c1',
            genomeId: 'gen_1',
            playbookId: PLAYBOOK_ID,
            mode: 'assemble' as const,
            status: 'draft',
            createdAt: new Date(),
            copy: [{ kind: 'text', beatId: 'hook', text: 'placeholder hook' }],
          })),
        updateDraft: async () => undefined,
        list: async () => [],
        schedule: async () => undefined,
        markPublished: async () => {},
        recordRender: over.recordRender ?? (async (a: unknown) => ({ id: 'r1', createdAt: new Date(), ...(a as object) })),
        listRenders: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => Promise<unknown>) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('compose.render', () => {
  it('throws NOT_FOUND when the content item is out of scope or gone', async () => {
    const tool = makeComposeRender({ runner: runner() });
    await expect(
      tool.handler({ genomeId: 'gen_1', contentItemId: 'gone' }, ctx({ get: vi.fn(async () => undefined) })),
    ).rejects.toThrow(ToolError);
  });

  it('throws INVALID_INPUT when the content item has no draft yet', async () => {
    const tool = makeComposeRender({ runner: runner() });
    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'c1' },
        ctx({
          get: vi.fn(async () => ({
            id: 'c1',
            genomeId: 'gen_1',
            playbookId: PLAYBOOK_ID,
            mode: 'assemble' as const,
            status: 'draft',
            createdAt: new Date(),
          })),
        }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('renders one video per declared aspect ratio and records one render row each', async () => {
    const r = runner();
    const recordRender = vi.fn(async (a: unknown) => ({ id: 'r', createdAt: new Date(), ...(a as object) }));
    const tool = makeComposeRender({ runner: r });

    const out = await tool.handler({ genomeId: 'gen_1', contentItemId: 'c1' }, ctx({ recordRender }));

    expect(out.mediaType).toBe('video');
    expect(r.renderVideo).toHaveBeenCalledTimes(2); // pb_workflow_clip declares 2 aspect ratios
    expect(out.renders.map((x) => x.aspect).sort()).toEqual(['1:1', '9:16']);
    expect(recordRender).toHaveBeenCalledTimes(2);
  });

  it('resolves asset-kind beats through ctx.db.assets.info before handing them to the runner', async () => {
    const r = runner();
    const info = vi.fn(async () => ({ a1: { url: 'https://blob/a1.mp4', mediaType: 'video', rightsStatus: 'cleared' } }));
    const tool = makeComposeRender({ runner: r });

    await tool.handler(
      { genomeId: 'gen_1', contentItemId: 'c1' },
      ctx({
        info,
        get: vi.fn(async () => ({
          id: 'c1',
          genomeId: 'gen_1',
          playbookId: PLAYBOOK_ID,
          mode: 'assemble' as const,
          status: 'draft',
          createdAt: new Date(),
          copy: [{ kind: 'asset', beatId: 'demo', assetId: 'a1', role: 'product_screen', caption: null }],
        })),
      }),
    );

    expect(info).toHaveBeenCalledWith(['a1'], 'gen_1', 'org_1');
  });

  it('returns immediately with no renders for a text-mediaType playbook', async () => {
    const r = runner();
    const tool = makeComposeRender({ runner: r });

    const out = await tool.handler(
      { genomeId: 'gen_1', contentItemId: 'c1' },
      ctx({
        get: vi.fn(async () => ({
          id: 'c1',
          genomeId: 'gen_1',
          playbookId: 'pb_text_update',
          mode: 'synthesize' as const,
          status: 'draft',
          createdAt: new Date(),
          copy: [{ kind: 'text', beatId: 'copy', text: 'a text-only update' }],
        })),
      }),
    );

    expect(out.mediaType).toBe('text');
    expect(out.renders).toEqual([]);
    expect(r.renderVideo).not.toHaveBeenCalled();
    expect(r.renderStill).not.toHaveBeenCalled();
  });

  it('renders one still per beat per aspect ratio for a carousel playbook', async () => {
    const r = runner();
    const tool = makeComposeRender({ runner: r });

    const out = await tool.handler(
      { genomeId: 'gen_1', contentItemId: 'c1' },
      ctx({
        get: vi.fn(async () => ({
          id: 'c1',
          genomeId: 'gen_1',
          playbookId: 'pb_carousel_proof_points',
          mode: 'synthesize' as const,
          status: 'draft',
          createdAt: new Date(),
          copy: [
            { kind: 'text', beatId: 'cover', text: '3x faster onboarding' },
            { kind: 'text', beatId: 'slides', text: '40 clients, 12 weeks average' },
          ],
        })),
      }),
    );

    expect(out.mediaType).toBe('carousel');
    // pb_carousel_proof_points declares 1 aspect ratio (4:5) x 2 beats used here = 2 stills.
    expect(r.renderStill).toHaveBeenCalledTimes(2);
    expect(out.renders).toHaveLength(2);
    expect(out.renders.every((x) => x.beatId)).toBe(true);
  });
});
