import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared/types';
import { buildKey, type BlobStore } from '@sparksocial/storage';

/**
 * `asset.upload_url` — hand the client a short-lived URL to PUT bytes directly to
 * Azure Blob Storage, then call `asset.ingest_url` with the returned `readUrl`.
 *
 * Bytes never transit the API container. Blob Storage charges egress (unlike the
 * plan's original R2, chosen precisely because it does not — see CLAUDE.md), so
 * proxying media through the app would be billed on the way in and again on the
 * way out for no benefit.
 *
 * `asset.ingest_url` is untouched; its own doc comment already anticipated this
 * ("`asset.upload` (direct binary) follows the same shape once Blob Storage is
 * wired; both funnel into the same `ctx.db.assets.create`").
 *
 * KNOWN GAP (P2): the `readUrl` is a time-limited SAS, and `CaptionClient.caption`
 * fetches it. That is fine within the TTL, but re-captioning an asset later — when
 * a better model lands, say — will find the URL dead. P2's asset pipeline should
 * read by key through the managed identity rather than re-using a stored SAS.
 */

const MAX_BYTES = 512 * 1024 * 1024; // 512 MB — a long phone video, not a film

/**
 * Allowlist, not a denylist. The Finish pipeline and the captioner only handle
 * these, and an unbounded content type would let the container become general
 * file hosting for anything a caller cares to name.
 */
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
] as const;

export const AssetUploadUrlInput = z.object({
  genomeId: z.string(),
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
});

export const AssetUploadUrlOutput = z.object({
  uploadUrl: z.string().url(),
  readUrl: z.string().url(),
  key: z.string(),
  expiresAt: z.string(),
});

export function makeAssetUploadUrl(store: BlobStore) {
  return defineTool({
    name: 'asset.upload_url',
    version: 1,

    summary:
      'Get a short-lived URL for uploading a photo, video or audio file straight to storage. ' +
      'Follow it with asset.ingest_url to add the result to the Asset Graph. Free.',

    input: AssetUploadUrlInput,
    output: AssetUploadUrlOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Issuing a second URL for the same file is harmless — nothing is written
    // until the client PUTs, and each call mints a fresh unique key.
    idempotent: true,

    async handler(input, ctx) {
      // Belt and braces over the auth resolver, which has already checked that
      // this genome belongs to the caller's org. A tool that trusted an input
      // `genomeId` over `ctx` would write into another tenant's prefix.
      if (input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
          requested: input.genomeId,
          active: ctx.genomeId,
        });
      }
      if (!ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'No active genome; select a brand first.');
      }

      const key = buildKey({
        orgId: ctx.orgId,
        genomeId: ctx.genomeId,
        filename: input.filename,
        uuid: randomUUID(),
      });

      const presigned = await store.presignUpload({ key, contentType: input.contentType });

      return {
        uploadUrl: presigned.uploadUrl,
        readUrl: presigned.readUrl,
        key: presigned.key,
        expiresAt: presigned.expiresAt.toISOString(),
      };
    },
  });
}
