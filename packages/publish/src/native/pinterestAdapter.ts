import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';

/**
 * Native Pinterest adapter — API v5 `POST /v5/pins`.
 *
 * ── A pin needs a board, and a board is not an account ────────────────────
 *
 * Pinterest is the clearest case for `PublishRequest.target`. Every pin belongs
 * to a board, one account has many, and there is no sensible default: pinning a
 * client's campaign to whichever board happens to come back first is publishing
 * to the wrong place, which this codebase treats as worse than not publishing.
 * So a pin with no `target` is refused by name.
 *
 * `listBoards` is exported for the account picker to offer the real list rather
 * than asking somebody to paste an id.
 *
 * ── Media ─────────────────────────────────────────────────────────────────
 *
 * Pinterest fetches the image itself from a URL, like Instagram and unlike the
 * upload-based adapters. A pin with no image is not a pin — Pinterest rejects
 * it, and this refuses first so the message names the cause.
 *
 * Built from Pinterest's published v5 documentation; no live Pinterest app
 * exists in this environment to verify against, flagged as the other native
 * adapters flag theirs.
 */

export interface PinterestAdapterOptions {
  fetchImpl?: typeof fetch;
}

const API_BASE = 'https://api.pinterest.com/v5';
const PLATFORM: Platform = 'pinterest';

interface PinterestErrorBody {
  message?: string;
  code?: number;
}

export interface PinterestBoard {
  id: string;
  name: string;
}

/** The boards this token can pin to — what the account picker offers. */
export async function listPinterestBoards(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<PinterestBoard[]> {
  const res = await fetchImpl(`${API_BASE}/boards?page_size=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new PublishError(PLATFORM, `Could not read this account’s Pinterest boards (${res.status}).`, res.status >= 500);
  const body = (await res.json().catch(() => ({}))) as { items?: { id?: string; name?: string }[] };
  return (body.items ?? [])
    .filter((b): b is { id: string; name: string } => Boolean(b.id && b.name))
    .map((b) => ({ id: b.id, name: b.name }));
}

export function createPinterestAdapter(opts: PinterestAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const name = 'native:pinterest';

  return {
    name,
    supports: (platform) => platform === PLATFORM,

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError(PLATFORM, 'No connected Pinterest account for this brand — connect one in Settings first.', false);
      }
      if (!req.target) {
        throw new PublishError(
          PLATFORM,
          'A pin needs a board — choose one on the campaign’s accounts, or Pinterest has nowhere to put it.',
          false,
        );
      }
      const media = req.mediaUrls[0];
      if (!media) {
        throw new PublishError(PLATFORM, 'A pin needs an image — Pinterest has no text-only post.', false);
      }

      /*
       * `title` is capped at 100 characters by Pinterest and the copy is often
       * longer, so the first line becomes the title and the whole text the
       * description. Sending the full copy as the title is rejected outright;
       * truncating it silently would publish a sentence cut mid-word.
       */
      const title = (req.text.split('\n')[0] ?? req.text).slice(0, 100);

      let res: Response;
      try {
        res = await doFetch(`${API_BASE}/pins`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${req.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            board_id: req.target,
            title,
            description: req.text,
            media_source: { source_type: 'image_url', url: media },
          }),
        });
      } catch (e) {
        throw new PublishError(PLATFORM, e instanceof Error ? e.message : String(e), true);
      }

      const body = (await res.json().catch(() => ({}))) as PinterestErrorBody & { id?: string };
      if (!res.ok || !body.id) {
        const message = body.message ?? `Pinterest publish failed (${res.status}).`;
        // 429 is Pinterest's rate limit; 5xx is theirs to fix. A rejected board
        // or a bad image URL fails identically on every retry.
        throw new PublishError(PLATFORM, message, res.status === 429 || res.status >= 500);
      }

      return {
        platform: PLATFORM,
        externalId: body.id,
        url: `https://pinterest.com/pin/${body.id}`,
        via: name,
        publishedAt: new Date(),
      };
    },

    async delete(externalId: string, platform: Platform, accessToken?: string): Promise<void> {
      if (!accessToken) {
        throw new PublishError(platform, 'Cannot delete a pin without the brand’s connection.', false);
      }
      const res = await doFetch(`${API_BASE}/pins/${encodeURIComponent(externalId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new PublishError(platform, `Could not delete the pin (${res.status}).`, res.status >= 500);
      }
    },
  };
}
