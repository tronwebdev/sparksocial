import type { BlobStore } from '@sparksocial/storage';

/**
 * MEDIA URLS THAT DO NOT GO DEAD.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 *
 * Every generated picture, clip and render is stored as the **presigned URL**
 * it was uploaded with — signature, expiry and all — rather than as the key it
 * points at. `docs/GAPS.md` has called this "generated media stored as
 * expiring vendor URLs" for weeks. What it means in practice: a carousel
 * rendered last month shows six broken images, a draft reviewed a fortnight
 * after it was written has no pictures, and nothing in the product says why.
 * The row is fine. The URL in it stopped working.
 *
 * ── Why this is a response filter and not a schema change ────────────────
 *
 * The correct long-term shape is to store the key and sign at read. That is a
 * migration across `assets`, `content_items.copy`, `renders` and every reader
 * of all three, and it would fix nothing already written — a column full of
 * expired URLs stays a column full of expired URLs.
 *
 * A presigned URL carries its own key in the path. So the key is recoverable
 * from what is already stored, and re-signing on the way out fixes every row
 * ever written, old and new, without touching the database.
 *
 * It sits at the one place every tool result passes through, for the reason
 * the alternative fails: there are a dozen readers and the next one will be
 * written by somebody who does not know this is a problem.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * It only rewrites URLs for **our own bucket**. A fal.ai or HeyGen URL is
 * somebody else's object with somebody else's expiry, and minting a signature
 * for it would produce a URL that is wrong rather than one that is stale.
 * Those are a separate problem — the media should be copied into our bucket at
 * ingest — and this filter would hide it rather than solve it.
 *
 * With `R2_PUBLIC_BASE_URL` set, `signGet` returns a permanent public URL and
 * this quietly becomes a no-op for new writes while still repairing old ones.
 * That is the better end state and this does not depend on it.
 */

/** Cheap pre-check: is there anything here worth walking the body for? */
export function mightHaveMediaUrls(body: unknown, host: string): boolean {
  if (!host) return false;
  // One serialise rather than a recursive scan, because the common case is
  // "no" and `JSON.stringify` is far faster than a typed walk.
  try {
    return JSON.stringify(body)?.includes(host) ?? false;
  } catch {
    return false;
  }
}

/**
 * The object key inside a presigned URL of ours, or undefined.
 *
 * Path-style addressing (`<endpoint>/<bucket>/<key>`), which `r2.ts` forces and
 * explains: a virtual-hosted URL is two labels deep and the wildcard
 * certificate does not match it. So the key is everything after the bucket.
 */
export function keyFromUrl(url: string, host: string, bucket: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== host) return undefined;

  const prefix = `/${bucket}/`;
  if (!parsed.pathname.startsWith(prefix)) return undefined;

  const key = decodeURIComponent(parsed.pathname.slice(prefix.length));
  return key.length > 0 ? key : undefined;
}

/**
 * Walk a tool's output and re-sign every URL that belongs to us.
 *
 * Returns the value unchanged when there is nothing to do, so the common path
 * allocates nothing. Signing is local HMAC — no network — so a response
 * carrying thirty slide URLs costs thirty hashes, not thirty round trips.
 *
 * A failure to re-sign leaves the original in place: a stale URL is worse than
 * a fresh one and far better than a missing field, and this runs on the
 * success path of every call in the product.
 */
export async function refreshMediaUrls<T>(
  value: T,
  deps: { store: BlobStore; host: string; bucket: string; ttlSec?: number },
): Promise<T> {
  const seen = new Map<string, string>();

  const rewrite = async (node: unknown): Promise<unknown> => {
    if (typeof node === 'string') {
      const key = keyFromUrl(node, deps.host, deps.bucket);
      if (!key) return node;
      const cached = seen.get(key);
      if (cached) return cached;
      try {
        const fresh = await deps.store.readUrl(key, deps.ttlSec);
        seen.set(key, fresh);
        return fresh;
      } catch {
        return node;
      }
    }
    if (Array.isArray(node)) return Promise.all(node.map(rewrite));
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = await rewrite(v);
      return out;
    }
    return node;
  };

  return (await rewrite(value)) as T;
}
