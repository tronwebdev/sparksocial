import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import { ToolError, type Role } from '@sparksocial/shared';
import { lagosBarbershop, torontoSaas } from '@sparksocial/playbooks';
import { makeAssetRetrieve } from '../src/retrieve.js';
import { assetGaps } from '../src/gaps.js';
import { makeAssetIngestUrl } from '../src/ingest.js';
import { assetRightsSet } from '../src/rights.js';
import { assetReuse } from '../src/reuse.js';
import { assetCooldownCheck } from '../src/cooldown.js';
import { assetFolderCreate, assetFolderMove, assetFolderList } from '../src/folders.js';

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
        patchConstraints: async () => ({ id: 'gen_1', version: 1 }),
        patchIdentity: async () => ({ id: 'gen_1', version: 1 }),
        patchOffer: async () => ({ id: 'gen_1', version: 1 }),
        patchLearned: async () => ({ id: 'gen_1', version: 1 }),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'asset_1' }),
        captionsByRole: async () => [],
        info: async () => ({}),
        setRights: async () => undefined,
        recordUsage: async () => undefined,
        moveToFolder: async () => undefined,
      },
      assetFolders: {
        create: async () => { throw new Error('assetFolders.create not stubbed in this test'); },
        list: async () => [],
      },
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('content.createDraft not stubbed in this test'); },
        get: async () => undefined,
        updateDraft: async () => undefined,
        list: async () => [],
        schedule: async () => undefined,
        markPublished: async () => {},
        markRolledBack: async () => {},
        markBlocked: async () => {},
        publishOrigin: async () => undefined,
        pendingReviewCount: async () => 0,
        markNeedsReview: async () => {},
        markApproved: async () => {},
        markRejected: async () => {},
        recordRender: async () => ({ id: 'render_test', contentItemId: 'c1', aspect: '9:16', storageUrl: 'https://example.com/r.mp4', engine: 'remotion', costCents: 0, createdAt: new Date() }),
        listRenders: async () => [],
      },
      analytics: {
        record: async () => { throw new Error('analytics.record not stubbed in this test'); },
        listForItems: async () => [],
      },
      ctaLinks: {
        create: async () => { throw new Error('ctaLinks.create not stubbed in this test'); },
        listForItems: async () => [],
      },
      engagement: {
        ingest: async () => { throw new Error('engagement.ingest not stubbed in this test'); },
        get: async () => undefined,
        classify: async () => undefined,
        list: async () => [],
        audit: async () => [],
        markReplied: async () => undefined,
        markAutoHandled: async () => undefined,
        markEscalated: async () => undefined,
      },
      opportunities: {
        create: async () => { throw new Error('opportunities.create not stubbed in this test'); },
        get: async () => undefined,
        route: async () => undefined,
      },
      trends: {
        add: async () => { throw new Error('trends.add not stubbed in this test'); },
        remove: async () => {},
        list: async () => [],
      },
      trendObservations: {
        record: async () => {},
        series: async () => [],
      },
      learning: {
        list: async () => [],
        recordOutcome: async () => { throw new Error('learning.recordOutcome not stubbed in this test'); },
        reset: async () => { throw new Error('learning.reset not stubbed in this test'); },
      },
      recipes: {
        create: async () => { throw new Error('recipes.create not stubbed in this test'); },
        get: async () => undefined,
        list: async () => [],
        setStatus: async () => undefined,
        delete: async () => {},
        markRan: async () => {},
        findDue: async () => [],
        recordRun: async () => { throw new Error('recipes.recordRun not stubbed in this test'); },
        listOutputs: async () => [],
        decideOutput: async () => undefined,
      },
      oauthConnections: {
        get: async () => undefined,
        save: async () => { throw new Error('oauthConnections.save not stubbed in this test'); },
        remove: async () => {},
      },
      knowledge: {
        attach: async () => { throw new Error('knowledge.attach not stubbed in this test'); },
        listForDoc: async () => [],
        listAll: async () => [],
      },
      orgSettings: {
        get: async () => ({ orgId: 'org_1', plan: 'starter', defaultApprovalMode: 'review_first_week', ssoRequired: false, twoFactorRequired: false, dataResidency: 'any', monthlyCapCents: 50_000, updatedAt: new Date() }),
        setPlan: async () => { throw new Error('orgSettings.setPlan not stubbed in this test'); },
        setGovernance: async () => { throw new Error('orgSettings.setGovernance not stubbed in this test'); },
        setSso: async () => { throw new Error('orgSettings.setSso not stubbed in this test'); },
      },
      brandMembers: {
        set: async () => { throw new Error('brandMembers.set not stubbed in this test'); },
        remove: async () => {},
        listForBrand: async () => [],
        listForUser: async () => [],
      },
      reviewLinks: {
        create: async () => { throw new Error('reviewLinks.create not stubbed in this test'); },
        getByToken: async () => undefined,
        revoke: async () => {},
        listForBrand: async () => [],
      },
      campaigns: {
        create: async () => ({ id: 'cmp_1' }),
        get: async () => undefined,
        listForGenome: async () => [],
        replaceSlots: async () => 0,
        slots: async () => [],
        setStatus: async () => {},
      },
      brands: {
        get: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setApprovalMode: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setAgentPaused: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setFrequency: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setPolicy: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setGovernance: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
      },
      // Unused by these tests; present because ScopedDb requires them, which is
      // the point of the interface being structural rather than partial.
      humanLoop: {
        create: async () => { throw new Error('humanLoop not stubbed in this test'); },
        get: async () => undefined,
        listPending: async () => [],
        answer: async () => undefined,
        markDelivered: async () => {},
      },
      consent: {
        grant: async () => { throw new Error('consent not stubbed in this test'); },
        revoke: async () => undefined,
        hasActive: async () => false,
        list: async () => [],
      },
      toolCalls: { get: async () => undefined, list: async () => [] },
      approvals: {
        enqueue: async () => {},
        pending: async () => [],
        get: async () => undefined,
        resolve: async () => {},
      },
      metrics: {
        successMetrics: async () => ({
          connectedAccounts: 0,
          campaignCount: 0,
          firstCampaignStartAt: null,
          firstPublishedAt: null,
          publishedInWindow: 0,
          postsWithTrackedLink: 0,
          postsFromTrends: 0,
          recipeCount: 0,
          outputsApproved: 0,
          outputsRejected: 0,
          messagesInWindow: 0,
          messagesResolved: 0,
          meanReplySeconds: null,
          opportunitiesInWindow: 0,
          opportunitiesRouted: 0,
          publishedEverBlocked: 0,
          rolledBack: 0,
          needsReview: 0,
        }),
        toolActivity: async () => ({
          publishAttempts: 0,
          publishBlocked: 0,
          publishHeld: 0,
          draftCalls: 0,
          trendsRanked: 0,
          repurposeCalls: 0,
        }),
      },
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
        url: 'https://example.com/a1.jpg',
        mediaType: 'image',
        folderId: null,
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

  /**
   * `trustedLocalUrlPrefix` exists only for `apps/api`'s local-disk storage
   * (CLAUDE.md § Infrastructure — Azure is production; local disk is dev-only).
   * These pin the two things that must both be true for it to be safe: the
   * SSRF guard still applies to everything else, and the carve-out is a
   * closed instance-configuration value, not something a caller's input can
   * ever widen.
   */
  describe('trustedLocalUrlPrefix — the local-storage SSRF carve-out', () => {
    it('without it, a localhost URL is rejected exactly as PublicHttpUrl always rejected one', () => {
      const tool = makeAssetIngestUrl({ caption: async () => '', embed: async () => [] });
      const result = tool.input.safeParse({
        genomeId: 'gen_1',
        url: 'http://localhost:8080/v1/local-storage/org_1/gen_1/2026/08/x.jpg',
        assetRole: 'physical_capture',
        mediaType: 'image',
      });
      expect(result.success).toBe(false);
    });

    it('with it, a URL under the exact configured prefix is accepted', () => {
      const tool = makeAssetIngestUrl({
        caption: async () => '',
        embed: async () => [],
        trustedLocalUrlPrefix: 'http://localhost:8080/v1/local-storage/',
      });
      const result = tool.input.safeParse({
        genomeId: 'gen_1',
        url: 'http://localhost:8080/v1/local-storage/org_1/gen_1/2026/08/x.jpg',
        assetRole: 'physical_capture',
        mediaType: 'image',
      });
      expect(result.success).toBe(true);
    });

    it('with it configured, a real public URL still validates normally', () => {
      const tool = makeAssetIngestUrl({
        caption: async () => '',
        embed: async () => [],
        trustedLocalUrlPrefix: 'http://localhost:8080/v1/local-storage/',
      });
      const result = tool.input.safeParse({
        genomeId: 'gen_1',
        url: 'https://example.com/product.jpg',
        assetRole: 'physical_capture',
        mediaType: 'image',
      });
      expect(result.success).toBe(true);
    });

    it('with it configured, a private-network URL that is NOT under the prefix is still rejected', () => {
      // The point of matching on the exact prefix rather than "any localhost
      // URL": widening to all of localhost would reopen the metadata-endpoint
      // class of attack safeUrl.ts exists to close.
      const tool = makeAssetIngestUrl({
        caption: async () => '',
        embed: async () => [],
        trustedLocalUrlPrefix: 'http://localhost:8080/v1/local-storage/',
      });
      const result = tool.input.safeParse({
        genomeId: 'gen_1',
        url: 'http://169.254.169.254/latest/meta-data/',
        assetRole: 'physical_capture',
        mediaType: 'image',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('asset.rights.set', () => {
  it('sets the rights status and returns the update', async () => {
    const setRights = vi.fn(async () => ({ id: 'asset_1', rightsStatus: 'cleared' }));
    const out = await assetRightsSet.handler(
      { genomeId: 'gen_1', assetId: 'asset_1', rightsStatus: 'cleared' },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, setRights } } }),
    );
    expect(setRights).toHaveBeenCalledWith({ id: 'asset_1', genomeId: 'gen_1', orgId: 'org_1', rightsStatus: 'cleared' });
    expect(out).toEqual({ assetId: 'asset_1', rightsStatus: 'cleared' });
  });

  it('throws NOT_FOUND rather than silently succeeding on an asset out of scope', async () => {
    await expect(
      assetRightsSet.handler(
        { genomeId: 'gen_1', assetId: 'asset_missing', rightsStatus: 'cleared' },
        ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, setRights: async () => undefined } } }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('is human_only — a rights determination is a person’s call, never SPARK’s to propose', () => {
    expect(assetRightsSet.autonomy).toBe('human_only');
  });
});

describe('asset.reuse', () => {
  it('records usage and returns the updated count', async () => {
    const lastUsedAt = new Date('2026-08-17T00:00:00Z');
    const recordUsage = vi.fn(async () => ({ id: 'asset_1', usageCount: 3, lastUsedAt }));
    const out = await assetReuse.handler(
      { genomeId: 'gen_1', assetId: 'asset_1' },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, recordUsage } } }),
    );
    expect(recordUsage).toHaveBeenCalledWith({ id: 'asset_1', genomeId: 'gen_1', orgId: 'org_1' });
    expect(out).toEqual({ assetId: 'asset_1', usageCount: 3, lastUsedAt: lastUsedAt.toISOString() });
  });

  it('throws NOT_FOUND for an asset out of scope', async () => {
    await expect(
      assetReuse.handler(
        { genomeId: 'gen_1', assetId: 'asset_missing' },
        ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, recordUsage: async () => undefined } } }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('is not idempotent — each call is a genuine, distinct usage event', () => {
    expect(assetReuse.idempotent).toBe(false);
  });
});

describe('asset.cooldown.check', () => {
  it('flags an asset used inside the cooldown window', async () => {
    const info = async () => ({ asset_1: { rightsStatus: 'cleared', lastUsedDaysAgo: 2, url: 'https://x/1.jpg', mediaType: 'image' } });
    const out = await assetCooldownCheck.handler(
      { genomeId: 'gen_1', assetIds: ['asset_1'] },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, info } } }),
    );
    expect(out.cooldownDays).toBe(7); // DEFAULT_COOLDOWN_DAYS, same as guard.duplicate
    expect(out.results).toEqual([{ assetId: 'asset_1', inCooldown: true, lastUsedDaysAgo: 2, found: true }]);
  });

  it('clears an asset used outside the window', async () => {
    const info = async () => ({ asset_1: { rightsStatus: 'cleared', lastUsedDaysAgo: 10, url: 'https://x/1.jpg', mediaType: 'image' } });
    const out = await assetCooldownCheck.handler(
      { genomeId: 'gen_1', assetIds: ['asset_1'] },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, info } } }),
    );
    expect(out.results[0]).toMatchObject({ inCooldown: false });
  });

  it('clears an asset that has never been used', async () => {
    const info = async () => ({ asset_1: { rightsStatus: 'cleared', url: 'https://x/1.jpg', mediaType: 'image' } });
    const out = await assetCooldownCheck.handler(
      { genomeId: 'gen_1', assetIds: ['asset_1'] },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, info } } }),
    );
    expect(out.results[0]).toEqual({ assetId: 'asset_1', inCooldown: false, found: true });
  });

  it('reports an asset out of scope as not found rather than throwing', async () => {
    const out = await assetCooldownCheck.handler(
      { genomeId: 'gen_1', assetIds: ['asset_missing'] },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, info: async () => ({}) } } }),
    );
    expect(out.results[0]).toEqual({ assetId: 'asset_missing', inCooldown: false, found: false });
  });

  it('respects a caller-supplied cooldown window over the default', async () => {
    const info = async () => ({ asset_1: { rightsStatus: 'cleared', lastUsedDaysAgo: 5, url: 'https://x/1.jpg', mediaType: 'image' } });
    const out = await assetCooldownCheck.handler(
      { genomeId: 'gen_1', assetIds: ['asset_1'], cooldownDays: 3 },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, info } } }),
    );
    expect(out.cooldownDays).toBe(3);
    expect(out.results[0]).toMatchObject({ inCooldown: false }); // 5 days ago, 3-day window — clear
  });
});

/** Fixed so `LIB-01`'s created-date assertion is exact rather than time-dependent. */
const FOLDER_CREATED = new Date('2026-08-01T10:00:00.000Z');

describe('asset.folder.create', () => {
  it('creates a folder and returns its id', async () => {
    const create = vi.fn(async () => ({ id: 'folder_1', genomeId: 'gen_1', name: 'B-roll', createdAt: new Date(), assetCount: 0 }));
    const out = await assetFolderCreate.handler(
      { genomeId: 'gen_1', name: 'B-roll' },
      ctx({ db: { ...ctx().db, assetFolders: { ...ctx().db.assetFolders, create } } }),
    );
    expect(create).toHaveBeenCalledWith({ genomeId: 'gen_1', orgId: 'org_1', name: 'B-roll' });
    expect(out).toEqual({ folderId: 'folder_1', name: 'B-roll' });
  });
});

describe('asset.folder.list', () => {
  it('lists this genome’s folders', async () => {
    const list = vi.fn(async () => [
      { id: 'folder_1', genomeId: 'gen_1', name: 'B-roll', createdAt: FOLDER_CREATED, assetCount: 4 },
      { id: 'folder_2', genomeId: 'gen_1', name: 'Testimonials', createdAt: FOLDER_CREATED, assetCount: 0 },
    ]);
    const out = await assetFolderList.handler(
      { genomeId: 'gen_1' },
      ctx({ db: { ...ctx().db, assetFolders: { ...ctx().db.assetFolders, list } } }),
    );
    expect(list).toHaveBeenCalledWith('gen_1', 'org_1');
    // `LIB-01` shows a created date and an item count per folder. Both were
    // computed by the query and dropped by the tool's output schema.
    expect(out).toEqual({
      folders: [
        { folderId: 'folder_1', name: 'B-roll', createdAt: FOLDER_CREATED.toISOString(), assetCount: 4 },
        { folderId: 'folder_2', name: 'Testimonials', createdAt: FOLDER_CREATED.toISOString(), assetCount: 0 },
      ],
    });
  });

  it('reports no folders honestly rather than throwing', async () => {
    const out = await assetFolderList.handler(
      { genomeId: 'gen_1' },
      ctx({ db: { ...ctx().db, assetFolders: { ...ctx().db.assetFolders, list: async () => [] } } }),
    );
    expect(out).toEqual({ folders: [] });
  });
});

describe('asset.folder.move', () => {
  it('moves an asset into a folder', async () => {
    const moveToFolder = vi.fn(async () => ({ id: 'asset_1', folderId: 'folder_1' }));
    const out = await assetFolderMove.handler(
      { genomeId: 'gen_1', assetId: 'asset_1', folderId: 'folder_1' },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, moveToFolder } } }),
    );
    expect(moveToFolder).toHaveBeenCalledWith({ id: 'asset_1', genomeId: 'gen_1', orgId: 'org_1', folderId: 'folder_1' });
    expect(out).toEqual({ assetId: 'asset_1', folderId: 'folder_1' });
  });

  it('moves an asset back out of any folder with folderId: null', async () => {
    const moveToFolder = vi.fn(async () => ({ id: 'asset_1', folderId: null }));
    const out = await assetFolderMove.handler(
      { genomeId: 'gen_1', assetId: 'asset_1', folderId: null },
      ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, moveToFolder } } }),
    );
    expect(out).toEqual({ assetId: 'asset_1', folderId: null });
  });

  it('throws NOT_FOUND when the asset or folder does not resolve in this genome', async () => {
    await expect(
      assetFolderMove.handler(
        { genomeId: 'gen_1', assetId: 'asset_1', folderId: 'folder_from_another_genome' },
        ctx({ db: { ...ctx().db, assets: { ...ctx().db.assets, moveToFolder: async () => undefined } } }),
      ),
    ).rejects.toThrow(ToolError);
  });
});
