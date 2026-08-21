import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { PublicHttpUrl } from '@sparksocial/shared/safeUrl';
import { claimGrounding } from '@sparksocial/guardrails';
import { crawl as defaultCrawl, type CrawlOptions, type CrawlResult } from './crawl.js';
import { explainCrawlFailure } from './bootstrap.js';

/**
 * `knowledge.ingest_site` / `.ingest_docs` / `.ground_claim` — the automated
 * half of claim-grounding that `brand.knowledge.attach`'s own comment named
 * as the gap: *"the one write the wider knowledge.* ingestion pipeline
 * (site/doc crawling) would eventually feed — until that exists, this is the
 * manual path in."* All three write through the same `ctx.db.knowledge.attach`
 * `brand.knowledge.attach` does, so nothing downstream needs to know which
 * tool put a chunk there.
 */

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

/* ── knowledge.ingest_site ──────────────────────────────────────────── */

export interface KnowledgeIngestSiteDeps {
  embed: EmbedClient;
  /** Defaults to the real crawl service; injected in tests. */
  crawl?: (url: string, opts: CrawlOptions) => Promise<CrawlResult>;
}

export const KnowledgeIngestSiteInput = z.object({
  genomeId: z.string().min(1),
  url: PublicHttpUrl,
  maxPages: z.number().int().min(1).max(20).default(5),
});

const IngestedDoc = z.object({ docId: z.string(), title: z.string(), chars: z.number().int() });

export const KnowledgeIngestSiteOutput = z.object({
  genomeId: z.string(),
  attached: z.array(IngestedDoc),
  /** Set only when the crawl produced nothing to attach. */
  failure: z.string().optional(),
});

export function makeKnowledgeIngestSite(deps: KnowledgeIngestSiteDeps) {
  const crawl = deps.crawl ?? defaultCrawl;

  return defineTool({
    name: 'knowledge.ingest_site',
    version: 1,

    summary:
      'Crawl a site and attach each readable page as a knowledge chunk for claim-grounding — the automated ' +
      'counterpart to brand.knowledge.attach’s one-doc-at-a-time manual path.',

    input: KnowledgeIngestSiteInput,
    output: KnowledgeIngestSiteOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    /**
     * A real browser crawl plus one embedding per page. Modelled on
     * `genome.bootstrap_from_url`'s own estimate, which charges per page for
     * exactly the same work — this tool did the same crawling and recorded 0¢.
     */
    estimateCents: (i) => 1 + i.maxPages,

    async handler(input, ctx) {
      const result = await crawl(input.url, { maxPages: input.maxPages });

      if (result.pages.length === 0) {
        return { genomeId: input.genomeId, attached: [], failure: explainCrawlFailure(input.url, result.failure) };
      }

      const attached: z.infer<typeof IngestedDoc>[] = [];
      for (const page of result.pages) {
        // `crawl()` already caps a page's text at its own MAX_TEXT (20,000
        // chars) — the same ceiling `brand.knowledge.attach`'s input schema
        // enforces, so every crawled page fits in one chunk with no further
        // splitting needed.
        const docId = `site:${new URL(page.url).pathname || '/'}`;
        try {
          const embedding = await deps.embed.embed(page.text);
          await ctx.db.knowledge.attach({
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            docId,
            text: page.text,
            embedding,
            citation: { label: page.title || page.url, url: page.url },
          });
          attached.push({ docId, title: page.title, chars: page.text.length });
        } catch (e) {
          // One page failing to embed/write must not lose the rest of the
          // crawl — same "process every item, log the one that fails"
          // resilience the scheduler and recipe runner both use.
          ctx.logger.error('knowledge.ingest_site: failed to attach a page', {
            genomeId: input.genomeId,
            url: page.url,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      ctx.logger.info('knowledge ingested from site', { genomeId: input.genomeId, url: input.url, pages: attached.length });
      return { genomeId: input.genomeId, attached };
    },
  });
}

/* ── knowledge.ingest_docs ──────────────────────────────────────────── */

export interface KnowledgeIngestDocsDeps {
  embed: EmbedClient;
}

const DocInput = z.object({
  docId: z.string().min(1).max(120),
  text: z.string().min(1).max(20_000),
  citationLabel: z.string().max(200).optional(),
});

export const KnowledgeIngestDocsInput = z.object({
  genomeId: z.string().min(1),
  docs: z.array(DocInput).min(1).max(20),
});

const DocResult = z.object({ docId: z.string(), attached: z.boolean(), error: z.string().optional() });

export const KnowledgeIngestDocsOutput = z.object({
  genomeId: z.string(),
  results: z.array(DocResult),
});

export function makeKnowledgeIngestDocs(deps: KnowledgeIngestDocsDeps) {
  return defineTool({
    name: 'knowledge.ingest_docs',
    version: 1,

    summary:
      'Attach several documents (FAQs, policies, spec sheets — already-extracted text, not files) as knowledge ' +
      'chunks in one call. Each is independent: one failing does not lose the rest of the batch.',

    input: KnowledgeIngestDocsInput,
    output: KnowledgeIngestDocsOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    /** One embedding per document. */
    estimateCents: (i) => Math.max(1, i.docs.length),

    async handler(input, ctx) {
      const results: z.infer<typeof DocResult>[] = [];
      for (const doc of input.docs) {
        try {
          const embedding = await deps.embed.embed(doc.text);
          await ctx.db.knowledge.attach({
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            docId: doc.docId,
            text: doc.text,
            embedding,
            ...(doc.citationLabel ? { citation: { label: doc.citationLabel } } : {}),
          });
          results.push({ docId: doc.docId, attached: true });
        } catch (e) {
          results.push({ docId: doc.docId, attached: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      ctx.logger.info('knowledge ingested from docs', {
        genomeId: input.genomeId,
        attached: results.filter((r) => r.attached).length,
        failed: results.filter((r) => !r.attached).length,
      });
      return { genomeId: input.genomeId, results };
    },
  });
}

/* ── knowledge.list ─────────────────────────────────────────────────── */

export const KnowledgeListInput = z.object({ genomeId: z.string().min(1) });

export const KnowledgeListOutput = z.object({
  genomeId: z.string(),
  docs: z.array(
    z.object({
      docId: z.string(),
      /** How many chunks this doc was split into. One for a crawled page; more for a long pasted document. */
      chunks: z.number().int(),
      chars: z.number().int(),
      /** Whatever label the ingester recorded — a page title for a crawl, the caller's own for a paste. */
      citationLabel: z.string().optional(),
      attachedAt: z.string(),
      /** The first ~200 characters, so a person can tell two similarly-named docs apart. */
      preview: z.string(),
    }),
  ),
  totalChunks: z.number().int(),
  totalChars: z.number().int(),
});

/**
 * What is actually attached to this brand — the read the three ingestion tools
 * never had.
 *
 * Without it the ingestion story had no ending. `knowledge.ingest_site`,
 * `knowledge.ingest_docs` and `brand.knowledge.attach` all write, each returns
 * what *it* just did, and nothing could answer "what does this brand know?" a
 * minute later. That matters more here than for most reads, because
 * `guard.claim_grounding` fails a draft by consulting exactly this corpus: a
 * brand seeing "this claim is not grounded" has no way to check whether the
 * document it thought it attached is there.
 *
 * Grouped by `docId`, not one row per chunk. Chunks are an implementation
 * detail of embedding — a person attached *a document*, and a list that showed
 * one 20,000-character policy as fourteen rows would be reporting the storage
 * layout rather than the thing they did.
 */
export const knowledgeList = defineTool({
  name: 'knowledge.list',
  version: 1,

  summary:
    "Every source document attached to this brand for claim-grounding, grouped by document rather than by " +
    'embedding chunk, newest first. The read side of knowledge.ingest_site/.ingest_docs. Free.',

  input: KnowledgeListInput,
  output: KnowledgeListOutput,

  effect: 'read',
  autonomy: 'auto',
  /**
   * Includes `client`, unlike `org.audit.query`. This is the brand's own source
   * material — the FAQs and policies it already published — not a record of
   * SPARK's decisions or failures, so there is nothing here an agency's client
   * should not see about their own brand.
   */
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['ONB-02', 'SET-WS-01'],

  async handler(input, ctx) {
    const chunks = await ctx.db.knowledge.listAll(input.genomeId, ctx.orgId);

    const byDoc = new Map<string, { chunks: number; chars: number; label?: string; at: Date; preview: string }>();
    for (const chunk of chunks) {
      const existing = byDoc.get(chunk.docId);
      // The citation label lives on the chunk in this schema, so any chunk of a
      // doc carries it; first one wins rather than last, so a re-ingest that
      // dropped the label does not blank an existing one.
      const label = typeof chunk.citation === 'string' ? chunk.citation : undefined;
      if (existing) {
        existing.chunks += 1;
        existing.chars += chunk.text.length;
        if (chunk.createdAt > existing.at) existing.at = chunk.createdAt;
        continue;
      }
      byDoc.set(chunk.docId, {
        chunks: 1,
        chars: chunk.text.length,
        ...(label ? { label } : {}),
        at: chunk.createdAt,
        preview: chunk.text.slice(0, 200),
      });
    }

    const docs = [...byDoc.entries()]
      .sort((a, b) => b[1].at.getTime() - a[1].at.getTime())
      .map(([docId, d]) => ({
        docId,
        chunks: d.chunks,
        chars: d.chars,
        ...(d.label ? { citationLabel: d.label } : {}),
        attachedAt: d.at.toISOString(),
        preview: d.preview,
      }));

    return {
      genomeId: input.genomeId,
      docs,
      totalChunks: chunks.length,
      totalChars: docs.reduce((n, d) => n + d.chars, 0),
    };
  },
});

/* ── knowledge.ground_claim ─────────────────────────────────────────── */

export const KnowledgeGroundClaimInput = z.object({
  genomeId: z.string().min(1),
  /** The exact sentence or claim to check — not a whole draft (that's `guard.claim_grounding`'s job at publish time). */
  claim: z.string().min(1).max(2000),
});

export const KnowledgeGroundClaimOutput = z.object({
  grounded: z.boolean(),
  ungroundedClaims: z.array(z.string()),
  fixAction: z.string().optional(),
});

/**
 * A pre-flight read of the exact check `guard.claim_grounding` runs at
 * publish time — so a specific claim can be checked *before* it's written
 * into a draft, the same relationship `asset.cooldown.check` has to
 * `guard.duplicate`'s reuse-cooldown check.
 */
export const knowledgeGroundClaim = defineTool({
  name: 'knowledge.ground_claim',
  version: 1,

  summary:
    "Check whether a specific claim traces to this genome's knowledge or social-proof assets, before it's " +
    'written into a draft — the same check guard.claim_grounding enforces at publish time, run early.',

  input: KnowledgeGroundClaimInput,
  output: KnowledgeGroundClaimOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
    }

    const [captions, chunks] = await Promise.all([
      ctx.db.assets.captionsByRole(input.genomeId, ctx.orgId, ['knowledge', 'social_proof']),
      ctx.db.knowledge.listAll(input.genomeId, ctx.orgId),
    ]);
    const groundingCorpus = [...captions, ...chunks.map((c) => c.text)].join('\n');

    const result = claimGrounding({ text: input.claim, groundingCorpus });
    if (result.verdict === 'block') {
      const evidence = result.evidence as { ungroundedClaims?: string[] } | undefined;
      return { grounded: false, ungroundedClaims: evidence?.ungroundedClaims ?? [], fixAction: result.fixAction };
    }
    return { grounded: true, ungroundedClaims: [] };
  },
});
