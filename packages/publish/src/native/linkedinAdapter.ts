import { PublishError, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';
import { splitScopedToken } from './scopedToken.js';

/**
 * Native LinkedIn adapter — the classic UGC Posts + Assets API
 * (`/v2/assets`, `/v2/ugcPosts`). The highest-complexity, least-confident
 * adapter in this file: LinkedIn does not accept a media URL directly the
 * way Instagram/TikTok do, so publishing means three real network round
 * trips, one of which moves the actual media bytes through this process.
 * LinkedIn's newer `/rest/posts` API exists and is the documented future
 * direction, but `/v2/ugcPosts` is the better-documented, longer-established
 * contract to build against without a live developer app to verify either
 * one — flagged the same way as every other native adapter's caveat here,
 * more strongly for this one given the extra moving parts.
 *
 * ── The three steps ──────────────────────────────────────────────────────
 * 1. `POST /v2/assets?action=registerUpload` — declares an upload for the
 *    given `owner` URN (person or organization), returns an `uploadUrl` and
 *    a `urn:li:digitalmediaAsset:...` id.
 * 2. Fetch the media bytes from our own `mediaUrls[0]` and `PUT` them to
 *    that `uploadUrl`, bearer-authorized. The only adapter in this file that
 *    downloads media itself rather than handing the platform a URL.
 * 3. `POST /v2/ugcPosts` — the actual share, referencing the asset urn from
 *    step 1. LinkedIn returns the new post's urn in the `x-restli-id`
 *    response header, not the body.
 *
 * ── Author URN ───────────────────────────────────────────────────────────
 * Same `{id}:{token}` packing `scopedToken.ts` documents for Instagram —
 * `req.accessToken` carries the author's `urn:li:person:...` or
 * `urn:li:organization:...` ahead of the real OAuth token, written by
 * `integration.ts`'s connect flow.
 */

export interface LinkedInAdapterOptions {
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const BASE_URL = 'https://api.linkedin.com/v2';

interface RegisterUploadResponse {
  value?: {
    asset?: string;
    uploadMechanism?: {
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: { uploadUrl?: string };
    };
  };
}

function classify(status: number, message: string): PublishError {
  return new PublishError('linkedin', message, status === 429 || status >= 500);
}

export function createLinkedInAdapter(opts: LinkedInAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const name = 'native:linkedin';

  return {
    name,
    supports: (platform) => platform === 'linkedin',

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError('linkedin', 'No connected LinkedIn account for this brand — connect one in Settings first.', false);
      }
      const [authorUrn, accessToken] = splitScopedToken(req.accessToken);
      if (!authorUrn) {
        throw new PublishError('linkedin', 'This brand’s LinkedIn connection is missing its author id — reconnect in Settings.', false);
      }

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      };

      let mediaUrn: string | undefined;
      let mediaCategory: 'NONE' | 'IMAGE' | 'VIDEO' = 'NONE';

      if (req.mediaUrls[0]) {
        const sourceUrl = req.mediaUrls[0];
        mediaCategory = /\.(mp4|mov)(\?|$)/i.test(sourceUrl) ? 'VIDEO' : 'IMAGE';

        let registerRes: Response;
        try {
          registerRes = await doFetch(`${BASE_URL}/assets?action=registerUpload`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              registerUploadRequest: {
                recipes: [mediaCategory === 'VIDEO' ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image'],
                owner: authorUrn,
                serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
              },
            }),
          });
        } catch (e) {
          throw new PublishError('linkedin', e instanceof Error ? e.message : String(e), true);
        }
        if (!registerRes.ok) {
          const detail = await registerRes.text().catch(() => '');
          throw classify(registerRes.status, `LinkedIn upload registration failed (${registerRes.status}): ${detail.slice(0, 200)}`);
        }
        const registered = (await registerRes.json()) as RegisterUploadResponse;
        const uploadUrl = registered.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
        const asset = registered.value?.asset;
        if (!uploadUrl || !asset) {
          throw new PublishError('linkedin', 'LinkedIn upload registration returned no uploadUrl/asset.', false);
        }

        let sourceRes: Response;
        try {
          sourceRes = await doFetch(sourceUrl);
        } catch (e) {
          throw new PublishError('linkedin', `Could not fetch media to upload: ${e instanceof Error ? e.message : String(e)}`, true);
        }
        if (!sourceRes.ok) {
          throw new PublishError('linkedin', `Could not fetch media to upload (${sourceRes.status}).`, false);
        }
        const bytes = await sourceRes.arrayBuffer();

        let uploadRes: Response;
        try {
          uploadRes = await doFetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}` }, body: bytes });
        } catch (e) {
          throw new PublishError('linkedin', e instanceof Error ? e.message : String(e), true);
        }
        if (!uploadRes.ok) {
          throw classify(uploadRes.status, `LinkedIn media upload failed (${uploadRes.status}).`);
        }

        mediaUrn = asset;
      }

      let postRes: Response;
      try {
        postRes = await doFetch(`${BASE_URL}/ugcPosts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            author: authorUrn,
            lifecycleState: 'PUBLISHED',
            specificContent: {
              'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: req.text },
                shareMediaCategory: mediaCategory,
                ...(mediaUrn ? { media: [{ status: 'READY', media: mediaUrn }] } : {}),
              },
            },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
          }),
        });
      } catch (e) {
        throw new PublishError('linkedin', e instanceof Error ? e.message : String(e), true);
      }

      if (!postRes.ok) {
        const detail = await postRes.text().catch(() => '');
        throw classify(postRes.status, `LinkedIn post failed (${postRes.status}): ${detail.slice(0, 200)}`);
      }

      // LinkedIn returns the new share's urn in a response header, not the body.
      const externalId = postRes.headers.get('x-restli-id');
      if (!externalId) {
        throw new PublishError('linkedin', 'LinkedIn accepted the post but returned no x-restli-id header to identify it.', false);
      }

      return { platform: 'linkedin', externalId, via: name, publishedAt: new Date() };
    },

    async delete(externalId: string, _platform, accessToken?: string): Promise<void> {
      if (!accessToken) {
        throw new PublishError('linkedin', 'No LinkedIn access token available to authorize the delete.', false);
      }
      // externalId is the urn (`urn:li:share:...` / `urn:li:ugcPost:...`)
      // returned as `x-restli-id` at publish time — LinkedIn's DELETE takes
      // it URL-encoded as the path segment.
      let response: Response;
      try {
        response = await doFetch(`${BASE_URL}/ugcPosts/${encodeURIComponent(externalId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
        });
      } catch (e) {
        throw new PublishError('linkedin', e instanceof Error ? e.message : String(e), true);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw classify(response.status, `LinkedIn delete failed (${response.status}): ${detail.slice(0, 200)}`);
      }
    },
  };
}
