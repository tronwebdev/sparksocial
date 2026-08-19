import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import type { DubClient } from '@sparksocial/publish';
import { makeAnalyticsCtaTraffic } from '../src/ctaTraffic.js';

function link(over: Partial<{ dubLinkId: string; shortUrl: string; destinationUrl: string }> = {}) {
  return {
    id: 'row_1',
    genomeId: 'gen_1',
    contentItemId: 'ci_1',
    dubLinkId: over.dubLinkId ?? 'link_1',
    shortUrl: over.shortUrl ?? 'https://dub.sh/abc',
    destinationUrl: over.destinationUrl ?? 'https://example.com/book',
    createdAt: new Date(),
  };
}

function stubDub(clicksById: Record<string, number> = {}): DubClient {
  return {
    shorten: vi.fn(),
    getClicks: vi.fn(async (linkId: string) => ({ clicks: clicksById[linkId] ?? 0 })),
  } as unknown as DubClient;
}

function ctx(over: {
  contentGet?: () => Promise<unknown>;
  listForItems?: () => Promise<unknown[]>;
  genomeId?: string;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: { get: over.contentGet ?? (async () => ({ id: 'ci_1', genomeId: 'gen_1', status: 'published' })) },
      ctaLinks: { listForItems: over.listForItems ?? (async () => [link()]) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('analytics.cta_traffic', () => {
  it('reads clicks for every attributed link and sums them', async () => {
    const dub = stubDub({ link_1: 12, link_2: 5 });
    const tool = makeAnalyticsCtaTraffic(dub);

    const out = await tool.handler(
      { genomeId: 'gen_1', contentItemId: 'ci_1' },
      ctx({ listForItems: async () => [link({ dubLinkId: 'link_1' }), link({ dubLinkId: 'link_2', shortUrl: 'https://dub.sh/def' })] }),
    );

    expect(out.links).toEqual([
      { shortUrl: 'https://dub.sh/abc', destinationUrl: 'https://example.com/book', clicks: 12 },
      { shortUrl: 'https://dub.sh/def', destinationUrl: 'https://example.com/book', clicks: 5 },
    ]);
    expect(out.totalClicks).toBe(17);
  });

  it('returns an empty, non-error result for a post with no attributed link — the common case', async () => {
    const dub = stubDub();
    const tool = makeAnalyticsCtaTraffic(dub);

    const out = await tool.handler({ genomeId: 'gen_1', contentItemId: 'ci_1' }, ctx({ listForItems: async () => [] }));

    expect(out.links).toEqual([]);
    expect(out.totalClicks).toBe(0);
  });

  it('throws NOT_FOUND for a content item that does not exist in this genome', async () => {
    const tool = makeAnalyticsCtaTraffic(stubDub());
    await expect(
      tool.handler({ genomeId: 'gen_1', contentItemId: 'ci_missing' }, ctx({ contentGet: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a genome other than the one selected', async () => {
    const tool = makeAnalyticsCtaTraffic(stubDub());
    await expect(
      tool.handler({ genomeId: 'gen_evil', contentItemId: 'ci_1' }, ctx({ genomeId: 'gen_1' })),
    ).rejects.toThrow(ToolError);
  });

  it('is a free read, open to viewers', () => {
    const tool = makeAnalyticsCtaTraffic(stubDub());
    expect(tool.effect).toBe('read');
    expect(tool.scopes).toContain('viewer');
  });
});
