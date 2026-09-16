import { describe, expect, it } from 'vitest';
import type { ScopedDb } from '@sparksocial/tools/defineTool';
import { runOnce, REFRESH_LEAD_MS, type TokenRefresherDeps } from '../src/token-refresher.js';

/**
 * The token refresher — `apps/api/src/token-refresher.ts`.
 *
 * The behaviours worth pinning are the ones whose absence caused the bug this
 * exists to fix, plus the two ways a naive implementation makes it worse:
 * blanking a refresh token Google deliberately did not resend, and letting one
 * revoked connection abandon the rest of the batch.
 */

const HOUR = 3_600_000;
const NOW = new Date('2026-09-16T12:00:00.000Z');

interface Row {
  id: string;
  genomeId: string;
  orgId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  connectedBy: string;
  scopes?: string[];
  accountLabel?: string;
  accountId?: string;
}

function harness(rows: Row[], over: Partial<TokenRefresherDeps> = {}) {
  const saved: Record<string, unknown>[] = [];
  const asked: string[] = [];

  const db = {
    oauthConnections: {
      async findRefreshable({ before, providers, limit }: { before: Date; providers: string[]; limit: number }) {
        const wanted = new Set(providers);
        return rows
          .filter((r) => r.expiresAt && r.expiresAt <= before && r.refreshToken && wanted.has(r.provider))
          .slice(0, limit);
      },
      async save(args: Record<string, unknown>) {
        saved.push(args);
        return args;
      },
    },
  } as unknown as ScopedDb;

  const fetchImpl = (async (url: string) => {
    asked.push(String(url));
    return new Response(
      JSON.stringify({ access_token: 'fresh_token', expires_in: 3600, scope: 'video.publish' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  const deps: TokenRefresherDeps = {
    db,
    clientIds: { tiktok: 'tt_id', x: 'x_id', youtube_shorts: 'yt_id' },
    clientSecrets: { tiktok: 'tt_secret', x: 'x_secret', youtube_shorts: 'yt_secret' },
    fetchImpl,
    now: () => NOW,
    ...over,
  };
  return { deps, saved, asked };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'oauth_1',
  genomeId: 'gen_1',
  orgId: 'org_1',
  provider: 'x',
  accessToken: 'old_token',
  refreshToken: 'refresh_1',
  expiresAt: new Date(NOW.getTime() + 60_000),
  connectedBy: 'user_1',
  ...over,
});

describe('token refresher', () => {
  it('renews a token that is about to expire and stores the new one', async () => {
    const { deps, saved } = harness([row()]);
    const out = await runOnce(deps);

    expect(out).toEqual({ refreshed: 1, failed: 0 });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      genomeId: 'gen_1',
      orgId: 'org_1',
      provider: 'x',
      accessToken: 'fresh_token',
    });
  });

  it('keeps the existing refresh token when the provider returns none', async () => {
    // Google's behaviour, and the one that turns a working refresh into a
    // one-shot: it reuses the original refresh token and sends no new one.
    const { deps, saved } = harness([row({ provider: 'youtube_shorts' })]);
    await runOnce(deps);
    expect(saved[0]!.refreshToken).toBe('refresh_1');
  });

  it('leaves attribution with the person who authorised the connection', async () => {
    const { deps, saved } = harness([row({ connectedBy: 'user_who_clicked_allow' })]);
    await runOnce(deps);
    expect(saved[0]!.connectedBy).toBe('user_who_clicked_allow');
  });

  it('carries an `{id}:{token}` prefix across rather than stripping it', async () => {
    // Instagram and LinkedIn pack an account id into the stored token. Neither
    // is refreshable today, so this guards the shape, not a live path — writing
    // a bare token over a scoped one breaks publishing at the next post.
    const { deps, saved } = harness([row({ accessToken: 'urn:li:person:abc:old_token' })]);
    await runOnce(deps);
    expect(saved[0]!.accessToken).toBe('urn:li:person:abc:fresh_token');
  });

  it('ignores a connection that is not near expiry', async () => {
    const { deps, saved } = harness([row({ expiresAt: new Date(NOW.getTime() + 5 * HOUR) })]);
    const out = await runOnce(deps);
    expect(out.refreshed).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('ignores a connection with no refresh token', async () => {
    const { deps, saved } = harness([row({ refreshToken: undefined })]);
    expect((await runOnce(deps)).refreshed).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('ignores a platform this build cannot refresh', async () => {
    // Instagram and LinkedIn: no `refresh_token` grant, so selecting them would
    // retry a failure on every tick forever.
    const { deps, saved } = harness([row({ provider: 'instagram' }), row({ provider: 'linkedin' })]);
    expect((await runOnce(deps)).refreshed).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('does nothing at all when no refreshable platform is configured', async () => {
    const { deps, saved } = harness([row()], { clientIds: {}, clientSecrets: {} });
    expect(await runOnce(deps)).toEqual({ refreshed: 0, failed: 0 });
    expect(saved).toHaveLength(0);
  });

  it('one revoked token does not abandon the rest of the batch', async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return new Response('revoked', { status: 400 });
      return new Response(JSON.stringify({ access_token: 'fresh_token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { deps, saved } = harness(
      [row({ id: 'a', genomeId: 'gen_a' }), row({ id: 'b', genomeId: 'gen_b' })],
      { fetchImpl },
    );
    const out = await runOnce(deps);

    expect(out).toEqual({ refreshed: 1, failed: 1 });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.genomeId).toBe('gen_b');
  });

  it('refreshes ahead of expiry by its stated lead, not the seven-day warning window', async () => {
    // The threshold that matters: sharing `EXPIRY_WARNING_MS` would put a
    // one-hour token permanently inside the window and refresh it every tick.
    const justInside = row({ expiresAt: new Date(NOW.getTime() + REFRESH_LEAD_MS - 1000) });
    const justOutside = row({ id: 'b', expiresAt: new Date(NOW.getTime() + REFRESH_LEAD_MS + 60_000) });
    const { deps, saved } = harness([justInside, justOutside]);

    expect((await runOnce(deps)).refreshed).toBe(1);
    expect(saved).toHaveLength(1);
  });
});
