import { ToolError } from '@sparksocial/shared';
import type { AnalyticsSource, RawPostMetrics } from './source.js';

/**
 * Ayrshare's Analytics API — `POST /api/analytics/post`, Bearer auth, `{id}`
 * being the post id Ayrshare returned at publish time. Same aggregator
 * `packages/publish/src/adapter.ts` names as the P4 default and the same
 * `AYRSHARE_API_KEY` already reserved in `apps/api/.env.example` for it — one
 * key unlocks both once #78's real aggregator adapter lands.
 *
 * ── Why the response is normalized defensively, not parsed strictly ─────────
 * Ayrshare's per-platform analytics payload genuinely differs by platform
 * (Instagram/TikTok/X/LinkedIn/YouTube each name likes/views differently), and
 * there is no live account here to pin the exact shape against. Rather than
 * assert a schema that might silently drop real numbers the first time a
 * field name doesn't match, this probes a short list of the vendor's
 * documented aliases per metric and takes the first present number, keeping
 * `raw` around so nothing is actually lost if the probe misses.
 */

export interface AyrshareAnalyticsOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.ayrshare.com';

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

/** Exported for the client's own tests — no other module has a reason to normalize this shape. */
export function normalizeAyrshareMetrics(body: unknown, platform: string): RawPostMetrics {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const platformBlockRaw = root[platform];
  const block = platformBlockRaw && typeof platformBlockRaw === 'object' ? (platformBlockRaw as Record<string, unknown>) : root;

  return {
    likes: pickNumber(block, ['likeCount', 'likes', 'favoriteCount']),
    comments: pickNumber(block, ['commentsCount', 'commentCount', 'comments']),
    shares: pickNumber(block, ['shareCount', 'shares', 'retweetCount', 'repostCount']),
    views: pickNumber(block, ['videoViewCount', 'viewCount', 'views', 'playCount']),
    impressions: pickNumber(block, ['impressionsCount', 'impressionCount', 'impressions']),
    raw: body,
  };
}

export function createAyrshareAnalyticsClient(opts: AyrshareAnalyticsOptions): AnalyticsSource {
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    async fetchMetrics({ platform, externalId }) {
      const response = await doFetch(`${baseUrl}/api/analytics/post`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id: externalId, platforms: [platform] }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Ayrshare analytics request failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
        });
      }

      const body: unknown = await response.json();
      return normalizeAyrshareMetrics(body, platform);
    },
  };
}
