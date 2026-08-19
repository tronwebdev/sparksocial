import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import {
  generatePkce,
  signOAuthState,
  verifyOAuthState,
  buildCanvaAuthorizeUrl,
  exchangeCanvaCode,
  makeBrandOAuthConnect,
  brandOAuthStatus,
  brandOAuthDisconnect,
} from '../src/canva.js';

function ctx(db: unknown, over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: db as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('generatePkce', () => {
  it('the challenge is the S256 hash of the verifier', () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('produces a different pair every call', () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('signOAuthState / verifyOAuthState', () => {
  const payload = { orgId: 'org_1', genomeId: 'gen_1', connectedBy: 'user_1', provider: 'canva' as const, codeVerifier: 'v', exp: Date.now() + 60_000 };

  it('round-trips a signed payload', () => {
    const token = signOAuthState(payload, 'secret1');
    expect(verifyOAuthState(token, 'secret1')).toEqual(payload);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signOAuthState(payload, 'secret1');
    expect(verifyOAuthState(token, 'secret2')).toBeUndefined();
  });

  it('rejects a tampered payload', () => {
    const token = signOAuthState(payload, 'secret1');
    const [, sig] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ ...payload, orgId: 'org_evil' }), 'utf8').toString('base64url');
    expect(verifyOAuthState(`${tamperedBody}.${sig}`, 'secret1')).toBeUndefined();
  });

  it('rejects an expired token', () => {
    const token = signOAuthState({ ...payload, exp: Date.now() - 1 }, 'secret1');
    expect(verifyOAuthState(token, 'secret1')).toBeUndefined();
  });

  it('rejects a malformed token', () => {
    expect(verifyOAuthState('not-a-real-token', 'secret1')).toBeUndefined();
  });
});

describe('buildCanvaAuthorizeUrl', () => {
  it('includes PKCE and state params', () => {
    const url = buildCanvaAuthorizeUrl({ clientId: 'client1', redirectUri: 'https://api.example.com/oauth/canva/callback', codeChallenge: 'chall', state: 'state1' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://www.canva.com/api/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client1');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://api.example.com/oauth/canva/callback');
    expect(parsed.searchParams.get('code_challenge')).toBe('chall');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state1');
  });
});

describe('exchangeCanvaCode', () => {
  const args = { clientId: 'c1', clientSecret: 's1', redirectUri: 'https://api.example.com/oauth/canva/callback', code: 'code1', codeVerifier: 'v1' };

  it('returns the parsed tokens on success', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ access_token: 'tok_abc', refresh_token: 'ref_abc', expires_in: 3600 }), { status: 200 });
    const result = await exchangeCanvaCode(args, fetchImpl);
    expect(result.accessToken).toBe('tok_abc');
    expect(result.refreshToken).toBe('ref_abc');
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('omits refreshToken/expiresAt when the vendor does not return them', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ access_token: 'tok_abc' }), { status: 200 });
    const result = await exchangeCanvaCode(args, fetchImpl);
    expect(result).toEqual({ accessToken: 'tok_abc' });
  });

  it('throws with the vendor error body on a non-ok response', async () => {
    const fetchImpl = async () => new Response('invalid_grant', { status: 400, statusText: 'Bad Request' });
    await expect(exchangeCanvaCode(args, fetchImpl)).rejects.toThrow(/400/);
  });

  it('throws when the response has no access_token', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ token_type: 'bearer' }), { status: 200 });
    await expect(exchangeCanvaCode(args, fetchImpl)).rejects.toThrow(/no access_token/);
  });

  it('throws on a non-JSON response body', async () => {
    const fetchImpl = async () => new Response('<html>not json</html>', { status: 200 });
    await expect(exchangeCanvaCode(args, fetchImpl)).rejects.toThrow(/not valid JSON/);
  });
});

describe('brand.oauth.connect', () => {
  const tool = makeBrandOAuthConnect({ clientId: 'client1', redirectUri: 'https://api.example.com/oauth/canva/callback', stateSecret: 'secret1' });

  it('mints an authorize URL carrying a verifiable state', async () => {
    const out = await tool.handler({ genomeId: 'gen_1', provider: 'canva' }, ctx({}));
    const parsed = new URL(out.authorizeUrl);
    const state = verifyOAuthState(parsed.searchParams.get('state')!, 'secret1');
    expect(state).toMatchObject({ orgId: 'org_1', genomeId: 'gen_1', connectedBy: 'user_1', provider: 'canva' });
  });

  it('is human_only — SPARK cannot initiate a browser OAuth handshake on its own', () => {
    expect(tool.autonomy).toBe('human_only');
  });
});

describe('brand.oauth.status', () => {
  it('reports disconnected when no connection is saved', async () => {
    const db = { oauthConnections: { get: async () => undefined } };
    const out = await brandOAuthStatus.handler({ genomeId: 'gen_1', provider: 'canva' }, ctx(db));
    expect(out).toEqual({ connected: false });
  });

  it('reports connected with who connected it', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const db = { oauthConnections: { get: async () => ({ id: 'oc_1', genomeId: 'gen_1', provider: 'canva', accessToken: 'tok', connectedBy: 'user_1', createdAt, updatedAt: createdAt }) } };
    const out = await brandOAuthStatus.handler({ genomeId: 'gen_1', provider: 'canva' }, ctx(db));
    expect(out).toEqual({ connected: true, connectedBy: 'user_1', connectedAt: createdAt.toISOString() });
  });
});

describe('brand.oauth.disconnect', () => {
  it('removes the saved connection', async () => {
    const removed: unknown[] = [];
    const db = { oauthConnections: { remove: async (...args: unknown[]) => { removed.push(args); } } };
    const out = await brandOAuthDisconnect.handler({ genomeId: 'gen_1', provider: 'canva' }, ctx(db));
    expect(out).toEqual({ removed: true });
    expect(removed[0]).toEqual(['gen_1', 'org_1', 'canva']);
  });
});
