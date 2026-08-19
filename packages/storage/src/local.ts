import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ToolError } from '@sparksocial/shared/types';
import type { BlobStore, PresignedUpload } from './types.js';

/**
 * Local-disk object storage — the dev stand-in for Azure Blob Storage before an
 * account is provisioned (CLAUDE.md § Infrastructure targets Azure; this is not
 * a third production option, just something that actually works locally).
 *
 * Unlike `createMemoryBlobStore`, whose URLs are non-resolvable fakes
 * (`https://memory.blob.local/...`, nothing behind them), this one is real
 * end-to-end: bytes land on disk under `dir`, and the URLs it hands back are
 * live routes on this same API process (see `apps/api/src/local-storage-routes.ts`)
 * that actually serve them. A browser can PUT to `uploadUrl` and later render
 * `readUrl` in an `<img>` tag exactly the way it would against real Blob Storage.
 *
 * What this does NOT reproduce: SAS signing/expiry is not enforced (`expiresAt`
 * is reported but nothing checks it), and there is no access control beyond
 * "you're on localhost." Fine for a single developer's machine; the Azure path
 * is unchanged and is what a shared or deployed environment still uses.
 */
export interface LocalDiskBlobStoreOptions {
  /** Directory bytes are written under. Created on first write if missing. */
  dir: string;
  /** Origin this API process is reachable at, e.g. `http://localhost:8080`. */
  publicBaseUrl: string;
}

export interface LocalDiskBlobStore extends BlobStore {
  /** Read a stored object back, for the GET route to serve. */
  read(key: string): Promise<{ bytes: Buffer; contentType: string } | undefined>;
  /** Write bytes for a key, for the PUT route to persist a client's upload. */
  write(key: string, bytes: Buffer, contentType: string): Promise<void>;
}

const ROUTE_PREFIX = '/v1/local-storage';

export function createLocalDiskBlobStore(opts: LocalDiskBlobStoreOptions): LocalDiskBlobStore {
  const root = resolve(opts.dir);

  // `key` is built by `buildKey` (sanitized segments) for every caller that
  // goes through the tool layer, but this also backs an HTTP route that reads
  // the key straight off the request path — so path traversal is checked here
  // too, not assumed away by the caller having been well-behaved upstream.
  function pathFor(key: string): string {
    const target = resolve(root, key);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new ToolError('INVALID_INPUT', `Storage key escapes the local storage root: ${JSON.stringify(key)}`);
    }
    return target;
  }

  function urlFor(key: string): string {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${opts.publicBaseUrl}${ROUTE_PREFIX}/${encoded}`;
  }

  async function write(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    // Sidecar file rather than a manifest DB — this store has no other state
    // to keep consistent, and a second file next to the bytes can't drift
    // from them the way a separate index could.
    await writeFile(`${path}.contenttype`, contentType, 'utf8');
  }

  async function read(key: string): Promise<{ bytes: Buffer; contentType: string } | undefined> {
    const path = pathFor(key);
    try {
      const bytes = await readFile(path);
      const contentType = await readFile(`${path}.contenttype`, 'utf8').catch(() => 'application/octet-stream');
      return { bytes, contentType };
    } catch {
      return undefined;
    }
  }

  return {
    async presignUpload({ key, ttlSec = 900 }): Promise<PresignedUpload> {
      // One URL serves both roles: the local route accepts PUT to write and
      // GET to read at the same path, unlike Blob's separate SAS-signed
      // upload/read permissions.
      const url = urlFor(key);
      return { uploadUrl: url, readUrl: url, key, expiresAt: new Date(Date.now() + ttlSec * 1000) };
    },

    async readUrl(key) {
      return urlFor(key);
    },

    async put({ key, contentType, bytes }) {
      await write(key, Buffer.from(bytes), contentType);
      return { url: urlFor(key) };
    },

    read,
    write,
  };
}

export const LOCAL_STORAGE_ROUTE_PREFIX = ROUTE_PREFIX;
