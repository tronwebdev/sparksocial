import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';
import { splitScopedToken } from './scopedToken.js';

/**
 * Native Bluesky adapter — AT Protocol `com.atproto.repo.createRecord`.
 *
 * ── The one platform here with no OAuth ───────────────────────────────────
 *
 * Bluesky authenticates with a handle and an **app password** — a scoped
 * credential the user creates in their own Bluesky settings and can revoke
 * without touching their real password. There is no authorize URL to redirect
 * to and no consent screen, which is why `buildAuthorizeUrl` refuses this
 * platform by name and `integration.connect_credentials` exists instead.
 *
 * That difference is not cosmetic. Every other platform here hands us a token we
 * store; Bluesky hands us a credential we must exchange for a session on every
 * publish, because AT Protocol access JWTs last minutes, not hours. So the
 * stored secret is the app password itself and `createSession` runs per post —
 * the opposite of the refresh-token model, and the reason this adapter does not
 * appear in `REFRESHERS`.
 *
 * An app password is stored in `oauth_connections.access_token` as
 * `{handle}:{app-password}` (see `scopedToken.ts`). It is a long-lived secret,
 * which is worth being explicit about: revoking it is done in Bluesky, and
 * disconnecting here only forgets it.
 *
 * ── Facets ────────────────────────────────────────────────────────────────
 *
 * Bluesky does not linkify URLs on its own. A post containing a link renders as
 * plain text unless the record carries a `facets` range pointing at it, indexed
 * in UTF-8 **bytes** rather than characters — an emoji before a link shifts the
 * offsets, which is why this counts bytes rather than using string indices.
 *
 * Built from the published AT Protocol documentation and verified against its
 * record shapes; no live Bluesky account exists in this environment.
 */

export interface BlueskyAdapterOptions {
  /** The PDS to authenticate against. Defaults to Bluesky's own. */
  service?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_SERVICE = 'https://bsky.social';
const PLATFORM: Platform = 'bluesky';
const MAX_GRAPHEMES = 300;

interface SessionResponse {
  accessJwt?: string;
  did?: string;
  error?: string;
  message?: string;
}

/**
 * Byte-indexed link ranges, which is what AT Protocol's `facets` are.
 *
 * `String.prototype.indexOf` counts UTF-16 code units and the protocol counts
 * UTF-8 bytes, so any non-ASCII character before a link — an emoji, an accent,
 * a curly quote — would shift every following offset and highlight the wrong
 * span. Encoding once and searching the bytes avoids the whole class.
 */
export function linkFacets(text: string): unknown[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const facets: unknown[] = [];
  // Trailing punctuation is deliberately excluded: "see https://x.com." should
  // not linkify the full stop.
  const pattern = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

  for (const match of text.matchAll(pattern)) {
    const uri = match[0];
    const prefix = encoder.encode(text.slice(0, match.index));
    const byteStart = prefix.length;
    const byteEnd = byteStart + encoder.encode(uri).length;
    if (byteEnd > bytes.length) continue;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  return facets;
}

export function createBlueskyAdapter(opts: BlueskyAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const service = opts.service ?? DEFAULT_SERVICE;
  const name = 'native:bluesky';

  /** Trades the stored app password for a short-lived session. Runs per publish. */
  async function createSession(identifier: string, password: string): Promise<{ jwt: string; did: string }> {
    let res: Response;
    try {
      res = await doFetch(`${service}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
    } catch (e) {
      throw new PublishError(PLATFORM, e instanceof Error ? e.message : String(e), true);
    }
    const body = (await res.json().catch(() => ({}))) as SessionResponse;
    if (!res.ok || !body.accessJwt || !body.did) {
      // An app password that was revoked in Bluesky fails here, every time, and
      // no retry changes it — the repair is reconnecting with a new one.
      const message = body.message ?? body.error ?? `Bluesky sign-in failed (${res.status}).`;
      throw new PublishError(PLATFORM, message, res.status >= 500);
    }
    return { jwt: body.accessJwt, did: body.did };
  }

  return {
    name,
    supports: (platform) => platform === PLATFORM,

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError(PLATFORM, 'No connected Bluesky account for this brand — connect one in Settings first.', false);
      }
      // `{handle}:{app-password}` — see `scopedToken.ts`.
      const [handle, appPassword] = splitScopedToken(req.accessToken);
      if (!handle) {
        throw new PublishError(PLATFORM, 'This brand’s Bluesky connection is missing its handle — reconnect in Settings.', false);
      }

      const session = await createSession(handle, appPassword);

      /*
       * Bluesky's limit is 300 *graphemes*, not characters or bytes — a flag
       * emoji is one grapheme and four bytes. `Intl.Segmenter` is the only way
       * to count what the platform counts; refusing here beats a rejection whose
       * message is about a limit the author cannot reproduce by eye.
       */
      const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(req.text)].length;
      if (graphemes > MAX_GRAPHEMES) {
        throw new PublishError(
          PLATFORM,
          `Bluesky allows ${MAX_GRAPHEMES} characters and this post is ${graphemes}.`,
          false,
        );
      }

      const facets = linkFacets(req.text);
      let res: Response;
      try {
        res = await doFetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.jwt}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: 'app.bsky.feed.post',
            record: {
              $type: 'app.bsky.feed.post',
              text: req.text,
              createdAt: new Date().toISOString(),
              ...(facets.length ? { facets } : {}),
            },
          }),
        });
      } catch (e) {
        throw new PublishError(PLATFORM, e instanceof Error ? e.message : String(e), true);
      }

      const body = (await res.json().catch(() => ({}))) as { uri?: string; cid?: string; message?: string };
      if (!res.ok || !body.uri) {
        throw new PublishError(PLATFORM, body.message ?? `Bluesky publish failed (${res.status}).`, res.status >= 500);
      }

      /*
       * Media is deliberately not attached yet. A Bluesky image is a blob
       * uploaded through `com.atproto.repo.uploadBlob` first and referenced by
       * its CID — a real upload path, not a URL the platform fetches. Posting the
       * text and quietly dropping the image would be worse than the text-only
       * post this is, so the omission is stated rather than hidden.
       */
      const rkey = body.uri.split('/').pop();
      return {
        platform: PLATFORM,
        externalId: body.uri,
        ...(rkey ? { url: `https://bsky.app/profile/${handle}/post/${rkey}` } : {}),
        via: name,
        publishedAt: new Date(),
      };
    },

    async delete(externalId: string, platform: Platform, accessToken?: string): Promise<void> {
      if (!accessToken) {
        throw new PublishError(platform, 'Cannot delete a Bluesky post without the brand’s connection.', false);
      }
      const [handle, appPassword] = splitScopedToken(accessToken);
      const session = await createSession(handle, appPassword);
      const rkey = externalId.split('/').pop();
      if (!rkey) throw new PublishError(platform, 'That Bluesky post id is not a record uri.', false);

      const res = await doFetch(`${service}/xrpc/com.atproto.repo.deleteRecord`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', rkey }),
      });
      if (!res.ok) {
        throw new PublishError(platform, `Could not delete the Bluesky post (${res.status}).`, res.status >= 500);
      }
    },
  };
}
