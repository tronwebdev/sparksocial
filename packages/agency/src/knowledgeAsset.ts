import type { ToolCtx } from '@sparksocial/tools/defineTool';

/**
 * Register an attached document as the brand's `knowledge` asset.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 *
 * `brand.knowledge.attach_document` chunked a PDF into `knowledge_chunks` and
 * created no asset row. Those are two different things and only one of them is
 * what the resolver counts: playbook preconditions gate on
 * `required_asset_roles: ['knowledge']`, which is a count of rows in `assets`.
 *
 * So a brand that uploaded its company documents during onboarding — the step
 * literally titled "Upload company Docs (PDF)" — got retrieval over them and
 * still resolved nothing that needed a knowledge file. Watched it directly: a
 * brand with its knowledge base attached as text planned `slots: 0, unfilled:
 * 5`, and ingesting the identical PDF through `asset.ingest_url` took it to one
 * slot. The chunks had been there the whole time.
 *
 * Same shape of bug as `ensureBrandKitAsset`, one role across: a thing the
 * owner plainly supplied, visible in the product, invisible to the gate.
 *
 * ── Why this cannot leak the document into a post ─────────────────────────
 *
 * Auto-illustration retrieves assets with no role filter — deliberately, since
 * by then the question is only "is there a picture of this brand that suits
 * these words". A document is excluded one step later, where it keeps only
 * `mediaType === 'image' | 'video'`, so a PDF cannot become a backdrop. No beat
 * in any playbook sources `knowledge` either; like `brand_kit` it is a
 * capability check, not a content shelf.
 *
 * ── Cleared, not pending ──────────────────────────────────────────────────
 *
 * `asset.ingest_url` defaults to `pending`, which is right for material of
 * unknown provenance and wrong here: the owner uploaded their own company
 * document through their own onboarding. Left pending it would also be
 * invisible to the gate anyway — `assetInventory` counts only `cleared` — so
 * the brand would still build nothing, one layer further down.
 *
 * ── One row per attach, matching the chunks ───────────────────────────────
 *
 * `brand.knowledge.attach_document` is declared `idempotent: false` because
 * attaching the same document twice is two copies in retrieval rather than a
 * refresh. The asset row follows that same rule rather than inventing a
 * different one: a second attach is a second document as far as both halves are
 * concerned, and a caller that wants a refresh archives the old one.
 */
export async function registerKnowledgeAsset(
  ctx: ToolCtx,
  args: {
    genomeId: string;
    url: string;
    /** The file's own name — the citation label the chunks already carry. */
    filename: string;
    /** Opening of the extracted text, so the library row says what the document is. */
    excerpt: string;
    /** Embedding of the caption. The caller already has an embedder for the chunks. */
    embedding: number[];
    source: string;
  },
): Promise<void> {
  await ctx.db.assets.create({
    genomeId: args.genomeId,
    orgId: ctx.orgId,
    url: args.url,
    assetRole: 'knowledge',
    mediaType: 'document',
    rightsStatus: 'cleared',
    caption: caption(args.filename, args.excerpt),
    embedding: args.embedding,
    source: args.source,
    filename: args.filename,
  });
}

/**
 * What the Assets Library shows for this row.
 *
 * The filename plus the opening of what is actually inside it. The alternative
 * — a caption written by a model — is a vendor call for a document whose text
 * we are already holding, and `caption-client.ts` cannot read a PDF at all
 * without the primary vendor (its OpenAI fallback has no document block). This
 * needs neither, and says more than `PDF "a86d62bc-….pdf"` did.
 */
function caption(filename: string, excerpt: string): string {
  const opening = excerpt.replace(/\s+/g, ' ').trim().slice(0, 180);
  return opening ? `${filename} — ${opening}` : filename;
}
