import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { generatePkce, signOAuthState, verifyOAuthState, type OAuthStatePayload } from '@sparksocial/shared';
import { Platform, routeAdapters, type PlatformAdapter } from './adapter.js';
import { createRateLimiter, DEFAULT_BUDGETS, type RateLimiter } from './retry.js';
import { joinScopedToken } from './native/scopedToken.js';

/**
 * `integration.connect` / `.health` / `.scopes.verify` / `.rate_budget` —
 * the per-brand social-account connection flow the PRD names (§ONB-04:
 * "Connect Social Accounts (connected profiles list + OAuth popup)"),
 * previously 0 built (`docs/GAPS.md`). Same PKCE + signed-state flow
 * `packages/agency/src/canva.ts` established for Canva, generalized via
 * `@sparksocial/shared/oauthState` so this package doesn't depend on
 * `agency`.
 *
 * `integration.connect` is deliberately its own tool rather than widening
 * `brand.oauth.connect` to cover these five platforms too: a Canva
 * connection is an asset *source*, a social connection is a publish
 * *destination* — different relationships, even though `brand.oauth.status`
 * / `.disconnect` (read/remove) are generic enough to reuse for both (see
 * `canva.ts`'s own comment on the widened `OAuthProvider` union).
 */

const STATE_TTL_MS = 10 * 60_000;

/* ── Per-platform OAuth config ──────────────────────────────────────────
 * No live developer app for any of these five in this environment — every
 * authorize URL, token endpoint, and response shape below is built from
 * each platform's published OAuth docs at the time of writing, same
 * "unverified against a live account" caveat every native adapter in this
 * package carries. Account-label discovery (a "who am I" call after token
 * exchange) is always best-effort: wrapped so a failure there never blocks
 * the connection itself, only leaves `accountLabel` unset.
 */

export interface SocialTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
  accountLabel?: string;
}

interface ExchangeArgs {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl: typeof fetch;
}

/** Required scopes this codebase requests at connect time, per platform — what `integration.scopes.verify` checks a stored connection against. */
export const REQUIRED_SCOPES: Record<Platform, string[]> = {
  instagram: ['instagram_content_publish', 'pages_show_list', 'pages_read_engagement'],
  tiktok: ['video.publish', 'user.info.basic'],
  linkedin: ['w_member_social', 'openid', 'profile'],
  x: ['tweet.write', 'tweet.read', 'users.read', 'offline.access'],
  youtube_shorts: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
};

function buildAuthorizeUrl(provider: Platform, args: { clientId: string; redirectUri: string; codeChallenge: string; state: string }): string {
  const scope = REQUIRED_SCOPES[provider].join(provider === 'instagram' ? ',' : ' ');
  switch (provider) {
    case 'instagram':
      return `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({
        client_id: args.clientId,
        redirect_uri: args.redirectUri,
        scope,
        response_type: 'code',
        state: args.state,
      })}`;
    case 'tiktok':
      return `https://www.tiktok.com/v2/auth/authorize?${new URLSearchParams({
        client_key: args.clientId,
        redirect_uri: args.redirectUri,
        scope,
        response_type: 'code',
        state: args.state,
        code_challenge: args.codeChallenge,
        code_challenge_method: 'S256',
      })}`;
    case 'linkedin':
      return `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
        response_type: 'code',
        client_id: args.clientId,
        redirect_uri: args.redirectUri,
        state: args.state,
        scope,
      })}`;
    case 'x':
      return `https://x.com/i/oauth2/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: args.clientId,
        redirect_uri: args.redirectUri,
        scope,
        state: args.state,
        code_challenge: args.codeChallenge,
        code_challenge_method: 'S256',
      })}`;
    case 'youtube_shorts':
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: args.clientId,
        redirect_uri: args.redirectUri,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent',
        state: args.state,
      })}`;
  }
}

async function exchangeInstagram(args: ExchangeArgs): Promise<SocialTokenResult> {
  const shortLived = await args.fetchImpl(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      client_secret: args.clientSecret,
      code: args.code,
    })}`,
  );
  if (!shortLived.ok) throw new Error(`Instagram token exchange failed: ${shortLived.status} ${await shortLived.text().catch(() => '')}`);
  const { access_token: shortToken } = (await shortLived.json()) as { access_token?: string };
  if (!shortToken) throw new Error('Instagram token exchange returned no access_token.');

  // Long-lived token exchange — a short-lived (≈1hr) token is useless for a "connected" experience.
  const longLived = await args.fetchImpl(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      fb_exchange_token: shortToken,
    })}`,
  );
  const longBody = longLived.ok ? ((await longLived.json()) as { access_token?: string; expires_in?: number }) : undefined;
  const token = longBody?.access_token ?? shortToken;

  let igUserId = '';
  let accountLabel: string | undefined;
  try {
    const pages = (await (await args.fetchImpl(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`)).json()) as {
      data?: { id: string; name?: string }[];
    };
    const page = pages.data?.[0];
    if (page) {
      const linked = (await (
        await args.fetchImpl(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${token}`)
      ).json()) as { instagram_business_account?: { id?: string } };
      if (linked.instagram_business_account?.id) {
        igUserId = linked.instagram_business_account.id;
        accountLabel = page.name;
      }
    }
  } catch {
    // Best-effort — connection still succeeds without a discovered ig-user-id;
    // publish will then correctly refuse ("missing its account id — reconnect").
  }

  return {
    accessToken: joinScopedToken(igUserId, token),
    ...(longBody?.expires_in ? { expiresAt: new Date(Date.now() + longBody.expires_in * 1000) } : {}),
    ...(accountLabel ? { accountLabel } : {}),
  };
}

async function exchangeTikTok(args: ExchangeArgs): Promise<SocialTokenResult> {
  const res = await args.fetchImpl('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body: new URLSearchParams({
      client_key: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      grant_type: 'authorization_code',
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!body.access_token) throw new Error('TikTok token exchange returned no access_token.');

  let accountLabel: string | undefined;
  try {
    const info = (await (
      await args.fetchImpl('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
        headers: { Authorization: `Bearer ${body.access_token}` },
      })
    ).json()) as { data?: { user?: { display_name?: string } } };
    accountLabel = info.data?.user?.display_name;
  } catch {
    // Best-effort.
  }

  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(body.expires_in ? { expiresAt: new Date(Date.now() + body.expires_in * 1000) } : {}),
    ...(body.scope ? { scopes: body.scope.split(',') } : {}),
    ...(accountLabel ? { accountLabel } : {}),
  };
}

async function exchangeLinkedIn(args: ExchangeArgs): Promise<SocialTokenResult> {
  const res = await args.fetchImpl('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('LinkedIn token exchange returned no access_token.');

  let authorUrn = '';
  let accountLabel: string | undefined;
  try {
    const userinfo = (await (
      await args.fetchImpl('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${body.access_token}` } })
    ).json()) as { sub?: string; name?: string };
    if (userinfo.sub) authorUrn = `urn:li:person:${userinfo.sub}`;
    accountLabel = userinfo.name;
  } catch {
    // Best-effort — connection still succeeds; publish will correctly refuse without an author id.
  }

  return {
    accessToken: joinScopedToken(authorUrn, body.access_token),
    ...(body.expires_in ? { expiresAt: new Date(Date.now() + body.expires_in * 1000) } : {}),
    ...(accountLabel ? { accountLabel } : {}),
  };
}

async function exchangeX(args: ExchangeArgs): Promise<SocialTokenResult> {
  const basic = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString('base64');
  const res = await args.fetchImpl('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      code: args.code,
      grant_type: 'authorization_code',
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`X token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!body.access_token) throw new Error('X token exchange returned no access_token.');

  let accountLabel: string | undefined;
  try {
    const me = (await (
      await args.fetchImpl('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${body.access_token}` } })
    ).json()) as { data?: { username?: string } };
    accountLabel = me.data?.username ? `@${me.data.username}` : undefined;
  } catch {
    // Best-effort.
  }

  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(body.expires_in ? { expiresAt: new Date(Date.now() + body.expires_in * 1000) } : {}),
    ...(body.scope ? { scopes: body.scope.split(' ') } : {}),
    ...(accountLabel ? { accountLabel } : {}),
  };
}

async function exchangeYouTube(args: ExchangeArgs): Promise<SocialTokenResult> {
  const res = await args.fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`YouTube token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!body.access_token) throw new Error('YouTube token exchange returned no access_token.');

  let accountLabel: string | undefined;
  try {
    const channels = (await (
      await args.fetchImpl('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${body.access_token}` },
      })
    ).json()) as { items?: { snippet?: { title?: string } }[] };
    accountLabel = channels.items?.[0]?.snippet?.title;
  } catch {
    // Best-effort.
  }

  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(body.expires_in ? { expiresAt: new Date(Date.now() + body.expires_in * 1000) } : {}),
    ...(body.scope ? { scopes: body.scope.split(' ') } : {}),
    ...(accountLabel ? { accountLabel } : {}),
  };
}

const EXCHANGERS: Record<Platform, (args: ExchangeArgs) => Promise<SocialTokenResult>> = {
  instagram: exchangeInstagram,
  tiktok: exchangeTikTok,
  linkedin: exchangeLinkedIn,
  x: exchangeX,
  youtube_shorts: exchangeYouTube,
};

/** Dispatches to the right platform's token exchange — the callback route's one entry point into this file. */
export function exchangeSocialCode(provider: Platform, args: ExchangeArgs): Promise<SocialTokenResult> {
  return EXCHANGERS[provider](args);
}

export { generatePkce, signOAuthState, verifyOAuthState };
export type { OAuthStatePayload };

/* ── integration.connect ─────────────────────────────────────────────── */

export interface IntegrationConnectDeps {
  /** Only platforms present here can be connected — an unconfigured one is refused with a clear reason, not a broken redirect. */
  clientIds: Partial<Record<Platform, string>>;
  redirectUri: string;
  stateSecret: string;
}

function requireGenome(genomeId: string | undefined): string {
  if (!genomeId) throw new ToolError('INVALID_INPUT', 'A brand must be selected.');
  return genomeId;
}

export function makeIntegrationConnect(deps: IntegrationConnectDeps) {
  return defineTool({
    name: 'integration.connect',
    version: 1,

    summary:
      'Start connecting this brand’s own account for one native publishing platform (Instagram, TikTok, ' +
      'LinkedIn, X, or YouTube) — returns the URL to send the browser to. The connection completes on the ' +
      'platform’s redirect back to the API, not from this call.',

    input: z.object({ genomeId: z.string().min(1), provider: Platform }),
    output: z.object({ authorizeUrl: z.string() }),

    effect: 'read',
    // Same reasoning as `brand.oauth.connect`: a browser-redirect OAuth
    // handshake is inherently a human clicking "Allow" on the platform's
    // own consent screen — SPARK cannot meaningfully initiate this itself.
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    idempotent: true,

    async handler(input, ctx) {
      const clientId = deps.clientIds[input.provider];
      if (!clientId) {
        throw new ToolError('INVALID_INPUT', `${input.provider} isn’t configured for native publishing yet.`, { provider: input.provider });
      }
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
      const authorizeUrl = buildAuthorizeUrl(input.provider, { clientId, redirectUri: deps.redirectUri, codeChallenge, state });
      ctx.logger.info('social oauth connect started', { orgId: ctx.orgId, genomeId: input.genomeId, provider: input.provider });
      return { authorizeUrl };
    },
  });
}

/* ── integration.health ──────────────────────────────────────────────── */

export function makeIntegrationHealth(deps: { adapters: PlatformAdapter[] }) {
  const router = routeAdapters(deps.adapters);

  return defineTool({
    name: 'integration.health',
    version: 1,

    summary:
      'Per publishing platform: whether this brand has actually connected an account, which adapter would ' +
      'serve it (native once connected + configured, the stub otherwise), and remaining posting budget today. ' +
      'Richer than publish.status, which only ever reported routing — this also reports real connection state.',

    input: z.object({}),
    output: z.object({
      platforms: z.array(
        z.object({
          platform: Platform,
          connected: z.boolean(),
          accountLabel: z.string().optional(),
          expiresAt: z.string().optional(),
          supported: z.boolean(),
          via: z.string().nullable(),
        }),
      ),
    }),

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
    idempotent: true,

    async handler(_input, ctx) {
      const genomeId = requireGenome(ctx.genomeId);
      const supported = new Set(router.supported());

      return {
        platforms: await Promise.all(
          Platform.options.map(async (platform) => {
            const conn = await ctx.db.oauthConnections.get(genomeId, ctx.orgId, platform);
            const isSupported = supported.has(platform);
            return {
              platform,
              connected: Boolean(conn),
              ...(conn?.accountLabel ? { accountLabel: conn.accountLabel } : {}),
              ...(conn?.expiresAt ? { expiresAt: conn.expiresAt.toISOString() } : {}),
              supported: isSupported,
              via: isSupported ? router.for(platform).name : null,
            };
          }),
        ),
      };
    },
  });
}

/* ── integration.scopes.verify ───────────────────────────────────────── */

export const integrationScopesVerify = defineTool({
  name: 'integration.scopes.verify',
  version: 1,

  summary:
    'Whether this brand’s stored connection for a platform carries every scope this product requests at ' +
    'connect time. Compares the scopes recorded on the connection (when the platform’s token response ' +
    'reported any) against a static per-platform required list — not a live token-introspection call, since ' +
    'each platform’s introspection endpoint differs enough that faking that confidence would be dishonest.',

  input: z.object({ genomeId: z.string().min(1), provider: Platform }),
  output: z.object({
    provider: Platform,
    requestedScopes: z.array(z.string()),
    granted: z.boolean(),
    checkedAt: z.string(),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const conn = await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, input.provider);
    const required = REQUIRED_SCOPES[input.provider];
    // No stored scopes at all means the platform's token response didn't
    // report any (several don't) — treated as "can't verify, assume granted"
    // rather than a false failure, same honesty trade-off the doc comment
    // above states: this check is only as good as what was recorded.
    const granted = Boolean(conn) && (!conn?.scopes || required.every((s) => conn.scopes!.includes(s)));

    return { provider: input.provider, requestedScopes: required, granted, checkedAt: new Date().toISOString() };
  },
});

/* ── integration.rate_budget ─────────────────────────────────────────── */

export function makeIntegrationRateBudget(deps: { limiter?: RateLimiter }) {
  const limiter = deps.limiter ?? createRateLimiter();

  return defineTool({
    name: 'integration.rate_budget',
    version: 1,

    summary: 'This brand’s remaining posting budget today, per platform — the same throttle publish.now enforces.',

    input: z.object({}),
    output: z.object({ platforms: z.array(z.object({ platform: Platform, remainingToday: z.number(), limit: z.number() })) }),

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
    idempotent: true,

    async handler(_input, ctx) {
      const brandId = ctx.brandId;
      if (!brandId) throw new ToolError('INVALID_INPUT', 'A brand must be selected.');
      const now = new Date();
      return {
        platforms: await Promise.all(
          Platform.options.map(async (platform) => ({
            platform,
            remainingToday: await limiter.remaining(brandId, platform, now),
            limit: DEFAULT_BUDGETS[platform].perWindow,
          })),
        ),
      };
    },
  });
}
