import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { createStubAdapter } from '../src/adapter.js';
import { createRateLimiter } from '../src/retry.js';
import {
  makeIntegrationConnect,
  makeIntegrationHealth,
  integrationScopesVerify,
  makeIntegrationRateBudget,
  connectionStatus,
  EXPIRY_WARNING_MS,
} from '../src/integration.js';

type OAuthConnection = { accessToken: string; connectedBy: string; createdAt: Date; updatedAt: Date; scopes?: string[]; accountLabel?: string; expiresAt?: Date };

function fakeDb(connections: Record<string, OAuthConnection> = {}) {
  return {
    oauthConnections: {
      async get(genomeId: string, _orgId: string, provider: string) {
        const conn = connections[`${genomeId}:${provider}`];
        return conn ? { id: 'oauth_1', genomeId, provider, ...conn } : undefined;
      },
    },
  } as unknown as ToolCtx['db'];
}

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: fakeDb(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

describe('integration.connect', () => {
  const tool = makeIntegrationConnect({
    clientIds: { instagram: 'ig_client', x: 'x_client' },
    redirectUri: 'https://api.example/oauth/social/callback',
    stateSecret: 'secret',
  });

  it('declares human_only autonomy — a browser consent screen has no meaning for SPARK to click through', () => {
    expect(tool.autonomy).toBe('human_only');
  });

  it('returns a real authorize URL carrying the client id and a signed state', async () => {
    const out = await tool.handler({ genomeId: 'gen_1', provider: 'instagram' }, ctx());
    expect(out.authorizeUrl).toContain('https://www.facebook.com/');
    expect(out.authorizeUrl).toContain('client_id=ig_client');
    expect(out.authorizeUrl).toMatch(/state=/);
  });

  it('refuses a platform with no configured client id — policy-denial path', async () => {
    await expect(tool.handler({ genomeId: 'gen_1', provider: 'tiktok' }, ctx())).rejects.toThrow(ToolError);
  });
});

describe('integration.health', () => {
  it('reports connected: true with the stored accountLabel for a real connection', async () => {
    const tool = makeIntegrationHealth({ adapters: [createStubAdapter({ supports: ['instagram'] })] });
    const db = fakeDb({ 'gen_1:instagram': { accessToken: 'tok', connectedBy: 'user_1', createdAt: new Date(), updatedAt: new Date(), accountLabel: '@brand' } });
    const out = await tool.handler({}, ctx({ db }));
    const ig = out.platforms.find((p) => p.platform === 'instagram')!;
    expect(ig).toMatchObject({ connected: true, accountLabel: '@brand', supported: true, via: 'aggregator:stub' });
  });

  it('reports connected: false and via: null for a platform with neither a connection nor an adapter', async () => {
    const tool = makeIntegrationHealth({ adapters: [createStubAdapter({ supports: ['instagram'] })] });
    const out = await tool.handler({}, ctx());
    const tiktok = out.platforms.find((p) => p.platform === 'tiktok')!;
    expect(tiktok).toMatchObject({ connected: false, supported: false, via: null });
  });

  it('requires a selected genome', async () => {
    const tool = makeIntegrationHealth({ adapters: [createStubAdapter()] });
    await expect(tool.handler({}, ctx({ genomeId: undefined }))).rejects.toThrow(ToolError);
  });
});

describe('connectionStatus — §10 health indicator', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it('reports not_connected before anything else, expiry or no', () => {
    expect(connectionStatus(inHours(-100), false, now)).toBe('not_connected');
  });

  it('reports ok for a connection with no stated expiry', () => {
    // Several providers issue tokens without one. A permanent "we are not sure"
    // badge on a working connection is worse than no badge at all.
    expect(connectionStatus(undefined, true, now)).toBe('ok');
  });

  it('reports expired at the moment of expiry, not a second after', () => {
    expect(connectionStatus(new Date(now), true, now)).toBe('expired');
    expect(connectionStatus(inHours(-1), true, now)).toBe('expired');
  });

  it('reports expiring inside the warning window and ok outside it', () => {
    const window = EXPIRY_WARNING_MS / 3_600_000;
    expect(connectionStatus(inHours(window - 1), true, now)).toBe('expiring');
    expect(connectionStatus(inHours(window + 1), true, now)).toBe('ok');
  });
});

describe('integration.health — §10 alerts', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const conn = (expiresAt?: Date, accountLabel = '@brand') => ({
    accessToken: 'tok',
    connectedBy: 'user_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    accountLabel,
    ...(expiresAt ? { expiresAt } : {}),
  });
  const health = (connections: Record<string, ReturnType<typeof conn>>) =>
    makeIntegrationHealth({ adapters: [createStubAdapter({ supports: ['instagram'] })], now: () => now }).handler(
      {},
      ctx({ db: fakeDb(connections) }),
    );

  it('reports the status, not just the boolean, for an expired token', async () => {
    // The bug this closes: a token that expired last Tuesday used to render
    // identically to a healthy one, because both were `connected: true`.
    const out = await health({ 'gen_1:instagram': conn(new Date('2026-08-13T12:00:00Z')) });
    const ig = out.platforms.find((p) => p.platform === 'instagram')!;
    expect(ig.connected).toBe(true);
    expect(ig.status).toBe('expired');
    expect(ig.hoursUntilExpiry).toBeLessThan(0);
  });

  it('lists an expiring connection under needsAttention with what to do', async () => {
    const out = await health({ 'gen_1:instagram': conn(new Date('2026-08-23T12:00:00Z')) });
    expect(out.needsAttention).toHaveLength(1);
    expect(out.needsAttention[0]!.status).toBe('expiring');
    expect(out.needsAttention[0]!.detail).toMatch(/reconnect/i);
  });

  it('does not treat a platform that was never connected as a problem', async () => {
    // Eleven platforms listed as problems would bury the one that is.
    const out = await health({});
    expect(out.needsAttention).toEqual([]);
    expect(out.platforms.every((p) => p.status === 'not_connected')).toBe(true);
  });

  it('does not flag a healthy connection', async () => {
    const out = await health({ 'gen_1:instagram': conn(new Date('2026-12-01T12:00:00Z')) });
    expect(out.needsAttention).toEqual([]);
    expect(out.platforms.find((p) => p.platform === 'instagram')!.status).toBe('ok');
  });
});

describe('integration.scopes.verify', () => {
  it('reports granted: true when every required scope is present', async () => {
    const db = fakeDb({ 'gen_1:linkedin': { accessToken: 'tok', connectedBy: 'u', createdAt: new Date(), updatedAt: new Date(), scopes: ['w_member_social', 'openid', 'profile'] } });
    const out = await integrationScopesVerify.handler({ genomeId: 'gen_1', provider: 'linkedin' }, ctx({ db }));
    expect(out.granted).toBe(true);
    expect(out.requestedScopes).toContain('w_member_social');
  });

  it('reports granted: false when a required scope is missing', async () => {
    const db = fakeDb({ 'gen_1:linkedin': { accessToken: 'tok', connectedBy: 'u', createdAt: new Date(), updatedAt: new Date(), scopes: ['openid'] } });
    const out = await integrationScopesVerify.handler({ genomeId: 'gen_1', provider: 'linkedin' }, ctx({ db }));
    expect(out.granted).toBe(false);
  });

  it('reports granted: false when there is no connection at all', async () => {
    const out = await integrationScopesVerify.handler({ genomeId: 'gen_1', provider: 'linkedin' }, ctx());
    expect(out.granted).toBe(false);
  });

  it('treats a connection with no recorded scopes as granted — cannot verify, does not falsely fail', async () => {
    const db = fakeDb({ 'gen_1:tiktok': { accessToken: 'tok', connectedBy: 'u', createdAt: new Date(), updatedAt: new Date() } });
    const out = await integrationScopesVerify.handler({ genomeId: 'gen_1', provider: 'tiktok' }, ctx({ db }));
    expect(out.granted).toBe(true);
  });
});

describe('integration.rate_budget', () => {
  it('reflects the shared limiter’s remaining count per platform', async () => {
    const limiter = createRateLimiter();
    const tool = makeIntegrationRateBudget({ limiter });
    const out = await tool.handler({}, ctx());
    const ig = out.platforms.find((p) => p.platform === 'instagram')!;
    expect(ig.remainingToday).toBe(ig.limit);
    expect(ig.limit).toBeGreaterThan(0);
  });

  it('requires a selected brand', async () => {
    const tool = makeIntegrationRateBudget({});
    await expect(tool.handler({}, ctx({ brandId: undefined }))).rejects.toThrow(ToolError);
  });
});
