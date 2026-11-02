/**
 * Server-side only — imported by the two route handlers and nothing else.
 *
 * Where the web tier's two proxies send a request — the API over Render's
 * private network when it can, its public URL when it cannot.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * `SPARK_API_URL` is `https://api.sparkai.social`, so every tool call left the
 * web service, went back out through the public edge — DNS, TLS, Cloudflare —
 * and came in again to a service in the same Render region. That is a second
 * internet round trip on every click, on top of the one from the browser.
 * Render gives services in one region a private network: plain HTTP to
 * `host:port`, no edge in between. `render.yaml` supplies that address as
 * `SPARK_API_PRIVATE_HOSTPORT` (`fromService … property: hostport`).
 *
 * ── Why the public URL stays ──────────────────────────────────────────────
 *
 * `render.yaml` already records a cross-service `fromService` that resolved to
 * an empty value and took every tool call down. So the private address is an
 * optimisation and never a dependency: absent or empty, everything goes the
 * public way exactly as before; present but refusing connections, the request
 * goes the public way and the private route rests for five minutes rather than
 * paying a failed connect on every call.
 *
 * Only a request that was **never sent** is retried — a refused or unresolvable
 * connection. Anything that may have reached the API is not, because a second
 * attempt at a write is a second write.
 */

const PUBLIC_BASE = process.env.SPARK_API_URL || 'http://localhost:8080';
const PRIVATE_HOSTPORT = (process.env.SPARK_API_PRIVATE_HOSTPORT ?? '').trim();
const PRIVATE_BASE = PRIVATE_HOSTPORT ? `http://${PRIVATE_HOSTPORT}` : '';

/** How long to stop trying the private route after it refused a connection. */
const PRIVATE_REST_MS = 5 * 60_000;
let privateRestUntil = 0;

/** Connection failures that mean no byte of the request reached the API. */
const NEVER_SENT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function neverSent(e: unknown): boolean {
  const cause = (e as { cause?: { code?: string } } | undefined)?.cause;
  return typeof cause?.code === 'string' && NEVER_SENT.has(cause.code);
}

/** The base URL(s) a failure message should name. */
export function upstreamDescription(): string {
  return PRIVATE_BASE ? `${PRIVATE_BASE} (private) or ${PUBLIC_BASE}` : PUBLIC_BASE;
}

/**
 * `fetch` against the API. `init.body` must be a string, so the fallback can
 * send it again. Rejects only when neither route could be reached.
 */
export async function fetchApi(
  path: string,
  init: RequestInit & { body: string },
): Promise<{ res: Response; via: 'private' | 'public' }> {
  if (PRIVATE_BASE && Date.now() >= privateRestUntil) {
    try {
      return { res: await fetch(`${PRIVATE_BASE}${path}`, init), via: 'private' };
    } catch (e) {
      if (!neverSent(e)) throw e;
      privateRestUntil = Date.now() + PRIVATE_REST_MS;
      console.warn('[api upstream] private route refused — using the public URL for five minutes', {
        private: PRIVATE_BASE,
        code: (e as { cause?: { code?: string } }).cause?.code,
      });
    }
  }
  return { res: await fetch(`${PUBLIC_BASE}${path}`, init), via: 'public' };
}
