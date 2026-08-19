import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeComposeStatic, type StaticRunner } from '../src/static.js';

/**
 * `compose.static` — the Satori-backed, browser-free sibling of
 * `compose.render`'s image/carousel branches. What matters here: it renders
 * the same shapes `compose.render` does for image/carousel playbooks (so a
 * caller can swap one for the other), and it refuses the two media types
 * that are not its job — `video` (no timeline concept) and `text` (nothing
 * to rasterize) — pointing the caller at the right tool instead of silently
 * doing nothing or crashing.
 */

const IMAGE_PLAYBOOK_ID = 'pb_generated_quote_card';
const CAROUSEL_PLAYBOOK_ID = 'pb_carousel_proof_points';
const VIDEO_PLAYBOOK_ID = 'pb_workflow_clip';
const TEXT_PLAYBOOK_ID = 'pb_text_update';

function runner(over: Partial<StaticRunner> = {}): StaticRunner {
  return { renderStill: vi.fn(async () => 'https://blob/still.png'), ...over };
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
            playbookId: IMAGE_PLAYBOOK_ID,
            mode: 'synthesize' as const,
            status: 'draft',
            createdAt: new Date(),
            copy: [{ kind: 'text', beatId: 'card', text: 'a quote' }],
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

describe('compose.static', () => {
  it('throws NOT_FOUND when the content item is out of scope or gone', async () => {
    const tool = makeComposeStatic({ runner: runner() });
    await expect(
      tool.handler({ genomeId: 'gen_1', contentItemId: 'gone' }, ctx({ get: vi.fn(async () => undefined) })),
    ).rejects.toThrow(ToolError);
  });

  it('throws INVALID_INPUT when the content item has no draft yet', async () => {
    const tool = makeComposeStatic({ runner: runner() });
    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'c1' },
        ctx({ get: vi.fn(async () => ({ id: 'c1', genomeId: 'gen_1', playbookId: IMAGE_PLAYBOOK_ID, mode: 'synthesize' as const, status: 'draft', createdAt: new Date() })) }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('renders one still per declared aspect ratio for an image playbook', async () => {
    const r = runner();
    const recordRender = vi.fn(async (a: unknown) => ({ id: 'r', createdAt: new Date(), ...(a as object) }));
    const tool = makeComposeStatic({ runner: r });

    const out = await tool.handler({ genomeId: 'gen_1', contentItemId: 'c1' }, ctx({ recordRender }));

    expect(out.mediaType).toBe('image');
    expect(out.renders.length).toBeGreaterThan(0);
    expect(r.renderStill).toHaveBeenCalledTimes(out.renders.length);
    expect(recordRender).toHaveBeenCalledTimes(out.renders.length);
    // The write side records which engine produced the pixels — distinct from compose.render's 'remotion'.
    expect((recordRender.mock.calls[0]![0] as { engine: string }).engine).toBe('satori');
  });

  it('renders one still per beat per aspect ratio for a carousel playbook', async () => {
    const r = runner();
    const tool = makeComposeStatic({ runner: r });

    const out = await tool.handler(
      { genomeId: 'gen_1', contentItemId: 'c1' },
      ctx({
        get: vi.fn(async () => ({
          id: 'c1',
          genomeId: 'gen_1',
          playbookId: CAROUSEL_PLAYBOOK_ID,
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
    expect(r.renderStill).toHaveBeenCalledTimes(2);
    expect(out.renders).toHaveLength(2);
    expect(out.renders.every((x) => x.beatId)).toBe(true);
  });

  it('refuses a video playbook — that is compose.render’s job, Satori has no timeline', async () => {
    const r = runner();
    const tool = makeComposeStatic({ runner: r });

    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'c1' },
        ctx({
          get: vi.fn(async () => ({
            id: 'c1',
            genomeId: 'gen_1',
            playbookId: VIDEO_PLAYBOOK_ID,
            mode: 'assemble' as const,
            status: 'draft',
            createdAt: new Date(),
            copy: [{ kind: 'text', beatId: 'hook', text: 'placeholder hook' }],
          })),
        }),
      ),
    ).rejects.toThrow(ToolError);
    expect(r.renderStill).not.toHaveBeenCalled();
  });

  it('refuses a text-only playbook — nothing to rasterize', async () => {
    const r = runner();
    const tool = makeComposeStatic({ runner: r });

    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'c1' },
        ctx({
          get: vi.fn(async () => ({
            id: 'c1',
            genomeId: 'gen_1',
            playbookId: TEXT_PLAYBOOK_ID,
            mode: 'synthesize' as const,
            status: 'draft',
            createdAt: new Date(),
            copy: [{ kind: 'text', beatId: 'copy', text: 'a text-only update' }],
          })),
        }),
      ),
    ).rejects.toThrow(ToolError);
    expect(r.renderStill).not.toHaveBeenCalled();
  });

  it('resolves asset-kind beats through ctx.db.assets.info before handing them to the runner', async () => {
    const r = runner();
    const info = vi.fn(async () => ({ a1: { url: 'https://blob/a1.png', mediaType: 'image', rightsStatus: 'cleared' } }));
    const tool = makeComposeStatic({ runner: r });

    await tool.handler(
      { genomeId: 'gen_1', contentItemId: 'c1' },
      ctx({
        info,
        get: vi.fn(async () => ({
          id: 'c1',
          genomeId: 'gen_1',
          playbookId: IMAGE_PLAYBOOK_ID,
          mode: 'synthesize' as const,
          status: 'draft',
          createdAt: new Date(),
          copy: [{ kind: 'asset', beatId: 'card', assetId: 'a1', role: 'product_screen', caption: null }],
        })),
      }),
    );

    expect(info).toHaveBeenCalledWith(['a1'], 'gen_1', 'org_1');
  });

  it('is a write, not idempotent — a re-render is a new render', () => {
    const tool = makeComposeStatic({ runner: runner() });
    expect(tool.effect).toBe('write');
    expect(tool.idempotent).toBe(false);
  });
});
