import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { AssetMediaType, AssetRole, PublicHttpUrl, ToolError } from '@sparksocial/shared';
import { checkPublicHttpUrl } from '@sparksocial/shared/safeUrl';

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

/**
 * Built inside `makeAssetIngestUrl`, not at module scope, so the one narrow
 * carve-out below can close over `deps.trustedLocalUrlPrefix` — a value only
 * `apps/api`'s composition root ever supplies, never a caller. Everywhere
 * else this is `PublicHttpUrl`, unchanged.
 */
function urlSchema(trustedLocalUrlPrefix?: string) {
  if (!trustedLocalUrlPrefix) return PublicHttpUrl;

  // Local-disk storage (apps/api/src/local-storage-routes.ts) hands back a
  // `readUrl` on this server's own `localhost` — exactly the address
  // `PublicHttpUrl` exists to block, for good reason (CLAUDE.md's Azure IMDS
  // note in safeUrl.ts). The carve-out is narrow on purpose: only a URL
  // matching this exact, server-controlled prefix skips the public-address
  // check; an attacker-supplied URL that happens to start with the same
  // string still cannot make the server fetch anything, because the caption
  // client reads matching URLs off local disk rather than fetching them (see
  // apps/api/src/caption-client.ts) — there is no request for it to redirect.
  return z.string().url().superRefine((value, ctx) => {
    if (value.startsWith(trustedLocalUrlPrefix)) return;
    const result = checkPublicHttpUrl(value);
    if (!result.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason ?? 'Unsafe URL.' });
  });
}

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
  caption(url: string, mediaType: AssetMediaType): Promise<string>;
}

// Reuses EmbedClient from retrieve.ts — ingest and retrieval must embed with the
// same model, or similarity scores are meaningless.
export type { EmbedClient } from './retrieve.js';
import type { EmbedClient } from './retrieve.js';

export interface AssetIngestUrlDeps extends CaptionClient, EmbedClient {
  /**
   * Set only in local development, to the exact origin+prefix
   * `local-storage-routes.ts` serves from (e.g.
   * `http://localhost:8080/v1/local-storage/`). Never a caller-influenced
   * value — see `urlSchema`'s comment for why that's what keeps this safe.
   */
  trustedLocalUrlPrefix?: string;
}

/** See the guard in `asset.ingest_url`'s handler. */
const DOCUMENT_ROLES: AssetRole[] = ['knowledge', 'brand_kit'];

export function makeAssetIngestUrl(deps: AssetIngestUrlDeps) {
  return defineTool({
    name: 'asset.ingest_url',
    version: 1,

    summary:
      'Add an asset (photo, video, audio or PDF) to the Asset Graph from a URL — a WhatsApp upload, ' +
      'a Drive file, a scraped image. Captions and embeds it so it becomes retrievable by intent. ' +
      'Cheap; a couple seconds.',

    input: z.object({
      genomeId: z.string(),
      // Fetched server-side to caption and embed it — must not be able to
      // point at the instance metadata endpoint (packages/shared/src/safeUrl.ts),
      // except this server's own local-disk storage in dev (see urlSchema).
      url: urlSchema(deps.trustedLocalUrlPrefix),
      assetRole: AssetRole,
      mediaType: AssetMediaType,
      /** 'cleared' only when consent/licensing is already confirmed; else 'pending'. */
      rightsStatus: z.enum(['cleared', 'pending', 'restricted']).default('pending'),
      source: z.string().optional(),
      /**
       * The name and size of the owner's own file, carried through from
       * `asset.upload_url`.
       *
       * Both were being validated there and thrown away, so `LIB-02`'s `Assets`
       * column, its grid labels and every size figure on the screen had no
       * source. Optional because an asset can also arrive from a URL nobody
       * uploaded — a generated image, a Drive link — and inventing a filename for
       * one of those would be worse than showing the caption instead.
       */
      filename: z.string().min(1).max(255).optional(),
      sizeBytes: z.number().int().positive().optional(),
    }),
    output: AssetIngestUrlOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false, // re-ingesting the same URL would duplicate the asset
    /**
     * Captioning a video means a real transcription call (AssemblyAI-class,
     * priced per minute) plus an embedding. Recorded as a flat estimate rather
     * than per-minute because the duration is not known until the media has
     * been fetched, and rule 4 has to decide before the handler runs — an
     * approximate charge that is enforceable beats an exact one that is not.
     */
    estimateCents: () => 4,

    async handler(input, ctx) {
      /**
       * A document is not footage.
       *
       * `assemble.plan` asks retrieval for a role and hands whatever comes back
       * to the timeline, which renders anything that isn't audio as a picture
       * (`packages/compose/src/timeline.ts`). A PDF filed as `product_shot`
       * would therefore end up as a beat in a video. The roles a document *is*
       * allowed to take are the two the timeline never asks for, so the
       * exclusion is structural rather than a check the composer has to
       * remember.
       */
      if (input.mediaType === 'document' && !DOCUMENT_ROLES.includes(input.assetRole)) {
        throw new ToolError(
          'INVALID_INPUT',
          `A PDF can be filed as ${DOCUMENT_ROLES.join(' or ')}, not ${input.assetRole} — ` +
            'the other roles are the ones the composer pulls into a render.',
          { assetRole: input.assetRole },
        );
      }

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
        ...(input.filename ? { filename: input.filename } : {}),
        ...(input.sizeBytes ? { sizeBytes: input.sizeBytes } : {}),
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
