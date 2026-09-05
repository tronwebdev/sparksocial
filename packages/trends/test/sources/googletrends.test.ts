import { describe, expect, it, vi } from 'vitest';
import { createGoogleTrendsSource, parseApproxTraffic, parseTrendingRss } from '../../src/sources/googletrends.js';

function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', text: async () => body } as Response;
}

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
  <channel>
    <item>
      <title>eskom load shedding</title>
      <ht:approx_traffic>50,000+</ht:approx_traffic>
      <ht:picture>https://t0.gstatic.com/images?q=one&amp;w=200</ht:picture>
      <ht:news_item_title>Stage 4 announced for the weekend</ht:news_item_title>
      <ht:news_item_url>https://news.example/eskom</ht:news_item_url>
    </item>
    <item>
      <title><![CDATA[small business grants]]></title>
      <ht:approx_traffic>2,000+</ht:approx_traffic>
    </item>
  </channel>
</rss>`;

describe('parseApproxTraffic', () => {
  it('reads Google’s own figure and never guesses one', () => {
    expect(parseApproxTraffic('50,000+')).toBe(50000);
    expect(parseApproxTraffic('1,000+')).toBe(1000);
    // No figure is 0, not a plausible-looking number.
    expect(parseApproxTraffic(undefined)).toBe(0);
    expect(parseApproxTraffic('lots')).toBe(0);
  });
});

describe('parseTrendingRss', () => {
  it('reads title, traffic, picture and news item, decoding entities', () => {
    const items = parseTrendingRss(FEED, 10);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'eskom load shedding',
      traffic: 50000,
      // `&amp;` decoded — an escaped query string breaks the image, the same
      // way it does on Reddit.
      picture: 'https://t0.gstatic.com/images?q=one&w=200',
      newsUrl: 'https://news.example/eskom',
    });
    expect(items[1]!.title).toBe('small business grants');
  });

  it('honours the limit rather than parsing a whole day of terms', () => {
    expect(parseTrendingRss(FEED, 1)).toHaveLength(1);
  });
});

describe('createGoogleTrendsSource', () => {
  it('reads the feed for the requested geo and records it as the trend’s region', async () => {
    let requested = '';
    const fetchImpl = vi.fn(async (url: string | URL) => {
      requested = String(url);
      return textResponse(FEED);
    });

    const source = createGoogleTrendsSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10, region: 'za' });

    expect(requested).toContain('geo=ZA');
    expect(out[0]).toMatchObject({ source: 'google', topic: 'eskom load shedding' });
    expect(out[0]!.metrics.volume).toBe(50000);
    expect(out[0]!.regions).toEqual([{ code: 'ZA', volume: 50000 }]);
    expect(out[0]!.region).toBe('ZA');
    expect(out[0]!.media).toEqual({ url: 'https://t0.gstatic.com/images?q=one&w=200', kind: 'image' });
  });

  it('ranks by feed position, and never fabricates a growth figure', async () => {
    const fetchImpl = vi.fn(async () => textResponse(FEED));
    const source = createGoogleTrendsSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });

    // Position, not traffic: the second term has 25x less traffic but the
    // ordering is what the feed asserts about "trending hardest".
    expect(out[0]!.metrics.velocity).toBeGreaterThan(out[1]!.metrics.velocity);
    // The top term of the day is the one already posted to death.
    expect(out[0]!.metrics.saturation).toBeLessThan(out[1]!.metrics.saturation);
    // One read has nothing to diff against — `trend.observe` builds the series.
    expect(out.every((t) => t.metrics.growth === 0)).toBe(true);
  });

  it('filters client-side, because the feed takes no query', async () => {
    const fetchImpl = vi.fn(async () => textResponse(FEED));
    const source = createGoogleTrendsSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(source.keywordSupport).toBe('filter');
    const out = await source.fetch({ limit: 10, keywords: ['grants'] });
    expect(out.map((t) => t.topic)).toEqual(['small business grants']);
  });

  it('throws with the reason a keyless public feed actually fails', async () => {
    const fetchImpl = vi.fn(async () => textResponse('', false, 429));
    const source = createGoogleTrendsSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 5 })).rejects.toThrow(/rate-limited/i);
  });
});
