import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { analyticsPostMetrics } from '../src/postMetrics.js';

function snapshot(over: Partial<{ platform: string; likes: number; comments: number; shares: number; views: number; impressions: number }> = {}) {
  return {
    contentItemId: 'ci_1',
    platform: over.platform ?? 'instagram',
    likes: over.likes ?? 10,
    comments: over.comments ?? 2,
    shares: over.shares ?? 1,
    views: over.views ?? 100,
    impressions: over.impressions ?? 200,
    syncedAt: new Date('2026-01-02T00:00:00Z'),
  };
}

function ctx(over: { contentGet?: () => Promise<unknown>; listForItems?: () => Promise<unknown[]>; genomeId?: string } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: { get: over.contentGet ?? (async () => ({ id: 'ci_1', genomeId: 'gen_1', status: 'published' })) },
      analytics: { listForItems: over.listForItems ?? (async () => [snapshot()]) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('analytics.post_metrics', () => {
  it('returns per-platform snapshots and correct totals', async () => {
    const out = await analyticsPostMetrics.handler(
      { genomeId: 'gen_1', contentItemId: 'ci_1' },
      ctx({ listForItems: async () => [snapshot({ platform: 'instagram', likes: 10 }), snapshot({ platform: 'tiktok', likes: 30 })] }),
    );

    expect(out.synced).toBe(true);
    expect(out.platforms).toHaveLength(2);
    expect(out.totals.likes).toBe(40);
    expect(out.totals.comments).toBe(4);
  });

  it('reports synced: false with zeroed totals when nothing has been synced yet', async () => {
    const out = await analyticsPostMetrics.handler({ genomeId: 'gen_1', contentItemId: 'ci_1' }, ctx({ listForItems: async () => [] }));
    expect(out.synced).toBe(false);
    expect(out.platforms).toEqual([]);
    expect(out.totals).toEqual({ likes: 0, comments: 0, shares: 0, views: 0, impressions: 0, saves: 0 });
  });

  it('throws NOT_FOUND for a content item that does not exist in this genome', async () => {
    await expect(
      analyticsPostMetrics.handler({ genomeId: 'gen_1', contentItemId: 'ci_missing' }, ctx({ contentGet: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a genome other than the one selected', async () => {
    await expect(
      analyticsPostMetrics.handler({ genomeId: 'gen_evil', contentItemId: 'ci_1' }, ctx({ genomeId: 'gen_1' })),
    ).rejects.toThrow(ToolError);
  });

  it('is a free read, open to viewers', () => {
    expect(analyticsPostMetrics.effect).toBe('read');
    expect(analyticsPostMetrics.scopes).toContain('viewer');
  });
});
