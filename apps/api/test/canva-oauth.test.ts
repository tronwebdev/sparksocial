import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { signOAuthState } from '@sparksocial/agency';
import { registerCanvaOAuthCallback, type CanvaOAuthCallbackDeps } from '../src/canva-oauth.js';

/**
 * Canva's redirect back — the callback side of `brand.oauth.connect`
 * (packages/agency/src/canva.ts). Unauthenticated by necessity, the same
 * reason the WhatsApp webhook is, so `state`'s signature is what this file
 * is mostly about verifying.
 */

const STATE_SECRET = 'state-secret';
const DEPS_BASE: Omit<CanvaOAuthCallbackDeps, 'db' | 'fetchImpl'> = {
  clientId: 'client1',
  clientSecret: 'secret1',
  redirectUri: 'https://api.example.com/oauth/canva/callback',
  stateSecret: STATE_SECRET,
  webAppUrl: 'https://app.example.com',
};

function harness(over: Partial<CanvaOAuthCallbackDeps> = {}) {
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
  registerCanvaOAuthCallback(app, { ...DEPS_BASE, db: db as never, ...over });
  return { app, saved };
}

function validState(over: Record<string, unknown> = {}) {
  return signOAuthState(
    { orgId: 'org_1', genomeId: 'gen_1', connectedBy: 'user_1', provider: 'canva', codeVerifier: 'verifier1', exp: Date.now() + 60_000, ...over },
    STATE_SECRET,
  );
}

describe('GET /oauth/canva/callback', () => {
  it('redirects to a denied page when Canva reports an error', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/canva/callback?error=access_denied', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?canva=denied');
  });

  it('400s when code or state is missing', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/canva/callback?code=abc');
    expect(res.status).toBe(400);
  });

  it('400s on an unverifiable state (wrong signature)', async () => {
    const { app } = harness();
    const badState = signOAuthState({ orgId: 'org_1', genomeId: 'gen_1', connectedBy: 'user_1', provider: 'canva', codeVerifier: 'v', exp: Date.now() + 60_000 }, 'wrong-secret');
    const res = await app.request(`/oauth/canva/callback?code=abc&state=${encodeURIComponent(badState)}`);
    expect(res.status).toBe(400);
  });

  it('400s on an expired state', async () => {
    const { app } = harness();
    const expired = validState({ exp: Date.now() - 1 });
    const res = await app.request(`/oauth/canva/callback?code=abc&state=${encodeURIComponent(expired)}`);
    expect(res.status).toBe(400);
  });

  it('exchanges the code, saves the connection, and redirects to the connected page', async () => {
    const state = validState();
    const { app, saved } = harness({
      fetchImpl: async (url, init) => {
        expect(url).toBe('https://api.canva.com/rest/v1/oauth/token');
        const body = new URLSearchParams(init.body as string);
        expect(body.get('code')).toBe('code123');
        expect(body.get('code_verifier')).toBe('verifier1');
        expect(body.get('client_id')).toBe('client1');
        return new Response(JSON.stringify({ access_token: 'tok_abc', refresh_token: 'ref_abc', expires_in: 3600 }), { status: 200 });
      },
    });

    const res = await app.request(`/oauth/canva/callback?code=code123&state=${encodeURIComponent(state)}`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?canva=connected');
    expect(saved[0]).toMatchObject({ genomeId: 'gen_1', orgId: 'org_1', provider: 'canva', accessToken: 'tok_abc', refreshToken: 'ref_abc', connectedBy: 'user_1' });
  });

  it('redirects to a failed page when the token exchange throws, without saving anything', async () => {
    const state = validState();
    const { app, saved } = harness({
      fetchImpl: async () => new Response('server error', { status: 500, statusText: 'Internal Server Error' }),
    });

    const res = await app.request(`/oauth/canva/callback?code=code123&state=${encodeURIComponent(state)}`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example.com/settings?canva=failed');
    expect(saved).toEqual([]);
  });
});
