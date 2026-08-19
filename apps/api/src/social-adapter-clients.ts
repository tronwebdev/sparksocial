import {
  createInstagramAdapter,
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

  if (envSet('META_APP_ID') && envSet('META_APP_SECRET')) adapters.push(createInstagramAdapter());
  else warnUnconfigured('instagram', 'META_APP_ID / META_APP_SECRET');

  if (envSet('TIKTOK_CLIENT_KEY') && envSet('TIKTOK_CLIENT_SECRET')) adapters.push(createTikTokAdapter());
  else warnUnconfigured('tiktok', 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET');

  if (envSet('LINKEDIN_CLIENT_ID') && envSet('LINKEDIN_CLIENT_SECRET')) adapters.push(createLinkedInAdapter());
  else warnUnconfigured('linkedin', 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET');

  if (envSet('X_API_KEY') && envSet('X_API_SECRET')) adapters.push(createXAdapter());
  else warnUnconfigured('x', 'X_API_KEY / X_API_SECRET');

  if (envSet('YOUTUBE_CLIENT_ID') && envSet('YOUTUBE_CLIENT_SECRET')) adapters.push(createYouTubeAdapter());
  else warnUnconfigured('youtube_shorts', 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET');

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
  return secrets;
}
