import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { signOAuthState } from '@sparksocial/publish';
import { registerSocialOAuthCallback, type SocialOAuthCallbackDeps } from '../src/social-oauth.js';

/**
 * The five native platforms' redirect back — the callback side of
 * `integration.connect` (packages/publish/src/integration.ts). One route
 * serving all five, dispatched by `state.provider` — mirrors
 * `canva-oauth.test.ts`'s own structure closely, plus the multi-provider
 * dispatch and the missing-credentials-for-this-provider case Canva (a
 * single provider) doesn't have.
 */

const STATE_SECRET = 'state-secret';
const DEPS_BASE: Omit<SocialOAuthCallbackDeps, 'db' | 'fetchImpl'> = {
  clientIds: { tiktok: 'tt_client', instagram: 'ig_client' },
  clientSecrets: { tiktok: 'tt_secret', instagram: 'ig_secret' },
  redirectUri: 'https://api.example.com/oauth/social/callback',
  stateSecret: STATE_SECRET,
  webAppUrl: 'https://app.example.com',
};

function harness(over: Partial<SocialOAuthCallbackDeps> = {}) {
  const app = new Hono();
  const saved: unknown[] = [];
  const db = {
    oauthConnections: {
      save: async (args: unknown) => {
        saved.push(args);
        return args;
      },
    },
  };
  registerSocialOAuthCallback(app, { ...DEPS_BASE, db: db as never, ...over });
  return { app, saved };
}

function validState(over: Record<string, unknown> = {}) {
  return signOAuthState(
    { orgId: 'org_1', genomeId: 'gen_1', connectedBy: 'user_1', provider: 'tiktok', codeVerifier: 'verifier1', exp: Date.now() + 60_000, ...over },
    STATE_SECRET,
  );
}

describe('GET /oauth/social/callback', () => {
  it('redirects to a denied page when the platform reports an error', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/social/callback?error=access_denied', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?social=denied');
  });

  it('400s when code or state is missing', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/social/callback?code=abc');
    expect(res.status).toBe(400);
  });

  it('400s on an unverifiable state (wrong signature)', async () => {
    const { app } = harness();
    const bad = signOAuthState({ orgId: 'org_1', genomeId: 'gen_1', connectedBy: 'u', provider: 'tiktok', codeVerifier: 'v', exp: Date.now() + 60_000 }, 'wrong-secret');
    const res = await app.request(`/oauth/social/callback?code=abc&state=${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
  });

  it('400s on an expired state', async () => {
    const { app } = harness();
    const expired = validState({ exp: Date.now() - 1 });
    const res = await app.request(`/oauth/social/callback?code=abc&state=${encodeURIComponent(expired)}`);
    expect(res.status).toBe(400);
  });

  it('redirects to a failed page when this provider has no configured client id/secret, without saving anything', async () => {
    const state = validState({ provider: 'linkedin' });
    const { app, saved } = harness();
    const res = await app.request(`/oauth/social/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?social=failed');
    expect(saved).toEqual([]);
  });

  it('exchanges the code, saves the connection with scopes/accountLabel, and redirects to the connected page', async () => {
    const state = validState();
    const { app, saved } = harness({
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.includes('/v2/oauth/token/')) {
          const body = new URLSearchParams(init.body as string);
          expect(body.get('code')).toBe('code123');
          expect(body.get('code_verifier')).toBe('verifier1');
          expect(body.get('client_key')).toBe('tt_client');
          return new Response(JSON.stringify({ access_token: 'tok_abc', refresh_token: 'ref_abc', expires_in: 3600, scope: 'video.publish,user.info.basic' }), { status: 200 });
        }
        // best-effort display-name lookup
        return new Response(JSON.stringify({ data: { user: { display_name: 'Tobi Nation' } } }), { status: 200 });
      },
    });

    const res = await app.request(`/oauth/social/callback?code=code123&state=${encodeURIComponent(state)}`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?social=connected&provider=tiktok');
    expect(saved[0]).toMatchObject({
      genomeId: 'gen_1',
      orgId: 'org_1',
      provider: 'tiktok',
      accessToken: 'tok_abc',
      refreshToken: 'ref_abc',
      connectedBy: 'user_1',
      scopes: ['video.publish', 'user.info.basic'],
      accountLabel: 'Tobi Nation',
    });
  });

  it('redirects to a failed page when the token exchange throws, without saving anything', async () => {
    const state = validState();
    const { app, saved } = harness({
      fetchImpl: async () => new Response('server error', { status: 500, statusText: 'Internal Server Error' }),
    });

    const res = await app.request(`/oauth/social/callback?code=code123&state=${encodeURIComponent(state)}`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?social=failed');
    expect(saved).toEqual([]);
  });
});
