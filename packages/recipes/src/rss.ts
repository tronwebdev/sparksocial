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
}

export function parseFeed(xml: string, maxItems = 20): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom ? matchAll(xml, /<entry\b[\s\S]*?<\/entry>/gi) : matchAll(xml, /<item\b[\s\S]*?<\/item>/gi);

  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = decode(firstTag(block, 'title'));
    const link = isAtom ? atomLink(block) : decode(firstTag(block, 'link'));
    const publishedAt = decode(firstTag(block, isAtom ? 'updated' : 'pubDate')) || undefined;
    if (title && link) items.push({ title, link, ...(publishedAt ? { publishedAt } : {}) });
    if (items.length >= maxItems) break;
  }
  return items;
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
    .replace(/&#0?39;/g, "'")
    .trim();
}
