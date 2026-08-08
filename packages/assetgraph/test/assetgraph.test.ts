import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared';
import { lagosBarbershop, torontoSaas } from '@sparksocial/playbooks';
import { makeAssetRetrieve } from '../src/retrieve.js';
import { assetGaps } from '../src/gaps.js';
import { makeAssetIngestUrl } from '../src/ingest.js';

/**
 * §4 tests. The behaviours that matter most are the ones the spec calls out by
 * name: recency/usage penalties in retrieval (§4.3), and gap detection quantified
 * as an impact count rather than a bare list (§4.4).
 */

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
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'asset_1' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over,
  };
}

describe('asset.retrieve', () => {
  it('embeds the intent and passes it through to the scoped retrieval', async () => {
    const embed = vi.fn(async () => [0.1, 0.2, 0.3]);
    const retrieve = vi.fn(async () => [
      {
        assetId: 'a1',
        role: 'work_artifact' as const,
        caption: 'kitchen before/after',
        score: 0.8,
        usageCount: 0,
        lastUsedAt: null,
        rightsStatus: 'cleared',
      },
    ]);
    const tool = makeAssetRetrieve({ embed });

    const res = await tool.handler(
      { genomeId: 'gen_1', intent: 'kitchen renovation', k: 8 },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, retrieve } } }),
    );

    expect(embed).toHaveBeenCalledWith('kitchen renovation');
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ genomeId: 'gen_1', embedding: [0.1, 0.2, 0.3], k: 8 }),
    );
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.assetId).toBe('a1');
    expect(res.why.summary).toContain('kitchen renovation');
  });

  it('reports zero results honestly rather than throwing', async () => {
    const tool = makeAssetRetrieve({ embed: async () => [0] });
    const res = await tool.handler({ genomeId: 'gen_1', intent: 'nothing matches this', k: 8 }, ctx());
    expect(res.results).toEqual([]);
    expect(res.why.summary).toContain('No cleared assets');
  });

  it('passes the role filter through unchanged', async () => {
    const retrieve = vi.fn(async () => []);
    const tool = makeAssetRetrieve({ embed: async () => [0] });
    await tool.handler(
      { genomeId: 'gen_1', intent: 'x', requiredRoles: ['work_artifact'], k: 8 },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, retrieve } } }),
    );
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ requiredRoles: ['work_artifact'] }));
  });
});

describe('asset.gaps', () => {
  it('quantifies impact as "N of M resolvable posts", not a bare list', async () => {
    const res = await assetGaps.handler(
      { genomeId: lagosBarbershop.genome.genome_id, horizonDays: 30 },
      ctx({
        db: {
          ...ctx().db,
          genomes: { ...ctx().db.genomes, get: async () => lagosBarbershop.genome },
          assets: { ...ctx().db.assets, inventory: async () => lagosBarbershop.assets },
        },
      }),
    );

    expect(res.gaps.length).toBeGreaterThan(0);
    expect(res.gaps[0]!.impact).toMatch(/^\d+ of \d+ resolvable posts$/);
    expect(res.gaps[0]!.playbooksBlocked.length).toBeGreaterThan(0);
    // §4.4: the honest, conversational framing, not a bare error.
    expect(res.why.summary).toMatch(/posts are ready now/);
  });

  it('reports zero gaps when everything resolvable is already producible', async () => {
    // Toronto SaaS's golden fixture has enough assets that nothing needs filming
    // for the formats gated on what it already has (product_screen, knowledge,
    // social_proof) — direct_finish playbooks are excluded from its resolution
    // by the capture_capability dimension, not by a missing asset, so they never
    // appear as a gap here.
    const res = await assetGaps.handler(
      { genomeId: torontoSaas.genome.genome_id, horizonDays: 30 },
      ctx({
        db: {
          ...ctx().db,
          genomes: { ...ctx().db.genomes, get: async () => torontoSaas.genome },
          assets: { ...ctx().db.assets, inventory: async () => torontoSaas.assets },
        },
      }),
    );

    expect(res.gaps).toEqual([]);
    expect(res.why.summary).toContain('already on hand');
  });

  it('throws NOT_FOUND for an unknown genome rather than silently resolving empty', async () => {
    await expect(
      assetGaps.handler({ genomeId: 'nope', horizonDays: 30 }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('sorts gaps by how many playbooks they block, worst first', async () => {
    const res = await assetGaps.handler(
      { genomeId: lagosBarbershop.genome.genome_id, horizonDays: 30 },
      ctx({
        db: {
          ...ctx().db,
          genomes: { ...ctx().db.genomes, get: async () => lagosBarbershop.genome },
          assets: { ...ctx().db.assets, inventory: async () => lagosBarbershop.assets },
        },
      }),
    );
    const counts = res.gaps.map((g) => g.playbooksBlocked.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('asset.ingest_url', () => {
  it('captions, embeds, and creates in that order', async () => {
    const calls: string[] = [];
    const caption = vi.fn(async () => {
      calls.push('caption');
      return 'a barbershop fade in progress';
    });
    const embed = vi.fn(async () => {
      calls.push('embed');
      return [0.5];
    });
    const create = vi.fn(async () => ({ id: 'asset_new' }));

    const tool = makeAssetIngestUrl({ caption, embed });
    const res = await tool.handler(
      {
        genomeId: 'gen_1',
        url: 'https://example.com/fade.jpg',
        assetRole: 'physical_capture',
        mediaType: 'image',
        rightsStatus: 'cleared',
      },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, create } } }),
    );

    expect(calls).toEqual(['caption', 'embed']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'a barbershop fade in progress', embedding: [0.5], assetRole: 'physical_capture' }),
    );
    expect(res.assetId).toBe('asset_new');
    expect(res.caption).toContain('fade');
  });

  it('is not idempotent — re-ingesting the same URL is a caller error to avoid, not a safe retry', () => {
    const tool = makeAssetIngestUrl({ caption: async () => '', embed: async () => [] });
    expect(tool.idempotent).toBe(false);
  });
});
