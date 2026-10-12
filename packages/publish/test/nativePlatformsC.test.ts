import { describe, expect, it } from 'vitest';
import { routeAdapters, type PublishRequest } from '../src/adapter.js';
import { createThreadsAdapter } from '../src/native/threadsAdapter.js';
import { createPinterestAdapter, listPinterestBoards } from '../src/native/pinterestAdapter.js';
import { createRedditAdapter } from '../src/native/redditAdapter.js';
import { createGoogleBusinessAdapter } from '../src/native/googleBusinessAdapter.js';
import { createBlueskyAdapter, linkFacets } from '../src/native/blueskyAdapter.js';

/**
 * The five platforms that own their own integration — Threads, Pinterest,
 * Reddit, Google Business and Bluesky.
 *
 * What is pinned here is mostly *refusals*. Each of these has a destination
 * inside the account (a board, a subreddit, a location) and no safe default, and
 * the failure this codebase treats as worst is the right post to the wrong
 * audience. So the tests that matter are the ones proving each refuses rather
 * than guessing.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const req = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  platform: 'threads',
  text: 'hello world',
  mediaUrls: [],
  idempotencyKey: 'k1',
  accessToken: 'tok',
  ...over,
});

describe('Threads', () => {
  it('creates a container then publishes it, and sends media_type=TEXT with no media', async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return json({ id: `id_${bodies.length}` });
    }) as unknown as typeof fetch;

    const receipt = await createThreadsAdapter({ fetchImpl }).publish(req({ accessToken: 'user_1:tok' }));

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('media_type=TEXT');
    expect(bodies[1]).toContain('creation_id=id_1');
    expect(receipt.externalId).toBe('id_2');
  });

  it('refuses when the connection carries no user id', async () => {
    const fetchImpl = (async () => json({ id: 'x' })) as unknown as typeof fetch;
    await expect(createThreadsAdapter({ fetchImpl }).publish(req({ accessToken: 'bare_token' }))).rejects.toThrow(
      /missing its account id/,
    );
  });
});

describe('Pinterest', () => {
  it('refuses a pin with no board rather than choosing one', async () => {
    const fetchImpl = (async () => json({ id: 'p' })) as unknown as typeof fetch;
    await expect(
      createPinterestAdapter({ fetchImpl }).publish(req({ platform: 'pinterest', mediaUrls: ['https://cdn/a.jpg'] })),
    ).rejects.toThrow(/needs a board/);
  });

  it('refuses a pin with no image', async () => {
    const fetchImpl = (async () => json({ id: 'p' })) as unknown as typeof fetch;
    await expect(
      createPinterestAdapter({ fetchImpl }).publish(req({ platform: 'pinterest', target: 'board_1' })),
    ).rejects.toThrow(/needs an image/);
  });

  it('sends the first line as the title and the whole copy as the description', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({ id: 'pin_1' });
    }) as unknown as typeof fetch;

    await createPinterestAdapter({ fetchImpl }).publish(
      req({ platform: 'pinterest', target: 'board_1', mediaUrls: ['https://cdn/a.jpg'], text: 'Headline\nand the rest' }),
    );

    expect(sent.title).toBe('Headline');
    expect(sent.description).toBe('Headline\nand the rest');
    expect(sent.board_id).toBe('board_1');
  });

  it('caps the title at Pinterest’s 100 characters', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({ id: 'pin_1' });
    }) as unknown as typeof fetch;

    await createPinterestAdapter({ fetchImpl }).publish(
      req({ platform: 'pinterest', target: 'b', mediaUrls: ['https://cdn/a.jpg'], text: 'x'.repeat(250) }),
    );
    expect(String(sent.title)).toHaveLength(100);
  });

  it('lists boards for the account picker', async () => {
    const fetchImpl = (async () => json({ items: [{ id: 'b1', name: 'Recipes' }, { id: 'b2' }] })) as unknown as typeof fetch;
    // The second has no name and is dropped rather than rendered as blank.
    expect(await listPinterestBoards('tok', fetchImpl)).toEqual([{ id: 'b1', name: 'Recipes' }]);
  });
});

describe('Reddit', () => {
  it('refuses a post with no subreddit — there is no safe default', async () => {
    const fetchImpl = (async () => json({})) as unknown as typeof fetch;
    await expect(createRedditAdapter({ fetchImpl }).publish(req({ platform: 'reddit' }))).rejects.toThrow(
      /needs a subreddit/,
    );
  });

  it('accepts r/name, /r/name or a bare name', async () => {
    const sent: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return json({ json: { data: { id: 'abc', name: 't3_abc' } } });
    }) as unknown as typeof fetch;

    const adapter = createRedditAdapter({ fetchImpl });
    for (const target of ['r/test', '/r/test', 'test']) {
      await adapter.publish(req({ platform: 'reddit', target }));
    }
    for (const body of sent) expect(body).toContain('sr=test');
  });

  it('posts media as a link and text as a self post', async () => {
    const sent: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return json({ json: { data: { id: 'abc', name: 't3_abc' } } });
    }) as unknown as typeof fetch;

    const adapter = createRedditAdapter({ fetchImpl });
    await adapter.publish(req({ platform: 'reddit', target: 'test' }));
    await adapter.publish(req({ platform: 'reddit', target: 'test', mediaUrls: ['https://cdn/a.jpg'] }));

    expect(sent[0]).toContain('kind=self');
    expect(sent[1]).toContain('kind=link');
  });

  it('reads the errors Reddit returns inside a 200 body', async () => {
    // The failure that would otherwise hand back a receipt for a post that
    // never existed.
    const fetchImpl = (async () =>
      json({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'you aren’t allowed to post there']] } })) as unknown as typeof fetch;

    await expect(
      createRedditAdapter({ fetchImpl }).publish(req({ platform: 'reddit', target: 'test' })),
    ).rejects.toThrow(/aren’t allowed to post there/);
  });

  it('treats RATELIMIT as retryable and a rule rejection as not', async () => {
    const make = (code: string) =>
      (async () => json({ json: { errors: [[code, 'nope']] } })) as unknown as typeof fetch;

    await createRedditAdapter({ fetchImpl: make('RATELIMIT') })
      .publish(req({ platform: 'reddit', target: 't' }))
      .catch((e: { retryable: boolean }) => expect(e.retryable).toBe(true));
    await createRedditAdapter({ fetchImpl: make('NO_TEXT') })
      .publish(req({ platform: 'reddit', target: 't' }))
      .catch((e: { retryable: boolean }) => expect(e.retryable).toBe(false));
  });

  it('sends a User-Agent, which Reddit rejects requests without', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return json({ json: { data: { id: 'a', name: 't3_a' } } });
    }) as unknown as typeof fetch;

    await createRedditAdapter({ fetchImpl }).publish(req({ platform: 'reddit', target: 't' }));
    expect(headers['user-agent']).toMatch(/sparksocial/);
  });
});

describe('Google Business', () => {
  it('refuses a post with no location', async () => {
    const fetchImpl = (async () => json({ name: 'x' })) as unknown as typeof fetch;
    await expect(
      createGoogleBusinessAdapter({ fetchImpl }).publish(req({ platform: 'google_business', accessToken: 'accounts/1:tok' })),
    ).rejects.toThrow(/needs a location/);
  });

  it('refuses when the connection carries no account id', async () => {
    const fetchImpl = (async () => json({ name: 'x' })) as unknown as typeof fetch;
    await expect(
      createGoogleBusinessAdapter({ fetchImpl }).publish(
        req({ platform: 'google_business', accessToken: 'bare', target: 'locations/2' }),
      ),
    ).rejects.toThrow(/missing its account id/);
  });

  it('builds the account/location path and accepts a bare location id', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return json({ name: 'accounts/1/locations/2/localPosts/3' });
    }) as unknown as typeof fetch;

    await createGoogleBusinessAdapter({ fetchImpl }).publish(
      req({ platform: 'google_business', accessToken: 'accounts/1:tok', target: '2' }),
    );
    expect(urls[0]).toContain('/accounts/1/locations/2/localPosts');
  });
});

describe('Bluesky', () => {
  const session = { accessJwt: 'jwt', did: 'did:plc:abc' };

  it('signs in with the stored app password on every publish', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('createSession')) return json(session);
      return json({ uri: 'at://did:plc:abc/app.bsky.feed.post/xyz', cid: 'c' });
    }) as unknown as typeof fetch;

    const receipt = await createBlueskyAdapter({ fetchImpl }).publish(
      req({ platform: 'bluesky', accessToken: 'me.bsky.social:app-pass' }),
    );

    expect(urls[0]).toContain('createSession');
    expect(urls[1]).toContain('createRecord');
    expect(receipt.url).toBe('https://bsky.app/profile/me.bsky.social/post/xyz');
  });

  it('refuses a post over Bluesky’s 300-grapheme limit', async () => {
    const fetchImpl = (async (url: string) =>
      String(url).includes('createSession') ? json(session) : json({ uri: 'at://x/y/z' })) as unknown as typeof fetch;

    await expect(
      createBlueskyAdapter({ fetchImpl }).publish(
        req({ platform: 'bluesky', accessToken: 'me:pw', text: 'a'.repeat(301) }),
      ),
    ).rejects.toThrow(/allows 300 characters/);
  });

  it('counts graphemes, not code units — an emoji is one character', async () => {
    const fetchImpl = (async (url: string) =>
      String(url).includes('createSession') ? json(session) : json({ uri: 'at://x/y/z' })) as unknown as typeof fetch;

    // 300 flag emoji are 300 graphemes but far more UTF-16 code units. A naive
    // `.length` check would refuse this; Bluesky would not.
    const text = '🇬🇧'.repeat(300);
    expect(text.length).toBeGreaterThan(300);
    await expect(
      createBlueskyAdapter({ fetchImpl }).publish(req({ platform: 'bluesky', accessToken: 'me:pw', text })),
    ).resolves.toBeDefined();
  });

  it('says the credential was rejected rather than retrying a revoked app password', async () => {
    const fetchImpl = (async () => json({ message: 'Invalid identifier or password' }, 401)) as unknown as typeof fetch;
    await expect(
      createBlueskyAdapter({ fetchImpl }).publish(req({ platform: 'bluesky', accessToken: 'me:pw' })),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe('link facets are byte-indexed', () => {
  it('finds a plain link', () => {
    expect(linkFacets('see https://example.com now')).toEqual([
      { index: { byteStart: 4, byteEnd: 23 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }] },
    ]);
  });

  it('counts UTF-8 bytes, so an emoji before the link shifts the offset', () => {
    // The whole reason this is not `indexOf`: "🎉" is 4 bytes and 2 UTF-16
    // units, so a code-unit offset would highlight the wrong span.
    const [facet] = linkFacets('🎉 https://example.com') as { index: { byteStart: number } }[];
    expect(facet!.index.byteStart).toBe(5);
  });

  it('does not swallow trailing punctuation', () => {
    const [facet] = linkFacets('go to https://example.com.') as {
      features: { uri: string }[];
    }[];
    expect(facet!.features[0]!.uri).toBe('https://example.com');
  });

  it('returns nothing for text with no link', () => {
    expect(linkFacets('just words')).toEqual([]);
  });
});

describe('routing', () => {
  it('serves all five natively once configured', () => {
    const f = (async () => json({})) as unknown as typeof fetch;
    const supported = routeAdapters([
      createThreadsAdapter({ fetchImpl: f }),
      createPinterestAdapter({ fetchImpl: f }),
      createRedditAdapter({ fetchImpl: f }),
      createGoogleBusinessAdapter({ fetchImpl: f }),
      createBlueskyAdapter({ fetchImpl: f }),
    ]).supported();

    for (const p of ['threads', 'pinterest', 'reddit', 'google_business', 'bluesky'] as const) {
      expect(supported).toContain(p);
    }
  });
});
