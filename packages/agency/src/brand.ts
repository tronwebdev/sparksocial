import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `brand.*` — the agency multi-tenancy entry points (plan §6.9, §12 P6).
 *
 * `brands`/`genomes` have carried `orgId` + a per-brand row since P0/P1 — an
 * org has never been limited to one brand at the schema level. What was
 * missing is `brand.create` itself: the single-brand onboarding flow
 * (`genome.bootstrap_from_url`/`genome.create`) conflates "set up my
 * business" with "set up my first brand," which is right for a direct
 * customer and wrong for an agency adding client #4. This file is the
 * agency's own entry point, separate from that flow.
 */

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

/* ── brand.create ────────────────────────────────────────────────────── */

export const brandCreate = defineTool({
  name: 'brand.create',
  version: 1,

  summary:
    'Create a new brand (and its paired, empty genome) under this org — the agency path for adding a ' +
    "new client without leaving the workspace. Onboarding (the five-question flow) still fills in the " +
    'genome afterward; this only provisions the shell.',

  // Same required-field set as `genome.create` (packages/genome/src/create.ts)
  // — `GenomeIdentity` is validated in full on write, so a partial identity
  // throws a ZodError there rather than creating a half-formed genome. This
  // is the agency's version of that same "no website" entry point, so it
  // asks for the same minimum and defers everything else to onboarding the
  // same honest way `genome.create`'s own comment explains.
  input: z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(80),
    oneLiner: z.string().max(280).optional(),
    locale: z.string().min(2).max(12).default('en-US'),
  }),
  output: z.object({ brandId: z.string(), genomeId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  // Each call makes a new brand — a repeated call is a second client shell,
  // not a safe replay.
  idempotent: false,
  surfaces: ['ONB-01'],

  async handler(input, ctx) {
    const brandId = `brand_${randomUUID()}`;
    // Provisions the `brands` governance row (upsert-on-read, same as every
    // other first touch of a brand id).
    await ctx.db.brands.get(brandId, ctx.orgId, input.name);
    const genome = await ctx.db.genomes.createDraft({
      brandId,
      orgId: ctx.orgId,
      identity: {
        business_name: input.name,
        category: input.category,
        one_liner: input.oneLiner ?? '',
        geography: { scope: 'local', locale: input.locale, radius_km: null },
        languages: [input.locale.split('-')[0] ?? 'en'],
        // The schema requires a tier and nothing evidences one yet — same
        // "least consequential, onboarding corrects it" choice as
        // `genome.create`.
        price_tier: 'mid',
      },
      // Empty, not guessed — every routing dimension stays unresolved until
      // onboarding answers it, same as `genome.create`.
      dimensions: {},
      voice: {},
      source: 'user',
    });
    ctx.logger.info('brand created', { orgId: ctx.orgId, brandId, genomeId: genome.id });
    return { brandId, genomeId: genome.id, name: input.name };
  },
});

/* ── brand.settings.patch ────────────────────────────────────────────── */

export const brandSettingsPatch = defineTool({
  name: 'brand.settings.patch',
  version: 1,

  summary:
    'Rename a brand. Approval mode, pause state, and posting frequency have their own dedicated tools ' +
    '(approval.set, agent.pause, agent.frequency.set) — this is deliberately narrow rather than a second, ' +
    'overlapping way to set the same fields.',

  input: z.object({ brandId: z.string().min(1), name: z.string().min(1).max(120) }),
  output: z.object({ brandId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    // `brands.get` upserts on first read; a rename after that is a second
    // `get` call with the new name, matching `brandRepository.ts`'s own
    // upsert-then-reread shape for every governance field.
    const gov = await ctx.db.brands.get(input.brandId, ctx.orgId, input.name);
    return { brandId: gov.brandId, name: input.name };
  },
});

/* ── brand.knowledge.attach ──────────────────────────────────────────── */

export function makeBrandKnowledgeAttach(embed: EmbedClient) {
  return defineTool({
    name: 'brand.knowledge.attach',
    version: 1,

    summary:
      'Attach a piece of source text (a policy, a spec sheet, an FAQ) to a brand for claim-grounding. The ' +
      'one write the wider knowledge.* ingestion pipeline (site/doc crawling) would eventually feed — ' +
      'until that exists, this is the manual path in.',

    input: z.object({
      genomeId: z.string().min(1),
      docId: z.string().min(1).max(120),
      text: z.string().min(1).max(20_000),
      citationLabel: z.string().max(200).optional(),
    }),
    output: z.object({ id: z.string(), docId: z.string() }),

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,

    async handler(input, ctx) {
      const embedding = await embed.embed(input.text);
      const chunk = await ctx.db.knowledge.attach({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        docId: input.docId,
        text: input.text,
        embedding,
        ...(input.citationLabel ? { citation: { label: input.citationLabel } } : {}),
      });
      ctx.logger.info('knowledge attached', { genomeId: input.genomeId, docId: input.docId });
      return { id: chunk.id, docId: chunk.docId };
    },
  });
}

/* ── brand.knowledge.attach_document ─────────────────────────────────── */

/**
 * Reads a document at a URL and hands back its text. Injected, because
 * extracting a PDF needs a parser and `packages/agency` has no business carrying
 * one — the same reasoning `makeBrandKnowledgeAttach` applies to embeddings.
 *
 * The implementation lives in `apps/api/src/document-reader.ts`.
 */
export interface DocumentReader {
  read(url: string): Promise<{ text: string; pages: number }>;
}

/**
 * How much of one document reaches the Asset Graph.
 *
 * `brand.knowledge.attach` caps a single chunk at 20,000 characters, which is
 * roughly eight pages of a brand guideline. A longer document is split rather
 * than truncated, and the split is capped in turn: forty chunks is ~320,000
 * characters, past which somebody has uploaded the wrong file and the honest
 * answer is to say so rather than to embed a novel.
 */
const CHUNK_CHARS = 8_000;
const MAX_CHUNKS = 40;

/**
 * `brand.knowledge.attach_document` — F6's "Upload company Docs (PDF)".
 *
 * The onboarding step and the Brand Kit panel both offer a document upload, and
 * `brand.knowledge.attach` only ever took *text* — so a PDF had no way in, and
 * the design's "Spark reads these documents to learn your brand voice, offering
 * and facts" had nothing behind it.
 *
 * ── Why the file arrives as a URL ──────────────────────────────────────────
 *
 * The browser uploads to blob storage through `asset.upload_url` first, exactly
 * as the logo does, and passes the read URL here. Posting the bytes through a
 * tool call would put a multi-megabyte body on the tool-call audit path — every
 * request is recorded in `tool_calls` — and a PDF in that table is a PDF nobody
 * can query and everybody pays to store twice.
 *
 * ── Chunked, and each chunk cited ─────────────────────────────────────────
 *
 * Retrieval works on chunks, so a whole guideline arriving as one chunk would
 * match every query about the brand equally and rank against nothing. Each chunk
 * carries the same citation label — the file's own name — because a claim
 * grounded in "page 4 of the guideline" is only useful if the answer can say
 * which document it came from.
 */
export function makeBrandKnowledgeAttachDocument(deps: { embed: EmbedClient; reader: DocumentReader }) {
  return defineTool({
    name: 'brand.knowledge.attach_document',
    version: 1,

    summary:
      'Read a PDF already uploaded to storage and attach its text to a brand for claim-grounding. Splits ' +
      'a long document into retrievable chunks. Use brand.knowledge.attach for text you already have.',

    input: z.object({
      genomeId: z.string().min(1),
      /** A storage URL from `asset.upload_url`, not an arbitrary address. */
      url: z.string().url(),
      /** The file's own name, used as the citation label and the doc id prefix. */
      filename: z.string().min(1).max(200),
    }),
    output: z.object({
      docId: z.string(),
      pages: z.number().int(),
      chunks: z.number().int(),
      /** Characters extracted — a scanned PDF with no text layer comes back near zero. */
      characters: z.number().int(),
    }),

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Attaching the same document twice is two copies in retrieval, not a
    // refresh — the same reasoning `brand.knowledge.attach` gives.
    idempotent: false,

    async handler(input, ctx) {
      const { text, pages } = await ctx.trace.span('document.read', () => deps.reader.read(input.url));

      /**
       * A scanned PDF is the common failure and it fails *quietly*: the parse
       * succeeds, the text is empty, and the brand is told its guideline was
       * read. Naming it here is the difference between "upload a text PDF
       * instead" and "why does the agent not know any of this".
       */
      const cleaned = text.replace(/\s+\n/g, '\n').trim();
      if (cleaned.length < 40) {
        throw new ToolError(
          'INVALID_INPUT',
          'That PDF has no text in it — it is probably a scan. Export a text PDF, or paste the words in instead.',
          { filename: input.filename, pages, characters: cleaned.length },
        );
      }

      const docId = `doc:${input.filename}`.slice(0, 120);
      const chunks = chunkText(cleaned).slice(0, MAX_CHUNKS);

      for (const [i, chunk] of chunks.entries()) {
        const embedding = await deps.embed.embed(chunk);
        await ctx.db.knowledge.attach({
          genomeId: input.genomeId,
          orgId: ctx.orgId,
          // Part number in the id, so re-attaching a corrected document is
          // visibly a second copy rather than an invisible merge.
          docId: `${docId}#${i + 1}`,
          text: chunk,
          embedding,
          citation: { label: input.filename },
        });
      }

      ctx.logger.info('document attached', {
        genomeId: input.genomeId,
        filename: input.filename,
        pages,
        chunks: chunks.length,
      });

      return { docId, pages, chunks: chunks.length, characters: cleaned.length };
    },
  });
}

/**
 * Splits on paragraph boundaries, falling back to a hard cut.
 *
 * Splitting mid-sentence is what makes a retrieved chunk unquotable — the answer
 * cites half a claim — so the break is taken at the last blank line inside the
 * budget where there is one.
 */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];

  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
    // Only honour a break in the back half: a paragraph ending at character 200
    // of an 8,000-character budget would produce forty tiny chunks.
    const cut = breakAt > size / 2 ? breakAt : size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/* ── brand.export / brand.import ────────────────────────────────────── */

/**
 * What travels. Deliberately excludes `learned` (this account's own
 * performance history has no meaning for a different brand) and every id —
 * import always mints a fresh brand/genome rather than overwriting one.
 */
const BrandExportPayload = z.object({
  name: z.string(),
  identity: z.record(z.string(), z.unknown()),
  dimensions: z.record(z.string(), z.unknown()),
  voice: z.record(z.string(), z.unknown()),
  offer: z.record(z.string(), z.unknown()),
  constraints: z.record(z.string(), z.unknown()),
});
type BrandExportPayload = z.infer<typeof BrandExportPayload>;

export const brandExport = defineTool({
  name: 'brand.export',
  version: 1,
  summary: 'Export a brand\'s genome (identity, dimensions, voice, offer, constraints — not its learned performance history) as portable JSON.',
  input: z.object({ genomeId: z.string().min(1) }),
  output: z.object({ data: BrandExportPayload }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,
  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });
    return {
      data: {
        name: genome.identity.business_name,
        identity: genome.identity,
        dimensions: genome.dimensions,
        voice: genome.voice,
        offer: genome.offer,
        constraints: genome.constraints,
      },
    };
  },
});

export const brandImport = defineTool({
  name: 'brand.import',
  version: 1,

  summary:
    'Create a new brand from a previously exported one — the fast path for an agency onboarding a client ' +
    "similar to one it already runs. Audience segments are not carried over (no write path for that field " +
    "exists anywhere in the registry yet); everything else transfers.",

  input: z.object({ name: z.string().min(1).max(120).optional(), data: BrandExportPayload }),
  output: z.object({ brandId: z.string(), genomeId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: false,

  async handler(input, ctx) {
    const name = input.name ?? input.data.name;
    const brandId = `brand_${randomUUID()}`;
    await ctx.db.brands.get(brandId, ctx.orgId, name);

    const genome = await ctx.db.genomes.createDraft({
      brandId,
      orgId: ctx.orgId,
      identity: { ...input.data.identity, business_name: name },
      dimensions: input.data.dimensions,
      voice: input.data.voice,
      source: 'user',
    });

    await ctx.db.genomes.patchOffer({ genomeId: genome.id, orgId: ctx.orgId, offer: input.data.offer });
    await ctx.db.genomes.patchConstraints({
      genomeId: genome.id,
      orgId: ctx.orgId,
      patch: {
        heygenAvatarId: (input.data.constraints as { heygen_avatar_id?: string }).heygen_avatar_id,
        elevenlabsVoiceId: (input.data.constraints as { elevenlabs_voice_id?: string }).elevenlabs_voice_id,
      },
    });

    ctx.logger.info('brand imported', { orgId: ctx.orgId, brandId, genomeId: genome.id, sourceName: input.data.name });
    return { brandId, genomeId: genome.id, name };
  },
});
