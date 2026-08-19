import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeAnalyticsSync } from '../src/tool.js';
import type { AnalyticsSource } from '../src/source.js';

const PUBLISHED_ITEM = {
  id: 'item_1',
  genomeId: 'gen_1',
  playbookId: 'pb_workflow_clip',
  mode: 'synthesize' as const,
  status: 'published',
  platform: 'instagram',
  externalId: 'ext_123',
  via: 'aggregator:test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function ctx(over: { contentGet?: () => Promise<unknown>; genomeId?: string; recorded?: unknown[] } = {}): ToolCtx {
  const recorded = over.recorded ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        get: over.contentGet ?? (async () => PUBLISHED_ITEM),
      },
      analytics: {
        record: async (args: unknown) => {
          recorded.push(args);
          return {
            contentItemId: 'item_1',
            platform: 'instagram',
            likes: 10,
            comments: 2,
            shares: 1,
            views: 100,
            impressions: 200,
            syncedAt: new Date('2026-01-02T00:00:00Z'),
          };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubSource(): AnalyticsSource & { fetchMetrics: ReturnType<typeof vi.fn> } {
  return {
    fetchMetrics: vi.fn(async () => ({ likes: 10, comments: 2, shares: 1, views: 100, impressions: 200, raw: {} })),
  };
}

describe('analytics.sync', () => {
  it('fetches metrics for the item\'s platform/externalId and records a snapshot', async () => {
    const source = stubSource();
    const tool = makeAnalyticsSync({ source });
    const recorded: unknown[] = [];

    await tool.handler({ genomeId: 'gen_1', contentItemId: 'item_1' }, ctx({ recorded }));

    expect(source.fetchMetrics).toHaveBeenCalledWith({ platform: 'instagram', externalId: 'ext_123' });
    expect(recorded[0]).toMatchObject({
      genomeId: 'gen_1',
      orgId: 'org_1',
      contentItemId: 'item_1',
      platform: 'instagram',
      likes: 10,
    });
  });

  it('returns the recorded snapshot with an ISO syncedAt', async () => {
    const tool = makeAnalyticsSync({ source: stubSource() });
    const out = await tool.handler({ genomeId: 'gen_1', contentItemId: 'item_1' }, ctx());
    expect(out).toEqual({
      contentItemId: 'item_1',
      platform: 'instagram',
      likes: 10,
      comments: 2,
      shares: 1,
      views: 100,
      impressions: 200,
      syncedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('refuses when the content item does not exist', async () => {
    const tool = makeAnalyticsSync({ source: stubSource() });
    const err = await tool
      .handler({ genomeId: 'gen_1', contentItemId: 'missing' }, ctx({ contentGet: async () => undefined }))
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses an item that was never published', async () => {
    const tool = makeAnalyticsSync({ source: stubSource() });
    const err = await tool
      .handler(
        { genomeId: 'gen_1', contentItemId: 'item_1' },
        ctx({ contentGet: async () => ({ ...PUBLISHED_ITEM, status: 'scheduled', externalId: undefined }) }),
      )
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
  });

  it('refuses a published item with no recorded receipt', async () => {
    // Shouldn't happen once publish.now always calls markPublished, but the
    // tool must not crash reaching into a platform/externalId that isn't there.
    const tool = makeAnalyticsSync({ source: stubSource() });
    const err = await tool
      .handler(
        { genomeId: 'gen_1', contentItemId: 'item_1' },
        ctx({ contentGet: async () => ({ ...PUBLISHED_ITEM, externalId: undefined }) }),
      )
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
  });

  it('refuses a genome other than the one selected', async () => {
    const tool = makeAnalyticsSync({ source: stubSource() });
    const err = await tool
      .handler({ genomeId: 'gen_evil', contentItemId: 'item_1' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a plain write, callable without human approval, not open to viewers', () => {
    const tool = makeAnalyticsSync({ source: stubSource() });
    expect(tool.effect).toBe('write');
    expect(tool.autonomy).toBe('auto');
    expect(tool.scopes).not.toContain('viewer');
    expect(tool.scopes).not.toContain('client');
  });

  it('is idempotent — re-syncing the same post is always safe', () => {
    const tool = makeAnalyticsSync({ source: stubSource() });
    expect(tool.idempotent).toBe(true);
  });
});
