import { ToolError } from '@sparksocial/shared/types';

/**
 * Object storage — Azure Blob Storage (CLAUDE.md § Infrastructure, replacing the
 * plan's Cloudflare R2).
 *
 * The interface is deliberately narrow: hand out a time-limited upload URL, and
 * turn a key into a readable one. Bytes never pass through the API container —
 * the client PUTs straight to Blob. That is not just a throughput choice: Blob
 * Storage charges egress (unlike R2, which is why the plan picked it), so every
 * byte that transits the app is billed twice.
 */
export interface PresignedUpload {
  uploadUrl: string;
  readUrl: string;
  key: string;
  expiresAt: Date;
}

export interface BlobStore {
  presignUpload(args: { key: string; contentType: string; ttlSec?: number }): Promise<PresignedUpload>;
  readUrl(key: string, ttlSec?: number): Promise<string>;
  /**
   * Server-side write, for the one class of caller with no bytes to hand a
   * client: a vendor API (ElevenLabs' TTS endpoint) that returns audio bytes
   * directly rather than hosting the result at a URL the way fal.ai and
   * HeyGen do. Every other write in this codebase goes through
   * `presignUpload` deliberately — see this file's own note on why bytes
   * otherwise never transit the API container — so `put` exists only for
   * `apps/api/src/voice-client.ts` and should not become the default path.
   */
  put(args: { key: string; contentType: string; bytes: Uint8Array }): Promise<{ url: string }>;
}

/**
 * `{orgId}/{genomeId}/{yyyy}/{mm}/{uuid}.{ext}`
 *
 * Genome in the path means a cross-tenant leak is visible in a blob listing
 * rather than only in the database, and it makes per-genome lifecycle and legal
 * hold policies expressible. `orgId` leads so an org can be lifted into its own
 * container if an enterprise customer demands physical separation.
 */
export function buildKey(args: {
  orgId: string;
  genomeId: string;
  filename: string;
  uuid: string;
  now?: Date;
}): string {
  const { orgId, genomeId, filename, uuid } = args;
  if (!orgId || !genomeId) {
    throw new ToolError('ISOLATION_VIOLATION', 'A storage key requires both orgId and genomeId.', { orgId, genomeId });
  }

  const now = args.now ?? new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${sanitizeSegment(orgId)}/${sanitizeSegment(genomeId)}/${yyyy}/${mm}/${uuid}${extensionOf(filename)}`;
}

/**
 * Path segments are scrubbed, not trusted. `orgId` comes from a verified Clerk
 * session today, but a segment containing `..` or `/` would let a future caller
 * write outside its own prefix — the one thing the key layout exists to prevent.
 *
 * Dots are stripped rather than kept: an allowlist that preserved them turned
 * `../../org_2` into `....org_2` — harmless, since the separators were gone, but
 * it left `..` sequences in keys and made the guard hard to reason about. Org and
 * genome ids are `org_…` / UUIDs, so no legitimate segment contains a dot.
 */
function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9_-]/g, '');
  if (!cleaned) {
    throw new ToolError('INVALID_INPUT', `Unusable storage path segment: ${JSON.stringify(s)}`);
  }
  return cleaned;
}

/** Lowercased, length-capped, dot-prefixed. Returns '' when there is no usable extension. */
export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(filename.trim());
  return match ? `.${match[1]!.toLowerCase()}` : '';
}
