import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/rss.js';

const RSS_2_0 = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Blog</title>
  <item>
    <title>First post &amp; more</title>
    <link>https://example.com/first</link>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Second <post>]]></title>
    <link>https://example.com/second</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Feed</title>
  <entry>
    <title>Atom entry one</title>
    <link href="https://example.com/atom-1" />
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 items, decoding entities and CDATA', () => {
    const items = parseFeed(RSS_2_0);
    expect(items).toEqual([
      { title: 'First post & more', link: 'https://example.com/first', publishedAt: 'Mon, 01 Jan 2024 00:00:00 GMT' },
      { title: 'Second <post>', link: 'https://example.com/second' },
    ]);
  });

  it('decodes numeric character references, as WordPress feeds write them', () => {
    const xml = `<rss><channel><item><title>Lovr Boys Cafe &#038; Roastery&#8217;s &#x201C;Hearts&#x201D;</title><link>https://e.com/a</link></item></channel></rss>`;
    expect(parseFeed(xml)[0]!.title).toBe('Lovr Boys Cafe & Roastery’s “Hearts”');
  });

  it('keeps each item’s picture: media element, image enclosure, then the first image in the body', () => {
    const item = (inner: string) => `<rss><channel><item><title>T</title><link>https://e.com/a</link>${inner}</item></channel></rss>`;
    expect(parseFeed(item('<media:content url="https://e.com/m.jpg" medium="image"/>'))[0]!.imageUrl).toBe('https://e.com/m.jpg');
    expect(parseFeed(item('<enclosure url="https://e.com/e.png" type="image/png" length="1"/>'))[0]!.imageUrl).toBe('https://e.com/e.png');
    // WordPress: no media element, the featured image escaped inside content:encoded.
    expect(
      parseFeed(item('<content:encoded><![CDATA[<p><img src="https://e.com/w.jpg?w=600&amp;h=400" alt=""/></p>]]></content:encoded>'))[0]!.imageUrl,
    ).toBe('https://e.com/w.jpg?w=600&h=400');
    expect(parseFeed(item('<description>&lt;img src="https://e.com/d.jpg"&gt;</description>'))[0]!.imageUrl).toBe('https://e.com/d.jpg');
  });

  it('keeps no picture that is a video, or not a web address', () => {
    const item = (inner: string) => `<rss><channel><item><title>T</title><link>https://e.com/a</link>${inner}</item></channel></rss>`;
    expect(parseFeed(item('<media:content url="https://e.com/v.mp4" medium="video"/>'))[0]!.imageUrl).toBeUndefined();
    expect(parseFeed(item('<description>&lt;img src="javascript:alert(1)"&gt;</description>'))[0]!.imageUrl).toBeUndefined();
    expect(parseFeed(item(''))[0]!.imageUrl).toBeUndefined();
  });

  it('parses Atom entries', () => {
    const items = parseFeed(ATOM);
    expect(items).toEqual([{ title: 'Atom entry one', link: 'https://example.com/atom-1', publishedAt: '2024-01-01T00:00:00Z' }]);
  });

  it('caps at maxItems', () => {
    expect(parseFeed(RSS_2_0, 1)).toHaveLength(1);
  });

  it('skips an item missing a title or link rather than throwing', () => {
    const broken = `<rss><channel><item><title>No link here</title></item></channel></rss>`;
    expect(parseFeed(broken)).toEqual([]);
  });
});
