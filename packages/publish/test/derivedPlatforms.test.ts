import { describe, expect, it } from 'vitest';
import {
  PARENT_PLATFORM,
  connectionPlatform,
  isDerivedPlatform,
  routeAdapters,
  Platform,
  type PublishRequest,
} from '../src/adapter.js';
import { createInstagramAdapter } from '../src/native/instagramAdapter.js';
import { createFacebookAdapter } from '../src/native/facebookAdapter.js';
import { createYouTubeAdapter } from '../src/native/youtubeAdapter.js';

/**
 * DERIVED PLATFORMS — four of the fourteen post through an account another
 * platform connected.
 *
 * Before this, each rendered its own Connect button and every one was a dead
 * end: there is no `instagram_story` developer app to configure, so
 * `integration.connect` refused with "isn't configured for native publishing
 * yet" and the tile stayed grey forever.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const req = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  platform: 'instagram',
  text: 'hello',
  mediaUrls: ['https://cdn.example/a.jpg'],
  idempotencyKey: 'k1',
  accessToken: '17841400000000000:user_token',
  ...over,
});

describe('the parent map', () => {
  it('resolves a derived platform to the account it posts through', () => {
    expect(connectionPlatform('instagram_story')).toBe('instagram');
    expect(connectionPlatform('youtube_long')).toBe('youtube_shorts');
    expect(connectionPlatform('facebook')).toBe('instagram');
    expect(connectionPlatform('facebook_group')).toBe('instagram');
  });

  it('leaves a platform that owns its connection alone', () => {
    for (const p of ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const) {
      expect(connectionPlatform(p)).toBe(p);
      expect(isDerivedPlatform(p)).toBe(false);
    }
  });

  it('never chains — every parent owns its own connection', () => {
    // A chain would let one typo make a cycle, and `connectionPlatform` does
    // not loop. This is the assertion that keeps that safe.
    for (const parent of Object.values(PARENT_PLATFORM)) {
      expect(PARENT_PLATFORM[parent!]).toBeUndefined();
    }
  });

  it('names only platforms that exist', () => {
    for (const [child, parent] of Object.entries(PARENT_PLATFORM)) {
      expect(Platform.options).toContain(child);
      expect(Platform.options).toContain(parent);
    }
  });
});

describe('Instagram Stories publish through the Instagram connection', () => {
  it('sets media_type=STORIES and reports the story platform back', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body) });
      return json({ id: calls.length === 1 ? 'container_1' : 'media_1' });
    }) as unknown as typeof fetch;

    const adapter = createInstagramAdapter({ fetchImpl });
    const receipt = await adapter.publish(req({ platform: 'instagram_story' }));

    expect(calls[0]!.body).toContain('media_type=STORIES');
    expect(receipt.platform).toBe('instagram_story');
    expect(receipt.externalId).toBe('media_1');
  });

  it('does not send a caption on a story — Meta silently drops it', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls.push(String(init.body));
      return json({ id: `id_${calls.length}` });
    }) as unknown as typeof fetch;

    await createInstagramAdapter({ fetchImpl }).publish(req({ platform: 'instagram_story', text: 'vanishing copy' }));
    expect(calls[0]).not.toContain('caption');
  });

  it('still captions an ordinary feed post', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls.push(String(init.body));
      return json({ id: `id_${calls.length}` });
    }) as unknown as typeof fetch;

    await createInstagramAdapter({ fetchImpl }).publish(req({ platform: 'instagram', text: 'kept' }));
    expect(calls[0]).toContain('caption=kept');
  });

  it('refuses a story with no media instead of letting Meta reject an empty container', async () => {
    const fetchImpl = (async () => json({ id: 'x' })) as unknown as typeof fetch;
    await expect(
      createInstagramAdapter({ fetchImpl }).publish(req({ platform: 'instagram_story', mediaUrls: [] })),
    ).rejects.toThrow(/needs an image or a video/);
  });
});

describe('YouTube long-form publishes through the Shorts connection', () => {
  it('reports a /watch URL, not a /shorts one that would 404', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('cdn.example')) return new Response('bytes', { status: 200 });
      if (String(url).includes('/upload/youtube/')) {
        return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } });
      }
      return json({ id: 'vid_1' });
    }) as unknown as typeof fetch;

    const adapter = createYouTubeAdapter({ fetchImpl });
    const receipt = await adapter.publish(
      req({ platform: 'youtube_long', accessToken: 'yt_token', mediaUrls: ['https://cdn.example/v.mp4'] }),
    );

    expect(receipt.platform).toBe('youtube_long');
    expect(receipt.url).toBe('https://youtube.com/watch?v=vid_1');
  });
});

describe('Facebook publishes through the Meta connection', () => {
  const pages = { data: [{ id: 'page_1', access_token: 'page_token' }] };

  it('exchanges the user token for a Page token and posts an image to /photos', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('me/accounts')) return json(pages);
      return json({ post_id: 'page_1_99' });
    }) as unknown as typeof fetch;

    const receipt = await createFacebookAdapter({ fetchImpl }).publish(req({ platform: 'facebook' }));

    expect(seen[0]).toContain('me/accounts');
    expect(seen[1]).toContain('page_1/photos');
    expect(receipt.platform).toBe('facebook');
    expect(receipt.externalId).toBe('page_1_99');
  });

  it('posts text with no media to /feed rather than /photos', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('me/accounts')) return json(pages);
      return json({ id: 'p_1' });
    }) as unknown as typeof fetch;

    await createFacebookAdapter({ fetchImpl }).publish(req({ platform: 'facebook', mediaUrls: [] }));
    expect(seen[1]).toContain('page_1/feed');
  });

  it('refuses a Group post with no group id rather than publishing to the Page', async () => {
    // The one failure worse than not publishing: the right copy to the wrong
    // audience.
    const fetchImpl = (async (url: string) => (String(url).includes('me/accounts') ? json(pages) : json({ id: 'x' }))) as unknown as typeof fetch;
    await expect(
      createFacebookAdapter({ fetchImpl }).publish(req({ platform: 'facebook_group' })),
    ).rejects.toThrow(/needs the group id/);
  });

  it('addresses a Group post to the group, authenticated as the Page', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('me/accounts')) return json(pages);
      return json({ id: 'g_1' });
    }) as unknown as typeof fetch;

    await createFacebookAdapter({ fetchImpl }).publish(req({ platform: 'facebook_group', target: 'group_42' }));
    expect(seen[1]).toContain('group_42/photos');
  });

  it('says to reconnect when the connection administers no Page', async () => {
    const fetchImpl = (async () => json({ data: [] })) as unknown as typeof fetch;
    await expect(createFacebookAdapter({ fetchImpl }).publish(req({ platform: 'facebook' }))).rejects.toThrow(
      /administers no Facebook Page|reconnect Instagram/i,
    );
  });
});

describe('alerts are per connection, not per platform', () => {
  it('one expiring Meta token raises one alert, not four', async () => {
    // Instagram, Stories, Facebook and Groups share a connection. Four warnings
    // about one account is the burial `needsAttention` exists to prevent —
    // `packages/publish/test/integration.test.ts` pins the count; this pins the
    // reason, so a future parent added to the map cannot quietly reintroduce it.
    const derived = Platform.options.filter(isDerivedPlatform);
    expect(derived).toHaveLength(4);
    for (const p of derived) {
      expect(isDerivedPlatform(connectionPlatform(p))).toBe(false);
    }
  });
});

describe('routing', () => {
  it('serves all four derived platforms natively once Meta and Google are configured', () => {
    const fetchImpl = (async () => json({})) as unknown as typeof fetch;
    const router = routeAdapters([
      createInstagramAdapter({ fetchImpl }),
      createFacebookAdapter({ fetchImpl }),
      createYouTubeAdapter({ fetchImpl }),
    ]);
    const supported = router.supported();
    for (const p of ['instagram', 'instagram_story', 'facebook', 'facebook_group', 'youtube_shorts', 'youtube_long'] as const) {
      expect(supported).toContain(p);
    }
  });
});
