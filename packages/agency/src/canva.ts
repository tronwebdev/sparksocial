import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { generatePkce, signOAuthState, verifyOAuthState } from '@sparksocial/shared/oauthState';

// Re-exported for existing callers (`apps/api/src/canva-oauth.ts` and this
// package's own tests) that import these from `@sparksocial/agency` — the
// helpers themselves now live in `@sparksocial/shared/oauthState` so
// `packages/publish`'s native adapters can use the identical flow.
export { generatePkce, signOAuthState, verifyOAuthState };

/**
 * Canva Connect API — the least-certain-but-still-real integration in this
 * codebase (see `runBulkConnectorCanva` in `packages/recipes/src/runners.ts`,
 * whose own comment points back here). Canva designs are per-account, so
 * there is no shared key the way Drive's public-folder listing has one —
 * this is full OAuth 2.0 + PKCE against `https://api.canva.com/rest/v1`.
 *
 * The endpoint path used for token exchange (`/rest/v1/oauth/token`) is
 * built from Canva's published Connect API docs at the time this was
 * written, not verified against a live app — there is no Canva developer
 * app registered in this environment to test against. If it 404s, that is
 * the first thing to check against Canva's current docs.
 *
 * ── The flow ─────────────────────────────────────────────────────────────
 *
 * 1. `brand.oauth.connect` (below) mints a PKCE pair and a signed, expiring
 *    `state` token, then returns the URL to send the browser to. Nothing is
 *    persisted server-side for this step — the `state` token round-trips the
 *    PKCE verifier itself (HMAC-signed, so it cannot be forged or read
 *    without `OAUTH_STATE_SECRET`), the same "the token is the credential"
 *    posture as `whitelabel.link.create`.
 * 2. The browser authenticates with Canva and is redirected back to
 *    `GET /oauth/canva/callback?code=...&state=...` (apps/api/src/canva-oauth.ts,
 *    a raw route parallel to the WhatsApp webhook — Canva is not a Clerk
 *    session, so it cannot go through `POST /v1/tools/:name`).
 * 3. The callback verifies `state`, exchanges `code` for tokens, and saves
 *    them via `ctx.db.oauthConnections` (`scoped.ts`, genome-scoped).
 */

const STATE_TTL_MS = 10 * 60_000;

/**
 * `oauth_connections.provider` values this tool family's read/disconnect
 * pair will accept — Canva plus the five native-publishing platforms
 * (`packages/publish/src/integration.ts` mints connections for the latter
 * five via the same shared PKCE/state helpers this file uses; `agency` does
 * not depend on `publish`, so the union is declared here rather than
 * imported, and must be kept in sync with `packages/publish/src/adapter.ts`'s
 * `Platform` enum). `brand.oauth.connect` itself stays Canva-only — connecting
 * a social platform goes through `integration.connect`, a distinct tool,
 * because the two represent different relationships (an asset *source* vs. a
 * publish *destination*) even though the read/disconnect operations beneath
 * them are identical.
 */
const OAuthProvider = z.enum(['canva', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']);

export function buildCanvaAuthorizeUrl(args: { clientId: string; redirectUri: string; codeChallenge: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    scope: 'design:content:read folder:read',
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    state: args.state,
  });
  return `https://www.canva.com/api/oauth/authorize?${params.toString()}`;
}

export interface CanvaTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/** Injected fetch, same testability contract as every other vendor call in this codebase. */
export async function exchangeCanvaCode(
  args: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string },
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): Promise<CanvaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
    code_verifier: args.codeVerifier,
  });
  const res = await fetchImpl('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Canva token exchange failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }

  let parsed: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error('Canva token exchange returned a response that was not valid JSON.');
  }
  if (!parsed.access_token) throw new Error('Canva token exchange response had no access_token.');

  return {
    accessToken: parsed.access_token,
    ...(parsed.refresh_token ? { refreshToken: parsed.refresh_token } : {}),
    ...(parsed.expires_in ? { expiresAt: new Date(Date.now() + parsed.expires_in * 1000) } : {}),
  };
}

/* ── brand.oauth.connect ─────────────────────────────────────────────── */

export interface CanvaOAuthConnectDeps {
  clientId: string;
  redirectUri: string;
  stateSecret: string;
}

export function makeBrandOAuthConnect(deps: CanvaOAuthConnectDeps) {
  return defineTool({
    name: 'brand.oauth.connect',
    version: 1,

    summary:
      "Start connecting this brand's own third-party account (Canva today) — returns the URL to send the " +
      'browser to. The connection itself completes on Canva’s redirect back to the API, not from this call.',

    input: z.object({ genomeId: z.string().min(1), provider: z.literal('canva') }),
    output: z.object({ authorizeUrl: z.string() }),

    effect: 'read',
    // A browser-redirect OAuth handshake has no meaning for SPARK to initiate
    // on its own — connecting a third-party account is inherently a human
    // clicking "Allow" on Canva's own consent screen.
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    // Minting a fresh URL is side-effect-free; calling twice just gets you
    // two valid (and independent) links.
    idempotent: true,

    async handler(input, ctx) {
      const { codeVerifier, codeChallenge } = generatePkce();
      const state = signOAuthState(
        {
          orgId: ctx.orgId,
          genomeId: input.genomeId,
          connectedBy: ctx.userId ?? 'unknown',
          provider: input.provider,
          codeVerifier,
          exp: Date.now() + STATE_TTL_MS,
        },
        deps.stateSecret,
      );
      const authorizeUrl = buildCanvaAuthorizeUrl({
        clientId: deps.clientId,
        redirectUri: deps.redirectUri,
        codeChallenge,
        state,
      });
      ctx.logger.info('canva oauth connect started', { orgId: ctx.orgId, genomeId: input.genomeId });
      return { authorizeUrl };
    },
  });
}

/* ── brand.oauth.status / brand.oauth.disconnect ───────────────────────── */

export const brandOAuthStatus = defineTool({
  name: 'brand.oauth.status',
  version: 1,
  summary: "Whether this brand has a connected third-party account for the given provider (Canva, or a native publishing platform), and who connected it.",
  input: z.object({ genomeId: z.string().min(1), provider: OAuthProvider }),
  output: z.object({ connected: z.boolean(), connectedBy: z.string().optional(), connectedAt: z.string().optional() }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  async handler(input, ctx) {
    const conn = await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, input.provider);
    if (!conn) return { connected: false };
    return { connected: true, connectedBy: conn.connectedBy, connectedAt: conn.createdAt.toISOString() };
  },
});

export const brandOAuthDisconnect = defineTool({
  name: 'brand.oauth.disconnect',
  version: 1,
  summary:
    'Remove this brand’s connected third-party account for the given provider. Canva: the Bulk Connector’s ' +
    'canva source stops working until reconnected. A publishing platform: publish.now for that platform falls ' +
    'back to whatever adapter (if any) is configured for it — the stub in dev, the aggregator if opted in — ' +
    'until reconnected.',
  input: z.object({ genomeId: z.string().min(1), provider: OAuthProvider }),
  output: z.object({ removed: z.boolean() }),
  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  async handler(input, ctx) {
    await ctx.db.oauthConnections.remove(input.genomeId, ctx.orgId, input.provider);
    ctx.logger.info('oauth disconnected', { orgId: ctx.orgId, genomeId: input.genomeId, provider: input.provider });
    return { removed: true };
  },
});
