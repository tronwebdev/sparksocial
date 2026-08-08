import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { AssetRole, PublicHttpUrl } from '@sparksocial/shared';

/**
 * `asset.ingest_url` — engine spec §4.1.
 *
 * Every asset gets typed (`asset_role`) and gets a vision/audio pass to produce a
 * caption before it is embedded (`text-embedding-3-large` @ 1536, per the
 * ClientForce standard). This tool is the entry point for anything that already
 * has a URL — a WhatsApp media upload, a Drive file, a scraped product photo.
 * `asset.upload` (direct binary) follows the same shape once Blob Storage is
 * wired; both funnel into the same `ctx.db.assets.create`.
 *
 * Captioning and embedding are injected clients, not imports — this tool has no
 * opinion on which vision model or embedding endpoint is behind them, and stays
 * testable with fakes. Real implementations call Azure-hosted or vendor APIs from
 * `apps/api`, never from here.
 */

export const AssetIngestUrlInput = z.object({
  genomeId: z.string(),
  // Fetched server-side to caption and embed it — must not be able to point
  // at the instance metadata endpoint (packages/shared/src/safeUrl.ts).
  url: PublicHttpUrl,
  assetRole: AssetRole,
  mediaType: z.enum(['image', 'video', 'audio']),
  /** 'cleared' only when consent/licensing is already confirmed; else 'pending'. */
  rightsStatus: z.enum(['cleared', 'pending', 'restricted']).default('pending'),
  source: z.string().optional(),
});

export const AssetIngestUrlOutput = z.object({
  assetId: z.string(),
  caption: z.string(),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['asset']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export interface CaptionClient {
  /** Vision/audio pass → semantic description. Real impl calls a multimodal model. */
  caption(url: string, mediaType: 'image' | 'video' | 'audio'): Promise<string>;
}

// Reuses EmbedClient from retrieve.ts — ingest and retrieval must embed with the
// same model, or similarity scores are meaningless.
export type { EmbedClient } from './retrieve.js';
import type { EmbedClient } from './retrieve.js';

export function makeAssetIngestUrl(deps: CaptionClient & EmbedClient) {
  return defineTool({
    name: 'asset.ingest_url',
    version: 1,

    summary:
      'Add a media asset (photo, video, audio) to the Asset Graph from a URL — a WhatsApp upload, ' +
      'a Drive file, a scraped image. Captions and embeds it so it becomes retrievable by intent. ' +
      'Cheap; a couple seconds.',

    input: AssetIngestUrlInput,
    output: AssetIngestUrlOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false, // re-ingesting the same URL would duplicate the asset

    async handler(input, ctx) {
      const caption = await deps.caption(input.url, input.mediaType);
      const embedding = await deps.embed(caption);

      const asset = await ctx.db.assets.create({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        url: input.url,
        assetRole: input.assetRole,
        mediaType: input.mediaType,
        rightsStatus: input.rightsStatus,
        caption,
        embedding,
        source: input.source ?? 'ingest_url',
      });

      ctx.logger.info('asset ingested', { genomeId: input.genomeId, assetId: asset.id, role: input.assetRole });

      return {
        assetId: asset.id,
        caption,
        why: {
          summary: `Captioned and indexed as "${input.assetRole}": ${caption}`,
          factors: [
            { label: 'role', detail: input.assetRole },
            { label: 'rights', detail: input.rightsStatus },
          ],
          evidence: [{ kind: 'asset' as const, id: asset.id }],
          alternatives: [],
        },
      };
    },
  });
}
