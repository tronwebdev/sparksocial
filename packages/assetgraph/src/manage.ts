import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import type { EmbedClient } from './retrieve.js';

/**
 * MANAGING AN ASSET AFTER IT IS IN THE GRAPH — `LIB-02`, PRD §8.11.
 *
 * The Assets Library draws two per-row actions the registry had no tool for:
 * a trash icon, and an editable `Meta Description` column. Ten `asset.*` tools
 * existed and every one of them was about getting an asset *in* (upload, ingest,
 * caption at ingest, embed) or *choosing* one (retrieve, gaps, cooldown, reuse,
 * rights, folders). Nothing could change or retire one afterwards, so the two
 * controls the screen offers most often were the two with nothing behind them.
 */

/* ── asset.archive ───────────────────────────────────────────────────── */

/**
 * Archive, not delete — decided 27 August.
 *
 * A published post stores `assetId` in its beats, and `zipTimeline` throws
 * `NOT_FOUND` when the asset is gone from the graph. So a hard delete does not
 * only free storage: it breaks the render of posts that are already live, and of
 * every draft that referenced the asset. The prototype's trash icon does not say
 * which of those it meant, and the safe reading is the reversible one.
 *
 * Archiving sets `assets.archived_at`. `buildRetrieveQuery` filters on it — in
 * the scoped layer, beside the rights filter, rather than in a caller that could
 * forget — so an archived asset leaves retrieval, leaves the library, and can
 * never be planned into a new beat. The row and the blob stay, so anything that
 * already points at it keeps working.
 *
 * Restore is the same tool with `archived: false`, because "undo" has to be as
 * easy as the thing it undoes.
 */
export const AssetArchiveInput = z.object({
  genomeId: z.string().min(1),
  assetId: z.string().min(1),
  /** False restores. Explicit rather than a separate tool, so undo is symmetrical. */
  archived: z.boolean().default(true),
});

export const AssetArchiveOutput = z.object({
  assetId: z.string(),
  archived: z.boolean(),
  /** When it was archived, absent once restored. */
  archivedAt: z.string().optional(),
});

export const assetArchive = defineTool({
  name: 'asset.archive',
  version: 1,

  summary:
    'Take an asset out of the library and out of retrieval, or put it back. Nothing is deleted — a post ' +
    'that already uses the asset still renders, which is why this is not a delete. Free.',

  input: AssetArchiveInput,
  output: AssetArchiveOutput,

  effect: 'write',
  /**
   * `write`, not `destructive`. Nothing is destroyed and the action is
   * reversible by the same tool, so classifying it as destructive would put it
   * behind the containment gate that exists for irreversible things and make
   * tidying a library feel like a dangerous act.
   */
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Archiving something already archived is the same state.
  idempotent: true,
  surfaces: ['LIB-02'],

  async handler(input, ctx) {
    const row = await ctx.db.assets.setArchived({
      id: input.assetId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      archived: input.archived,
    });
    if (!row) {
      throw new ToolError('NOT_FOUND', 'No such asset in this brand.', { assetId: input.assetId });
    }

    ctx.logger.info(input.archived ? 'asset archived' : 'asset restored', {
      assetId: input.assetId,
      by: ctx.userId ?? 'unknown',
    });

    return {
      assetId: row.id,
      archived: row.archivedAt !== null,
      ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    };
  },
});

/* ── asset.caption.set ───────────────────────────────────────────────── */

/**
 * PRD §8.11: *"List view supports metadata editing (caption/description)."*
 *
 * ── Why this re-embeds ────────────────────────────────────────────────────
 *
 * The caption is not a label on the asset. It is the text that gets embedded, so
 * it *is* the asset as far as retrieval is concerned — `asset.retrieve` scores
 * intent against caption embeddings, and `guard.claim_grounding` reads captions
 * as evidence. Editing the words without re-embedding would leave the library
 * showing one thing and the graph matching on another, and the divergence would
 * be invisible: retrieval would keep working, just against text nobody can see
 * any more.
 *
 * So this spends an embedding call, and that is the whole reason it costs
 * anything. It is the cheapest call in the system and it is not free.
 */
export const AssetCaptionSetInput = z.object({
  genomeId: z.string().min(1),
  assetId: z.string().min(1),
  /**
   * Long enough to be searchable, short enough to embed as one idea — the same
   * ceiling `caption-client.ts` writes to. A caption is a description, not a
   * document; a paragraph embeds to a point that matches everything weakly.
   */
  caption: z.string().min(3).max(400),
});

export const AssetCaptionSetOutput = z.object({
  assetId: z.string(),
  caption: z.string(),
});

export function makeAssetCaptionSet(embed: EmbedClient) {
  return defineTool({
    name: 'asset.caption.set',
    version: 1,

    summary:
      'Rewrite what an asset says it shows. Re-embeds it, so retrieval matches on the new words rather ' +
      'than the old ones — which is the point, and why this is not a rename.',

    input: AssetCaptionSetInput,
    output: AssetCaptionSetOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Setting a caption to a given value is a safe replay of that value.
    idempotent: true,
    surfaces: ['LIB-02'],
    /** One embedding call. The cheapest spend in the system, and still a spend. */
    estimateCents: () => 1,

    async handler(input, ctx) {
      const caption = input.caption.trim();
      const embedding = await embed.embed(caption);

      const row = await ctx.db.assets.setCaption({
        id: input.assetId,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        caption,
        embedding,
      });
      if (!row) {
        throw new ToolError('NOT_FOUND', 'No such asset in this brand.', { assetId: input.assetId });
      }

      ctx.logger.info('asset caption edited', { assetId: input.assetId, by: ctx.userId ?? 'unknown' });
      return { assetId: row.id, caption: row.caption ?? caption };
    },
  });
}
