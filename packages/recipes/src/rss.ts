/**
 * RSS 2.0 / Atom parsing for the `rss` recipe kind (plan §12 P5).
 *
 * Regex-based on purpose, not a DOM/XML dependency: RSS is public and needs
 * no vendor credential, unlike every other recipe source (Canva, Drive), so
 * this is the one kind that can be genuinely real without an approval or an
 * API key. What it covers — `<item>`/`<entry>` with `title`/`link`/date —
 * is the shape every real-world feed generator (WordPress, Substack,
 * YouTube channel feeds) actually emits; it does not claim full RSS/Atom
 * conformance (namespaces, CDATA edge cases, relative links).
 */

export interface FeedItem {
  title: string;
  link: string;
  publishedAt?: string;
  /** The item's picture, when the feed carries one — see `imageOf`. */
  imageUrl?: string;
}

export function parseFeed(xml: string, maxItems = 20): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom ? matchAll(xml, /<entry\b[\s\S]*?<\/entry>/gi) : matchAll(xml, /<item\b[\s\S]*?<\/item>/gi);

  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = decode(firstTag(block, 'title'));
    const link = isAtom ? atomLink(block) : decode(firstTag(block, 'link'));
    const publishedAt = decode(firstTag(block, isAtom ? 'updated' : 'pubDate')) || undefined;
    const imageUrl = imageOf(block);
    if (title && link) {
      items.push({ title, link, ...(publishedAt ? { publishedAt } : {}), ...(imageUrl ? { imageUrl } : {}) });
    }
    if (items.length >= maxItems) break;
  }
  return items;
}

/**
 * An item's picture, in the order feeds actually supply one: Media RSS
 * (`media:content` / `media:thumbnail`), an image enclosure, then the first
 * `<img>` in the body — WordPress feeds such as dailycoffeenews.com carry no
 * media element and put the featured image at the top of `content:encoded`.
 *
 * Only an http(s) URL is returned. The queue renders it as an `<img>` in the
 * person's browser, so a `javascript:` or `data:` value must not get through.
 */
function imageOf(block: string): string | undefined {
  // A `medium="video"` media element is a video file, not a picture of one.
  const media = block.match(/<media:(?:content|thumbnail)\b[^>]*>/i)?.[0];
  const candidates = [
    media && !/\bmedium=["']video/i.test(media) ? media.match(/\burl=["']([^"']+)["']/i)?.[1] : undefined,
    block.match(/<enclosure\b(?=[^>]*\btype=["']image\/)[^>]*\burl=["']([^"']+)["']/i)?.[1],
    // The body is usually entity-escaped or CDATA-wrapped; either way the tag
    // is findable once `&lt;` is turned back into `<`.
    decode(block.replace(/&lt;/g, '<').replace(/&gt;/g, '>')).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1],
  ];
  for (const c of candidates) {
    const url = c ? decode(c) : '';
    if (/^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[0]);
}

function firstTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  // Strip a CDATA wrapper if present.
  const inner = m[1]!.trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1]! : inner).trim();
}

/** Atom's `<link href="...">` is a self-closing attribute, not tag content. */
function atomLink(block: string): string {
  const m = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  return m ? decode(m[1]!) : '';
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Numeric references — WordPress feeds write "&" as `&#038;` and quotes as
    // `&#8217;`, which reached post titles verbatim.
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .trim();
}
