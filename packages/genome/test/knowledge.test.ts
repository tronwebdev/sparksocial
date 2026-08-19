import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeKnowledgeIngestSite, makeKnowledgeIngestDocs, knowledgeGroundClaim } from '../src/knowledge.js';

/**
 * `knowledge.ingest_site` / `.ingest_docs` / `.ground_claim` — the automated
 * counterpart to `brand.knowledge.attach`'s manual one-doc-at-a-time path.
 * What matters here: every attach call carries a real embedding (not a
 * placeholder), one failing page/doc doesn't lose the rest of the batch, and
 * `.ground_claim` reads the exact same two-source corpus
 * `guard.claim_grounding` does (see `gather.ts`'s own fix).
 */

function genome(over: Partial<Genome['identity']> = {}): Genome {
  return {
    id: 'gen_1',
    org_id: 'org_1',
    workspace_id: 'brand_1',
    identity: {
      business_name: 'Test Co',
      category: 'general business',
      one_liner: 'we do things',
      geography: { scope: 'local', locale: 'en-US', radius_km: 10 },
      languages: ['en'],
      price_tier: 'mid',
      ...over,
    },
  } as unknown as Genome;
}

function ctx(over: { knowledge?: Partial<ScopedDb['knowledge']>; assets?: Partial<ScopedDb['assets']>; get?: ScopedDb['genomes']['get'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: { get: over.get ?? (async () => genome()) },
      assets: { captionsByRole: async () => [], ...over.assets },
      knowledge: {
        attach: async ({ genomeId, docId }: { genomeId: string; docId: string }) => ({ id: `kc_${docId}`, genomeId, docId, text: '', createdAt: new Date() }),
        listForDoc: async () => [],
        listAll: async () => [],
        ...over.knowledge,
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('knowledge.ingest_site', () => {
  it('attaches one chunk per crawled page, embedding each page’s text', async () => {
    const attach = vi.fn(async ({ genomeId, docId }: { genomeId: string; docId: string }) => ({ id: `kc_${docId}`, genomeId, docId, text: '', createdAt: new Date() }));
    const embedFn = vi.fn(async (text: string) => [text.length]);
    const crawl = vi.fn(async () => ({
      pages: [
        { url: 'https://example.com/', title: 'Home', text: 'Welcome to Example Co.' },
        { url: 'https://example.com/faq', title: 'FAQ', text: 'Frequently asked questions.' },
      ],
    }));
    const tool = makeKnowledgeIngestSite({ embed: { embed: embedFn }, crawl });

    const out = await tool.handler({ genomeId: 'gen_1', url: 'https://example.com', maxPages: 5 }, ctx({ knowledge: { attach } }));

    expect(out.attached).toHaveLength(2);
    expect(out.attached.map((a) => a.docId)).toEqual(['site:/', 'site:/faq']);
    expect(embedFn).toHaveBeenCalledWith('Welcome to Example Co.');
    expect(embedFn).toHaveBeenCalledWith('Frequently asked questions.');
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('reports a friendly failure when the crawl finds nothing, rather than an empty success', async () => {
    const crawl = vi.fn(async () => ({ pages: [], failure: 'blocked' as const }));
    const tool = makeKnowledgeIngestSite({ embed: { embed: async () => [0] }, crawl });

    const out = await tool.handler({ genomeId: 'gen_1', url: 'https://example.com', maxPages: 5 }, ctx());

    expect(out.attached).toEqual([]);
    expect(out.failure).toContain('blocked us');
  });

  it('one page failing to attach does not lose the rest of the crawl', async () => {
    let calls = 0;
    const attach = vi.fn(async ({ genomeId, docId }: { genomeId: string; docId: string }) => {
      calls += 1;
      if (calls === 1) throw new Error('db unavailable');
      return { id: `kc_${docId}`, genomeId, docId, text: '', createdAt: new Date() };
    });
    const crawl = vi.fn(async () => ({
      pages: [
        { url: 'https://example.com/a', title: 'A', text: 'page a content here' },
        { url: 'https://example.com/b', title: 'B', text: 'page b content here' },
      ],
    }));
    const tool = makeKnowledgeIngestSite({ embed: { embed: async () => [0] }, crawl });

    const out = await tool.handler({ genomeId: 'gen_1', url: 'https://example.com', maxPages: 5 }, ctx({ knowledge: { attach } }));

    expect(out.attached).toHaveLength(1);
    expect(out.attached[0]!.docId).toBe('site:/b');
  });

  it('refuses a private-network URL rather than crawling it', () => {
    const tool = makeKnowledgeIngestSite({ embed: { embed: async () => [0] } });
    const result = tool.input.safeParse({ genomeId: 'gen_1', url: 'http://169.254.169.254/latest/meta-data/' });
    expect(result.success).toBe(false);
  });
});

describe('knowledge.ingest_docs', () => {
  it('attaches every doc in the batch', async () => {
    const attach = vi.fn(async ({ genomeId, docId }: { genomeId: string; docId: string }) => ({ id: `kc_${docId}`, genomeId, docId, text: '', createdAt: new Date() }));
    const tool = makeKnowledgeIngestDocs({ embed: { embed: async () => [0] } });

    const out = await tool.handler(
      { genomeId: 'gen_1', docs: [{ docId: 'faq_1', text: 'How long does a haircut take? 20 minutes.' }, { docId: 'policy_1', text: 'Cancellations require 24 hours notice.' }] },
      ctx({ knowledge: { attach } }),
    );

    expect(out.results).toEqual([
      { docId: 'faq_1', attached: true },
      { docId: 'policy_1', attached: true },
    ]);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('one doc failing does not lose the rest of the batch, and reports which failed', async () => {
    let calls = 0;
    const attach = vi.fn(async ({ genomeId, docId }: { genomeId: string; docId: string }) => {
      calls += 1;
      if (calls === 1) throw new Error('duplicate docId');
      return { id: `kc_${docId}`, genomeId, docId, text: '', createdAt: new Date() };
    });
    const tool = makeKnowledgeIngestDocs({ embed: { embed: async () => [0] } });

    const out = await tool.handler(
      { genomeId: 'gen_1', docs: [{ docId: 'a', text: 'first doc' }, { docId: 'b', text: 'second doc' }] },
      ctx({ knowledge: { attach } }),
    );

    expect(out.results[0]).toMatchObject({ docId: 'a', attached: false, error: 'duplicate docId' });
    expect(out.results[1]).toEqual({ docId: 'b', attached: true });
  });

  it('refuses an empty batch and a doc over the size cap', () => {
    const tool = makeKnowledgeIngestDocs({ embed: { embed: async () => [0] } });
    expect(tool.input.safeParse({ genomeId: 'gen_1', docs: [] }).success).toBe(false);
    expect(tool.input.safeParse({ genomeId: 'gen_1', docs: [{ docId: 'a', text: 'x'.repeat(20_001) }] }).success).toBe(false);
  });
});

describe('knowledge.ground_claim', () => {
  it('grounds a claim found in a knowledge chunk', async () => {
    const listAll = async () => [{ id: 'kc_1', genomeId: 'gen_1', docId: 'faq', text: 'Every fade is finished in 20 minutes flat.', createdAt: new Date() }];
    const out = await knowledgeGroundClaim.handler(
      { genomeId: 'gen_1', claim: 'Fades finished in 20 minutes flat.' },
      ctx({ knowledge: { listAll } }),
    );
    expect(out.grounded).toBe(true);
    expect(out.ungroundedClaims).toEqual([]);
  });

  it('grounds a claim found in an asset caption, not just knowledge_chunks', async () => {
    const out = await knowledgeGroundClaim.handler(
      { genomeId: 'gen_1', claim: 'Over 500 satisfied customers.' },
      ctx({ assets: { captionsByRole: async () => ['Over 500 satisfied customers and counting.'] } }),
    );
    expect(out.grounded).toBe(true);
  });

  it('reports an ungrounded specific claim with a fix action, rather than passing it', async () => {
    const out = await knowledgeGroundClaim.handler({ genomeId: 'gen_1', claim: 'Cut costs by 40% for every client.' }, ctx());
    expect(out.grounded).toBe(false);
    expect(out.ungroundedClaims.length).toBeGreaterThan(0);
    expect(out.fixAction).toBeTruthy();
  });

  it('a claim with no checkable specifics is trivially grounded', async () => {
    const out = await knowledgeGroundClaim.handler({ genomeId: 'gen_1', claim: 'We love what we do.' }, ctx());
    expect(out.grounded).toBe(true);
  });

  it('throws NOT_FOUND for an unknown genome', async () => {
    await expect(
      knowledgeGroundClaim.handler({ genomeId: 'gen_missing', claim: 'anything' }, ctx({ get: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });
});
