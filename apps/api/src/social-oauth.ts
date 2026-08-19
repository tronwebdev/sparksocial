import type { Hono } from 'hono';
import { verifyOAuthState, exchangeSocialCode, type Platform } from '@sparksocial/publish';
import type { ScopedDb } from '@sparksocial/tools/defineTool';

/**
 * The five native platforms' redirect back after the user approves (or
 * denies) the connection — the second half of `integration.connect`
 * (`packages/publish/src/integration.ts`, read that file first). One route
 * for all five, not five routes: `state.provider` (verified, so it cannot
 * be forged) tells this handler which platform's token-exchange function
 * to call. A raw route, not a tool, for the same reason
 * `apps/api/src/canva-oauth.ts` is: the platform calls this directly on
 * the browser's behalf and carries no Clerk session.
 */

export interface SocialOAuthCallbackDeps {
  /** Only platforms with both an id and secret configured can complete an exchange — checked per-request against `state.provider`. */
  clientIds: Partial<Record<Platform, string>>;
  clientSecrets: Partial<Record<Platform, string>>;
  redirectUri: string;
  stateSecret: string;
  webAppUrl: string;
  db: ScopedDb;
  /** Injected so tests don't hit any real platform. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export function registerSocialOAuthCallback(app: Hono, deps: SocialOAuthCallbackDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get('/oauth/social/callback', async (c) => {
    const error = c.req.query('error');
    if (error) {
      return c.redirect(`${deps.webAppUrl}/settings?social=denied`, 302);
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

    const provider = state.provider as Platform;
    const clientId = deps.clientIds[provider];
    const clientSecret = deps.clientSecrets[provider];
    if (!clientId || !clientSecret) {
      return c.redirect(`${deps.webAppUrl}/settings?social=failed`, 302);
    }

    let tokens: Awaited<ReturnType<typeof exchangeSocialCode>>;
    try {
      tokens = await exchangeSocialCode(provider, {
        clientId,
        clientSecret,
        redirectUri: deps.redirectUri,
        code,
        codeVerifier: state.codeVerifier,
        fetchImpl: fetchImpl as typeof fetch,
      });
    } catch (e) {
      console.error('[error] social oauth token exchange failed', {
        genomeId: state.genomeId,
        provider,
        error: e instanceof Error ? e.message : String(e),
      });
      return c.redirect(`${deps.webAppUrl}/settings?social=failed`, 302);
    }

    await deps.db.oauthConnections.save({
      genomeId: state.genomeId,
      orgId: state.orgId,
      provider,
      accessToken: tokens.accessToken,
      connectedBy: state.connectedBy,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      ...(tokens.scopes ? { scopes: tokens.scopes } : {}),
      ...(tokens.accountLabel ? { accountLabel: tokens.accountLabel } : {}),
    });

    return c.redirect(`${deps.webAppUrl}/settings?social=connected&provider=${provider}`, 302);
  });
}
