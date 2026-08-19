import { ToolError } from '@sparksocial/shared';

/**
 * Dub link attribution (plan §12 P4, PRD line 936): *"Tracked short links +
 * UTM on every posted link. Feeds Engagement Intelligence and pipes
 * click/lead data into ClientForce."*
 *
 * A thin client, same shape as `embed-client.ts`/`voice-client.ts` — one
 * vendor, one HTTP call, no SDK dependency for four fields. `packages/publish`
 * must not depend on `apps/api`, so this takes `apiKey` directly; the
 * env-based factory (`dubClient()`) lives in `apps/api`, same split as every
 * other vendor client this session.
 *
 * ── Tags must exist before `tagNames` can reference them ─────────────────
 *
 * Confirmed directly against the real API: this workspace's `POST /links`
 * rejects EVERY `tagNames` value with a 422 ("Invalid tagNames detected") —
 * not a format issue, since a plain word, a slug, and a uuid all failed
 * identically — until the tag has been created via `POST /tags` first (or
 * exists in the dashboard already). A request with no `tagNames` at all
 * succeeds. So `shorten()` ensures every requested tag exists (search, then
 * create — tolerating a 409 as "already there," since two concurrent calls
 * for a brand-new tag can race) before creating the link, rather than
 * assuming Dub auto-creates tags by name the way some workspaces do.
 */

export interface DubClient {
  shorten(args: { url: string; tags?: string[]; utm?: { source?: string; medium?: string; campaign?: string } }): Promise<{
    linkId: string;
    shortUrl: string;
    destinationUrl: string;
  }>;
  /**
   * `analytics.cta_traffic` — Dub's link object carries its own live click
   * count (confirmed against the real API: `GET /links/{id}` returns `clicks`
   * directly on the link, no separate analytics call needed), so this is a
   * plain read of the same resource `shorten` created.
   */
  getClicks(linkId: string): Promise<{ clicks: number }>;
}

export interface DubClientOptions {
  apiKey: string;
  /** Dub supports multiple custom domains per workspace; unset uses the workspace default. */
  domain?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const BASE_URL = 'https://api.dub.co';

/**
 * Guarantees a tag exists by name — `shorten()`'s precondition for using it
 * in `tagNames`. Checks first rather than create-and-ignore-409 unconditionally,
 * so the common case (an already-seen genome id) costs one GET, not a GET plus
 * a POST that immediately conflicts.
 */
async function ensureTagExists(doFetch: typeof fetch, apiKey: string, name: string): Promise<void> {
  const searchResponse = await doFetch(`${BASE_URL}/tags?search=${encodeURIComponent(name)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (searchResponse.ok) {
    const tags = (await searchResponse.json()) as Array<{ name?: string }>;
    // Dub's `search` is a substring match, not exact — "gen_1" would also
    // return "gen_10" — so the exact-name check happens here, not there.
    if (tags.some((t) => t.name === name)) return;
  }

  const createResponse = await doFetch(`${BASE_URL}/tags`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ name }),
  });
  // 409 means a concurrent call (or a dashboard edit) created the same tag
  // between the search above and this create — the tag exists either way,
  // which is all `shorten()` needs.
  if (createResponse.ok || createResponse.status === 409) return;

  const detail = await createResponse.text().catch(() => '');
  throw new ToolError('UPSTREAM_FAILED', `Could not create Dub tag "${name}" (${createResponse.status}).`, {
    status: createResponse.status,
    detail: detail.slice(0, 200),
  });
}

export function createDubClient(opts: DubClientOptions): DubClient {
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async shorten({ url, tags, utm }) {
      if (tags?.length) {
        await Promise.all(tags.map((name) => ensureTagExists(doFetch, opts.apiKey, name)));
      }

      const response = await doFetch(`${BASE_URL}/links`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          url,
          ...(opts.domain ? { domain: opts.domain } : {}),
          ...(tags?.length ? { tagNames: tags } : {}),
          ...(utm?.source ? { utm_source: utm.source } : {}),
          ...(utm?.medium ? { utm_medium: utm.medium } : {}),
          ...(utm?.campaign ? { utm_campaign: utm.campaign } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Dub request failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
        });
      }

      const body = (await response.json()) as { id?: string; shortLink?: string; url?: string };
      if (!body.shortLink) {
        throw new ToolError('UPSTREAM_FAILED', 'Dub accepted the request but returned no shortLink.', {});
      }
      if (!body.id) {
        throw new ToolError('UPSTREAM_FAILED', 'Dub accepted the request but returned no link id.', {});
      }

      return { linkId: body.id, shortUrl: body.shortLink, destinationUrl: body.url ?? url };
    },

    async getClicks(linkId) {
      const response = await doFetch(`${BASE_URL}/links/${encodeURIComponent(linkId)}`, {
        headers: { authorization: `Bearer ${opts.apiKey}` },
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Dub request failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
        });
      }

      const body = (await response.json()) as { clicks?: number };
      return { clicks: body.clicks ?? 0 };
    },
  };
}
