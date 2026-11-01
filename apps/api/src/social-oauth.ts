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

/*
 * ── Where the browser lands afterwards ──────────────────────────────────
 *
 * `/settings/accounts`, not `/settings`: `AccountsSection` reads `?social=`
 * (and `provider`, and `reason` on a failure) and turns it into a
 * notification naming the account. When the page is onboarding's consent
 * popup it hands the result to the window that opened it and closes — see
 * `apps/web/src/lib/oauthPopup.ts`.
 */
export function registerSocialOAuthCallback(app: Hono, deps: SocialOAuthCallbackDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;

  /*
   * Every outcome goes back to the app, with the platform and a reason.
   *
   * A missing or expired state used to answer with a bare 400 on the API's own
   * domain — "Missing code or state." on a white page, with no way back into
   * the product — and every failure arrived as the same `?social=failed`, so
   * the screen could only say "it failed". The reasons are for the screen to
   * word; the detail stays in the log.
   */
  const back = (params: Record<string, string>): string =>
    `${deps.webAppUrl}/settings/accounts?${new URLSearchParams(params).toString()}`;

  app.get('/oauth/social/callback', async (c) => {
    const stateToken = c.req.query('state');
    const state = stateToken ? verifyOAuthState(stateToken, deps.stateSecret) : null;
    const providerParam: Record<string, string> = state ? { provider: state.provider } : {};

    if (c.req.query('error')) {
      return c.redirect(back({ social: 'denied', ...providerParam }), 302);
    }

    const code = c.req.query('code');
    if (!code || !stateToken) {
      return c.redirect(back({ social: 'failed', reason: 'incomplete', ...providerParam }), 302);
    }
    if (!state) {
      return c.redirect(back({ social: 'failed', reason: 'expired' }), 302);
    }

    const provider = state.provider as Platform;
    const clientId = deps.clientIds[provider];
    const clientSecret = deps.clientSecrets[provider];
    if (!clientId || !clientSecret) {
      return c.redirect(back({ social: 'failed', reason: 'not_configured', provider }), 302);
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
      return c.redirect(back({ social: 'failed', reason: 'exchange', provider }), 302);
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
      ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
    });

    return c.redirect(back({ social: 'connected', provider }), 302);
  });
}
