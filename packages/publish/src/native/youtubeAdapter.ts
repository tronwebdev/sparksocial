import { PublishError, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';

/**
 * Native YouTube adapter — YouTube Data API v3's resumable upload for
 * `videos.insert`. Like LinkedIn/X, YouTube requires the actual video
 * bytes, not a URL — this adapter fetches from our own `mediaUrls[0]` and
 * streams it through the platform's two-step resumable-upload protocol.
 *
 * ── "Shorts" isn't a separate endpoint ───────────────────────────────────
 * There is no distinct Shorts API — YouTube classifies a video as a Short
 * automatically from its properties (vertical, ≤ 3 minutes as of the
 * current policy) once uploaded through the ordinary `videos.insert` path
 * used here. Nothing in this adapter forces that classification; it is a
 * property of the source media, not something this code can control.
 *
 * ── The two steps ────────────────────────────────────────────────────────
 * 1. `POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
 *    — declares the upload (title/description/privacy), returns a session
 *    URL in the `Location` response header. No bytes sent yet.
 * 2. `PUT {location}` — the actual video bytes, single request (not chunked
 *    — correct for the short-form video this product generates; the
 *    resumable protocol also supports true chunked/resumable transfer for
 *    larger files, not implemented here, a real simplification flagged the
 *    same way X's single-segment upload is).
 *
 * No live YouTube/Google Cloud project in this environment to verify field
 * names or quota behaviour against — built from the published Data API v3
 * docs at the time of writing.
 */

export interface YouTubeAdapterOptions {
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

function classify(status: number, message: string): PublishError {
  return new PublishError('youtube_shorts', message, status === 429 || status >= 500);
}

/** YouTube video titles are capped at 100 characters — the full text still goes in the description. */
function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0]!.trim();
  return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine || 'New video';
}

export function createYouTubeAdapter(opts: YouTubeAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const name = 'native:youtube';

  return {
    name,
    supports: (platform) => platform === 'youtube_shorts',

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError('youtube_shorts', 'No connected YouTube channel for this brand — connect one in Settings first.', false);
      }
      const sourceUrl = req.mediaUrls[0];
      if (!sourceUrl) {
        throw new PublishError('youtube_shorts', 'YouTube requires a video — this post has no media.', false);
      }

      let sourceRes: Response;
      try {
        sourceRes = await doFetch(sourceUrl);
      } catch (e) {
        throw new PublishError('youtube_shorts', `Could not fetch media to upload: ${e instanceof Error ? e.message : String(e)}`, true);
      }
      if (!sourceRes.ok) throw new PublishError('youtube_shorts', `Could not fetch media to upload (${sourceRes.status}).`, false);
      const bytes = await sourceRes.arrayBuffer();

      let initRes: Response;
      try {
        initRes = await doFetch(INIT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${req.accessToken}`,
            'content-type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': 'video/*',
            'X-Upload-Content-Length': String(bytes.byteLength),
          },
          body: JSON.stringify({
            snippet: { title: deriveTitle(req.text), description: req.text },
            status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
          }),
        });
      } catch (e) {
        throw new PublishError('youtube_shorts', e instanceof Error ? e.message : String(e), true);
      }
      if (!initRes.ok) {
        const detail = await initRes.text().catch(() => '');
        throw classify(initRes.status, `YouTube upload session creation failed (${initRes.status}): ${detail.slice(0, 200)}`);
      }
      const location = initRes.headers.get('location');
      if (!location) {
        throw new PublishError('youtube_shorts', 'YouTube accepted the upload session but returned no Location header.', false);
      }

      let uploadRes: Response;
      try {
        uploadRes = await doFetch(location, {
          method: 'PUT',
          headers: { 'content-type': 'video/*', 'content-length': String(bytes.byteLength) },
          body: bytes,
        });
      } catch (e) {
        throw new PublishError('youtube_shorts', e instanceof Error ? e.message : String(e), true);
      }
      const body = (await uploadRes.json().catch(() => ({}))) as { id?: string };
      if (!uploadRes.ok || !body.id) {
        throw classify(uploadRes.status, `YouTube video upload failed (${uploadRes.status}).`);
      }

      return { platform: 'youtube_shorts', externalId: body.id, url: `https://youtube.com/shorts/${body.id}`, via: name, publishedAt: new Date() };
    },

    async delete(externalId: string, _platform, accessToken?: string): Promise<void> {
      if (!accessToken) throw new PublishError('youtube_shorts', 'No YouTube access token available to authorize the delete.', false);
      let response: Response;
      try {
        response = await doFetch(`${VIDEOS_URL}?id=${encodeURIComponent(externalId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (e) {
        throw new PublishError('youtube_shorts', e instanceof Error ? e.message : String(e), true);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw classify(response.status, `YouTube delete failed (${response.status}): ${detail.slice(0, 200)}`);
      }
    },
  };
}
