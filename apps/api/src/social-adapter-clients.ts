import {
  createInstagramAdapter,
  createFacebookAdapter,
  createThreadsAdapter,
  createPinterestAdapter,
  createRedditAdapter,
  createGoogleBusinessAdapter,
  createBlueskyAdapter,
  createTikTokAdapter,
  createLinkedInAdapter,
  createXAdapter,
  createYouTubeAdapter,
  type Platform,
  type PlatformAdapter,
} from '@sparksocial/publish';
import { envSet } from './env.js';

/**
 * The five native adapters, each registered only once this operator has set
 * up that platform's own developer app — `envSet` on its client id/secret,
 * same "unset vendor key → not registered" rule as `ayrshareAdapterClient()`.
 *
 * Unlike the aggregator, a native adapter needs no app-level credential to
 * *publish* (that comes from the connecting brand's own OAuth token,
 * resolved per-call — see `PublishRequest.accessToken`'s doc comment). This
 * gate is about registration, not authorization: an unconfigured platform's
 * adapter is left out of the routing table entirely, so `routeAdapters`
 * falls through to the stub for it — the same end-to-end-without-a-vendor-
 * account promise every other integration in this codebase keeps. Once
 * configured, the adapter is always in the table; a specific brand that
 * hasn't connected yet gets a clear per-call refusal from the adapter
 * itself, not silence.
 */
export function socialAdapterClients(): PlatformAdapter[] {
  const adapters: PlatformAdapter[] = [];

  // One Meta app, four platforms. The Instagram adapter serves feed posts and
  // Stories; the Facebook adapter serves the Page and its Groups off the same
  // connection — see `PARENT_PLATFORM`.
  if (envSet('META_APP_ID') && envSet('META_APP_SECRET')) {
    adapters.push(createInstagramAdapter());
    adapters.push(createFacebookAdapter());
  } else warnUnconfigured('instagram', 'META_APP_ID / META_APP_SECRET');

  if (envSet('TIKTOK_CLIENT_KEY') && envSet('TIKTOK_CLIENT_SECRET')) adapters.push(createTikTokAdapter());
  else warnUnconfigured('tiktok', 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET');

  if (envSet('LINKEDIN_CLIENT_ID') && envSet('LINKEDIN_CLIENT_SECRET')) adapters.push(createLinkedInAdapter());
  else warnUnconfigured('linkedin', 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET');

  if (envSet('X_API_KEY') && envSet('X_API_SECRET')) adapters.push(createXAdapter());
  else warnUnconfigured('x', 'X_API_KEY / X_API_SECRET');

  if (envSet('YOUTUBE_CLIENT_ID') && envSet('YOUTUBE_CLIENT_SECRET')) adapters.push(createYouTubeAdapter());
  else warnUnconfigured('youtube_shorts', 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET');

  if (envSet('THREADS_APP_ID') && envSet('THREADS_APP_SECRET')) adapters.push(createThreadsAdapter());
  else warnUnconfigured('threads', 'THREADS_APP_ID / THREADS_APP_SECRET');

  if (envSet('PINTEREST_APP_ID') && envSet('PINTEREST_APP_SECRET')) adapters.push(createPinterestAdapter());
  else warnUnconfigured('pinterest', 'PINTEREST_APP_ID / PINTEREST_APP_SECRET');

  if (envSet('REDDIT_CLIENT_ID') && envSet('REDDIT_CLIENT_SECRET')) adapters.push(createRedditAdapter());
  else warnUnconfigured('reddit', 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET');

  if (envSet('GOOGLE_BUSINESS_CLIENT_ID') && envSet('GOOGLE_BUSINESS_CLIENT_SECRET')) adapters.push(createGoogleBusinessAdapter());
  else warnUnconfigured('google_business', 'GOOGLE_BUSINESS_CLIENT_ID / GOOGLE_BUSINESS_CLIENT_SECRET');

  /*
   * Bluesky needs no app registration at all — it authenticates with the
   * brand's own handle and app password, so there is nothing for an operator
   * to configure and the adapter is always available. The per-brand
   * credential is what gates it, and `integration.connect_credentials`
   * collects that.
   */
  adapters.push(createBlueskyAdapter());

  return adapters;
}

function warnUnconfigured(platform: Platform, vars: string): void {
  console.warn(`[warn] ${vars} unset — native ${platform} publishing is not registered; falls back to the stub adapter.`);
}

/** Client ids for `integration.connect`'s authorize-URL step — a platform with no id here refuses to connect, per-provider, at call time. */
export function socialClientIds(): Partial<Record<Platform, string>> {
  const ids: Partial<Record<Platform, string>> = {};
  if (envSet('META_APP_ID')) ids.instagram = process.env.META_APP_ID!.trim();
  if (envSet('TIKTOK_CLIENT_KEY')) ids.tiktok = process.env.TIKTOK_CLIENT_KEY!.trim();
  if (envSet('LINKEDIN_CLIENT_ID')) ids.linkedin = process.env.LINKEDIN_CLIENT_ID!.trim();
  if (envSet('X_API_KEY')) ids.x = process.env.X_API_KEY!.trim();
  if (envSet('YOUTUBE_CLIENT_ID')) ids.youtube_shorts = process.env.YOUTUBE_CLIENT_ID!.trim();
  if (envSet('THREADS_APP_ID')) ids.threads = process.env.THREADS_APP_ID!.trim();
  if (envSet('PINTEREST_APP_ID')) ids.pinterest = process.env.PINTEREST_APP_ID!.trim();
  if (envSet('REDDIT_CLIENT_ID')) ids.reddit = process.env.REDDIT_CLIENT_ID!.trim();
  if (envSet('GOOGLE_BUSINESS_CLIENT_ID')) ids.google_business = process.env.GOOGLE_BUSINESS_CLIENT_ID!.trim();
  // No `bluesky`: it has no app-level client id. See `socialAdapterClients`.
  return ids;
}

/** Client secrets for the callback's token-exchange step — kept separate from `socialClientIds` so the connect tool (which only ever needs the id) never has a secret to accidentally leak into a response. */
export function socialClientSecrets(): Partial<Record<Platform, string>> {
  const secrets: Partial<Record<Platform, string>> = {};
  if (envSet('META_APP_SECRET')) secrets.instagram = process.env.META_APP_SECRET!.trim();
  if (envSet('TIKTOK_CLIENT_SECRET')) secrets.tiktok = process.env.TIKTOK_CLIENT_SECRET!.trim();
  if (envSet('LINKEDIN_CLIENT_SECRET')) secrets.linkedin = process.env.LINKEDIN_CLIENT_SECRET!.trim();
  if (envSet('X_API_SECRET')) secrets.x = process.env.X_API_SECRET!.trim();
  if (envSet('YOUTUBE_CLIENT_SECRET')) secrets.youtube_shorts = process.env.YOUTUBE_CLIENT_SECRET!.trim();
  if (envSet('THREADS_APP_SECRET')) secrets.threads = process.env.THREADS_APP_SECRET!.trim();
  if (envSet('PINTEREST_APP_SECRET')) secrets.pinterest = process.env.PINTEREST_APP_SECRET!.trim();
  if (envSet('REDDIT_CLIENT_SECRET')) secrets.reddit = process.env.REDDIT_CLIENT_SECRET!.trim();
  if (envSet('GOOGLE_BUSINESS_CLIENT_SECRET')) secrets.google_business = process.env.GOOGLE_BUSINESS_CLIENT_SECRET!.trim();
  return secrets;
}
