import type { BlobStore, PresignedUpload } from './types.js';

/**
 * In-memory store for development and tests, mirroring `apps/api/src/dev-store.ts`.
 *
 * The sandbox cannot reach Azure (CLAUDE.md), so this is what the tool layer runs
 * against locally. URLs are shaped like the real ones — same host pattern, same
 * expiry semantics — so a handler that works here works there; what it cannot
 * exercise is the SAS signature itself, which needs a real account.
 */
export function createMemoryBlobStore(base = 'https://memory.blob.local'): BlobStore & { keys: string[] } {
  const keys: string[] = [];

  return {
    keys,
    async presignUpload({ key, ttlSec = 900 }): Promise<PresignedUpload> {
      keys.push(key);
      const expiresAt = new Date(Date.now() + ttlSec * 1000);
      const q = `sig=dev&se=${encodeURIComponent(expiresAt.toISOString())}`;
      return {
        uploadUrl: `${base}/${encodeURI(key)}?${q}&sp=c`,
        readUrl: `${base}/${encodeURI(key)}?${q}&sp=r`,
        key,
        expiresAt,
      };
    },
    async readUrl(key, ttlSec = 900) {
      const se = new Date(Date.now() + ttlSec * 1000).toISOString();
      return `${base}/${encodeURI(key)}?sig=dev&se=${encodeURIComponent(se)}&sp=r`;
    },
    async put({ key }) {
      keys.push(key);
      return { url: `${base}/${encodeURI(key)}?sig=dev&sp=r` };
    },
  };
}
