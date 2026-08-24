import type { BrandFontFace } from '@sparksocial/shared';

/**
 * FONT BYTES FOR SATORI — M4's other half.
 *
 * Satori cannot use a system font. It is handed buffers, and it renders in
 * whatever it was handed — which is why the brand's chosen face has to arrive
 * here as bytes or the picker does nothing to a still.
 *
 * ── Why the URL is resolved rather than pinned ─────────────────────────────
 *
 * Google serves each family through `fonts.googleapis.com/css2`, which returns a
 * stylesheet whose `src: url(...)` points at a version-stamped file on
 * `fonts.gstatic.com`. Pinning that inner URL would work today and become a
 * silent fallback the next time Google reissues the family — a render that stops
 * carrying the brand's type and says nothing. So the stylesheet is fetched and
 * the URL read out of it.
 *
 * That is two round trips per family, which is why both the stylesheet lookup and
 * the bytes are cached for the life of the process, keyed on family and weight.
 * The cache holds the *promise*, so ten concurrent renders of the same brand make
 * one request rather than ten — the same pattern `remotion-runner.ts` uses for
 * its bundle and `satori-runner.ts` for its bundled face.
 *
 * ── Failure is a fallback, never an error ─────────────────────────────────
 *
 * A font that cannot be fetched must not fail a render. The caller keeps the
 * vendored face it has always used, so the worst outcome of an outage at Google
 * is a still that renders in the default type — which is exactly what every still
 * rendered before this existed.
 *
 * `woff2` is deliberately not requested. Satori's parser reads TTF and OTF;
 * handing it woff2 fails, and the way to get TTF out of the CSS2 API is to ask
 * with a user agent old enough not to be offered woff2. That is the whole reason
 * for the `User-Agent` header below, and it is a real constraint rather than a
 * superstition — without it the endpoint returns woff2 and every face fails to
 * parse.
 */

/** A UA with no woff2 support, so the CSS2 API answers with TTF. */
const TTF_UA = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/25 Safari/537.36';

/** Past this, give up and let the caller fall back. A render must not hang on a font. */
const TIMEOUT_MS = 5_000;

export interface LoadedFont {
  name: string;
  data: Buffer;
  weight: number;
}

const cache = new Map<string, Promise<LoadedFont | undefined>>();

export function loadBrandFonts(faces: readonly BrandFontFace[]): Promise<LoadedFont[]> {
  return Promise.all(faces.map((f) => fetchFace(f))).then((loaded) =>
    loaded.filter((f): f is LoadedFont => Boolean(f)),
  );
}

function fetchFace(face: BrandFontFace): Promise<LoadedFont | undefined> {
  const key = `${face.family}:${face.weight}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = resolve(face).catch(() => {
    /**
     * Dropped from the cache on failure, so a transient outage does not pin a
     * brand to the fallback face for the life of the process. A *successful*
     * fetch stays cached forever, which is the case worth caching.
     */
    cache.delete(key);
    return undefined;
  });
  cache.set(key, pending);
  return pending;
}

async function resolve(face: BrandFontFace): Promise<LoadedFont | undefined> {
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(face.family).replace(/%20/g, '+')}` +
    `:wght@${face.weight}&display=block`;

  const css = await get(cssUrl, { 'User-Agent': TTF_UA });
  if (!css) return undefined;

  const match = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css.toString('utf8'));
  if (!match?.[1]) return undefined;

  const data = await get(match[1], {});
  if (!data) return undefined;

  return { name: face.family, data, weight: face.weight };
}

async function get(url: string, headers: Record<string, string>): Promise<Buffer | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: abort.signal });
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
