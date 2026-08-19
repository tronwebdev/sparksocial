import type { Hono } from 'hono';
import { verifyOAuthState, exchangeCanvaCode } from '@sparksocial/agency';
import type { ScopedDb } from '@sparksocial/tools/defineTool';

/**
 * Canva's redirect back after the user approves (or denies) the connection —
 * the second half of `brand.oauth.connect` (packages/agency/src/canva.ts,
 * read that file first). A raw route, not a tool: Canva calls this directly
 * on the browser's behalf and carries no Clerk session, the same reason the
 * WhatsApp webhook (`whatsapp-webhook.ts`) is also a raw route rather than
 * going through `POST /v1/tools/:name`.
 *
 * The `state` query param is the only thing authenticating this request —
 * `verifyOAuthState` checks its HMAC signature and expiry before anything in
 * it is trusted (see canva.ts's own comment on why the PKCE verifier and the
 * caller's scope both round-trip through it instead of a server-side table).
 */

export interface CanvaOAuthCallbackDeps {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
  webAppUrl: string;
  db: ScopedDb;
  /** Injected so tests don't hit the real Canva API. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export function registerCanvaOAuthCallback(app: Hono, deps: CanvaOAuthCallbackDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get('/oauth/canva/callback', async (c) => {
    const error = c.req.query('error');
    if (error) {
      return c.redirect(`${deps.webAppUrl}/settings?canva=denied`, 302);
    }

    const code = c.req.query('code');
    const stateToken = c.req.query('state');
    if (!code || !stateToken) {
      return c.text('Missing code or state.', 400);
    }

    const state = verifyOAuthState(stateToken, deps.stateSecret);
    if (!state) {
      return c.text('This connection link has expired or is invalid — start again from Settings.', 400);
    }

    let tokens: Awaited<ReturnType<typeof exchangeCanvaCode>>;
    try {
      tokens = await exchangeCanvaCode(
        { clientId: deps.clientId, clientSecret: deps.clientSecret, redirectUri: deps.redirectUri, code, codeVerifier: state.codeVerifier },
        fetchImpl,
      );
    } catch (e) {
      console.error('[error] canva token exchange failed', { genomeId: state.genomeId, error: e instanceof Error ? e.message : String(e) });
      return c.redirect(`${deps.webAppUrl}/settings?canva=failed`, 302);
    }

    await deps.db.oauthConnections.save({
      genomeId: state.genomeId,
      orgId: state.orgId,
      provider: state.provider,
      accessToken: tokens.accessToken,
      connectedBy: state.connectedBy,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    });

    return c.redirect(`${deps.webAppUrl}/settings?canva=connected`, 302);
  });
}
