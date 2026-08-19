import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * PKCE + signed-state helpers for a browser-redirect OAuth 2.0 handshake —
 * extracted from `packages/agency/src/canva.ts` (the Canva Connect flow,
 * still the reference implementation) so `packages/publish`'s native social
 * adapters can use the identical flow without `publish` depending on
 * `agency` or vice versa. Provider-agnostic by construction: the caller's
 * own payload shape carries whatever it needs through the round trip, this
 * module only signs/verifies the envelope.
 *
 * ── The flow ─────────────────────────────────────────────────────────────
 * 1. The connecting tool mints a PKCE pair and a signed, expiring `state`
 *    token, then returns the URL to send the browser to. Nothing is
 *    persisted server-side for this step — `state` round-trips the PKCE
 *    verifier itself (HMAC-signed, so it cannot be forged or read without
 *    the signing secret) — "the token is the credential."
 * 2. The browser authenticates with the provider and is redirected back to
 *    a raw callback route (not a Clerk-session tool call — the provider is
 *    not a Clerk session).
 * 3. The callback verifies `state`, exchanges `code` for tokens, and saves
 *    them via `ctx.db.oauthConnections` (genome-scoped).
 */

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

/** PKCE (RFC 7636), method S256. */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export interface OAuthStatePayload {
  orgId: string;
  genomeId: string;
  connectedBy: string;
  /** Which provider this state belongs to — 'canva', 'instagram', 'x', etc. Not a closed union here on purpose: each caller owns its own provider vocabulary. */
  provider: string;
  codeVerifier: string;
  exp: number;
}

/**
 * Signs the OAuth `state` param so it can carry the PKCE verifier and the
 * caller's scope through the provider's redirect without a server-side
 * pending-connection table. `secret` is a dedicated signing secret
 * (`OAUTH_STATE_SECRET`), not a vendor credential, so rotating a provider's
 * app secret doesn't invalidate in-flight connect attempts.
 */
export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = base64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyOAuthState(token: string, secret: string): OAuthStatePayload | undefined {
  const [body, sig] = token.split('.');
  if (!body || !sig) return undefined;

  const expectedSig = base64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    return undefined;
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return undefined;
  return payload;
}
