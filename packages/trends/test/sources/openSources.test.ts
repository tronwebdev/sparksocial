import { describe, expect, it } from 'vitest';
import { createBlueskyTrendSource } from '../../src/sources/bluesky.js';
import { createMastodonTrendSource } from '../../src/sources/mastodon.js';
import { createRssTrendSource, parseFeed } from '../../src/sources/rss.js';
import { Trend } from '../../src/trend.js';

/**
 * The three keyless sources added for the PRD's discovery channels: Bluesky
 * and Mastodon (social, open trends) and RSS (news and industry blogs).
 * Fixtures are trimmed copies of what each endpoint returned on 30 Oct 2026.
 */

const json = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const text = (byUrl: Record<string, string | number>) =>
  (async (url: string | URL) => {
    const v = byUrl[String(url)];
    return typeof v === 'number' ? new Response('', { status: v }) : new Response(v ?? '', { status: 200 });
  }) as unknown as typeof fetch;

const NOW = new Date('2026-10-30T15:00:00Z');

describe('bluesky', () => {
  const body = {
    trends: [
      {
        topic: '683bd7ed5568',
        displayName: 'Patrick Stewart sonnets',
        description: 'Fans share videos of a sonnet a day.',
        link: '/profile/did:plc:abc/feed/683bd7ed5568',
        startedAt: '2026-10-30T13:00:00Z',
        postCount: 1200,
        status: 'hot',
        category: 'entertainment',
      },
      { topic: 'old', displayName: 'An old story', startedAt: '2026-10-28T15:00:00Z', postCount: 300 },
      { topic: 'noname', displayName: '' },
    ],
  };

  it('reads trends with a real rate and age, and links each to Bluesky', async () => {
    const out = await createBlueskyTrendSource({ fetchImpl: json(body), now: () => NOW }).fetch({ limit: 10 });
    expect(out).toHaveLength(2);
    const hot = out[0]!;
    expect(Trend.parse(hot)).toBeTruthy();
    expect(hot).toMatchObject({ source: 'bluesky', topic: 'Patrick Stewart sonnets', tags: ['entertainment', 'Fans share videos of a sonnet a day.'] });
    expect(hot.metrics.volume).toBe(1200);
    expect(hot.samples[0]!.url).toBe('https://bsky.app/profile/did:plc:abc/feed/683bd7ed5568');
    // 600 posts an hour, two hours old: climbing, barely saturated.
    expect(hot.metrics.velocity).toBeGreaterThan(0.9);
    expect(hot.metrics.saturation).toBeLessThan(0.1);
    // Two days old at ~6/hour: slow and saturated.
    expect(out[1]!.metrics.velocity).toBeLessThan(0.4);
    expect(out[1]!.metrics.saturation).toBe(1);
  });

  it('narrows by keyword', async () => {
    const out = await createBlueskyTrendSource({ fetchImpl: json(body), now: () => NOW }).fetch({ limit: 10, keywords: ['sonnet'] });
    expect(out.map((t) => t.topic)).toEqual(['Patrick Stewart sonnets']);
  });
});

describe('mastodon', () => {
  const day = (uses: number) => ({ day: '0', uses: String(uses), accounts: String(uses) });
  const body = [
    { name: 'brandnew', url: 'https://mastodon.social/tags/brandnew', history: [day(538), day(0), day(0), day(0), day(1), day(0), day(0)] },
    { name: 'steady', url: 'https://mastodon.social/tags/steady', history: [day(100), day(100), day(100), day(100), day(100), day(100), day(100)] },
  ];

  it('measures growth from the seven days of history', async () => {
    const [fresh, steady] = await createMastodonTrendSource({ fetchImpl: json(body) }).fetch({ limit: 10 });
    expect(fresh).toMatchObject({ source: 'mastodon', topic: '#brandnew', metrics: { volume: 539 } });
    expect(fresh!.metrics.velocity).toBeGreaterThan(0.95);
    expect(fresh!.metrics.growth).toBe(50); // capped: from almost nothing
    expect(steady!.metrics.velocity).toBeCloseTo(1 / 7, 2);
    expect(steady!.metrics.growth).toBe(0);
    expect(Trend.parse(steady)).toBeTruthy();
  });
});

describe('rss', () => {
  const rssA = `<?xml version="1.0"?><rss><channel>
    <item><title>Local cafés turn to short video</title><link>https://trade.example/cafes</link>
      <pubDate>Thu, 30 Oct 2026 12:00:00 GMT</pubDate><category>Hospitality</category>
      <media:content url="https://trade.example/img.jpg&amp;w=600" medium="image"/></item>
    <item><title><![CDATA[Older story &amp; more]]></title><link>https://trade.example/old</link>
      <pubDate>Mon, 27 Oct 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const atomB = `<feed><entry><title>Local cafés turn to short video</title>
    <link href="https://blog.example/cafes"/><updated>2026-10-30T13:00:00Z</updated></entry></feed>`;

  it('reads RSS and Atom, merges the same story across feeds, and ranks by recency', async () => {
    const source = createRssTrendSource({
      feeds: ['https://trade.example/feed', 'https://blog.example/atom', 'https://down.example/feed'],
      fetchImpl: text({ 'https://trade.example/feed': rssA, 'https://blog.example/atom': atomB, 'https://down.example/feed': 503 }),
      now: () => NOW,
    });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]).toMatchObject({
      source: 'rss',
      topic: 'Local cafés turn to short video',
      metrics: { volume: 2 },
      media: { url: 'https://trade.example/img.jpg&w=600', kind: 'image' },
    });
    expect(out[0]!.tags).toEqual(expect.arrayContaining(['trade.example', 'blog.example', 'Hospitality']));
    expect(out[0]!.samples).toHaveLength(2);
    expect(out[1]!.topic).toBe('Older story & more');
    expect(out[1]!.metrics.velocity).toBe(0);
    expect(out.every((t) => Trend.safeParse(t).success)).toBe(true);
  });

  it('fails loudly only when every feed fails', async () => {
    const source = createRssTrendSource({ feeds: ['https://down.example/feed'], fetchImpl: text({ 'https://down.example/feed': 500 }) });
    await expect(source.fetch({ limit: 5 })).rejects.toThrow(/Every RSS feed failed/);
  });

  it('ignores anything that is not an http(s) URL', async () => {
    const source = createRssTrendSource({ feeds: ['file:///etc/passwd', ''], fetchImpl: text({}) });
    expect(await source.fetch({ limit: 5 })).toEqual([]);
  });

  it('parseFeed caps what it reads', () => {
    expect(parseFeed(rssA, 'trade.example', 1)).toHaveLength(1);
  });
});
