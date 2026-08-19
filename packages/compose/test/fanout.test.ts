import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeComposeFanout } from '../src/fanout.js';

/**
 * `compose.fanout` — orchestrates two async Canva jobs (autofill, then one
 * export per requested format) and persists the results. What matters here:
 * it refuses cleanly when Canva isn't connected for this genome, it does not
 * invent a beat-to-field mapping (the caller's `data` passes straight
 * through), and it records one render row per exported file.
 */

function fetchSequence(responses: Array<{ status?: number; body: unknown }>) {
  let i = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
}

function ctx(over: {
  contentGet?: ReturnType<typeof vi.fn>;
  oauthGet?: ReturnType<typeof vi.fn>;
  recordRender?: ReturnType<typeof vi.fn>;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        get: over.contentGet ?? (async () => ({ id: 'c1', genomeId: 'gen_1', status: 'draft', createdAt: new Date() })),
        recordRender: over.recordRender ?? (async (a: unknown) => ({ id: 'r1', createdAt: new Date(), ...(a as object) })),
      },
      oauthConnections: {
        get: over.oauthGet ?? (async () => ({ id: 'conn_1', genomeId: 'gen_1', provider: 'canva', accessToken: 'tok_1', connectedBy: 'u', createdAt: new Date(), updatedAt: new Date() })),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('compose.fanout', () => {
  it('throws NOT_FOUND when the content item is out of scope or gone', async () => {
    const tool = makeComposeFanout({ fetchImpl: fetchSequence([]) as never });
    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'gone', brandTemplateId: 'tmpl_1', data: {}, formats: ['png'] },
        ctx({ contentGet: vi.fn(async () => undefined) }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('throws FORBIDDEN when this genome has not connected Canva', async () => {
    const tool = makeComposeFanout({ fetchImpl: fetchSequence([]) as never });
    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'c1', brandTemplateId: 'tmpl_1', data: {}, formats: ['png'] },
        ctx({ oauthGet: vi.fn(async () => undefined) }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('autofills, exports each requested format, and records one render per file — passing data straight through, unmapped', async () => {
    const recordRender = vi.fn(async (a: unknown) => ({ id: 'r1', createdAt: new Date(), ...(a as object) }));
    const f = fetchSequence([
      { body: { job: { id: 'autofill_job_1' } } }, // startCanvaAutofill
      { body: { job: { status: 'success', result: { design: { id: 'design_1', urls: { edit_url: 'https://canva.com/edit/1' } } } } } }, // getCanvaAutofillJob
      { body: { job: { id: 'export_job_png' } } }, // startCanvaExport png
      { body: { job: { status: 'success', urls: ['https://export.canva.com/a.png'] } } }, // getCanvaExportJob png
      { body: { job: { id: 'export_job_jpg' } } }, // startCanvaExport jpg
      { body: { job: { status: 'success', urls: ['https://export.canva.com/a.jpg'] } } }, // getCanvaExportJob jpg
    ]);
    const tool = makeComposeFanout({ fetchImpl: f as never });

    const out = await tool.handler(
      {
        genomeId: 'gen_1',
        contentItemId: 'c1',
        brandTemplateId: 'tmpl_1',
        data: { headline: { type: 'text', text: 'launch day' }, hero: { type: 'image', assetId: 'canva_asset_1' } },
        formats: ['png', 'jpg'],
      },
      ctx({ recordRender }),
    );

    expect(out.designId).toBe('design_1');
    expect(out.editUrl).toBe('https://canva.com/edit/1');
    expect(out.renders).toEqual([
      { format: 'png', url: 'https://export.canva.com/a.png' },
      { format: 'jpg', url: 'https://export.canva.com/a.jpg' },
    ]);
    expect(recordRender).toHaveBeenCalledTimes(2);
    expect((recordRender.mock.calls[0]![0] as { engine: string }).engine).toBe('canva');

    // The autofill request body carries the caller's data unmapped — assetId became Canva's own asset_id key.
    const autofillBody = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(autofillBody.data).toEqual({
      headline: { type: 'text', text: 'launch day' },
      hero: { type: 'image', asset_id: 'canva_asset_1' },
    });
  });

  it('surfaces a Canva job failure as a ToolError rather than a partial result', async () => {
    const f = fetchSequence([
      { body: { job: { id: 'autofill_job_1' } } },
      { body: { job: { status: 'failed', error: { message: 'template not found' } } } },
    ]);
    const tool = makeComposeFanout({ fetchImpl: f as never });

    await expect(
      tool.handler(
        { genomeId: 'gen_1', contentItemId: 'c1', brandTemplateId: 'tmpl_missing', data: {}, formats: ['png'] },
        ctx(),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('is a write, not idempotent, defaults to png-only', () => {
    const tool = makeComposeFanout();
    expect(tool.effect).toBe('write');
    expect(tool.idempotent).toBe(false);
    expect(tool.input.parse({ genomeId: 'g', contentItemId: 'c', brandTemplateId: 't', data: {} }).formats).toEqual(['png']);
  });
});
