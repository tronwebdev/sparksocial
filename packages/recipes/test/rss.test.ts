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
