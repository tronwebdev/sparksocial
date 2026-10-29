import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * NEWS & INDUSTRY FEEDS — the PRD's "RSS feeds (general news, industry blogs)"
 * discovery channel (§11), which had no source until now.
 *
 * The operator lists the feeds (`TREND_RSS_FEEDS`, comma-separated URLs): an
 * industry's trade press, a newsroom's section feed, a niche blog. Each item
 * is a candidate trend — something being written about right now that a brand
 * might have something to say about. Keyless; configured means "feeds are
 * listed", so an empty list leaves it off.
 *
 * ── Metrics ──────────────────────────────────────────────────────────────
 *
 * A feed carries no counts, so `volume` is the number of listed feeds that
 * carry the same story (one, usually; several is a real signal) and the rest
 * comes from the publish time:
 *
 *   `velocity`    Recency — published in the last few hours reads high, three
 *                 days ago reads near zero.
 *   `saturation`  Age, the other way round.
 *   `growth`      `0` — `trend.observe` builds the series.
 */

export interface RssTrendSourceConfig {
  feeds: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface FeedItem {
  title: string;
  link?: string;
  published?: number;
  categories: string[];
  feedHost: string;
  image?: string;
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  const inner = m[1]!.trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1]! : inner).trim() || undefined;
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .trim();
}

/**
 * RSS `<item>` and Atom `<entry>` blocks, regex-parsed for the same reason as
 * `googletrends.ts` and `packages/recipes/src/rss.ts`: no XML parser in the
 * tree, and five fields out of a document we do not control.
 */
export function parseFeed(xml: string, feedHost: string, limit: number): FeedItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const block of blocks) {
    const title = tag(block, 'title');
    if (!title) continue;
    const atomLink = block.match(/<link\b[^>]*href="([^"]+)"/i)?.[1];
    const link = tag(block, 'link') ?? atomLink;
    const date = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date');
    const published = date ? Date.parse(decode(date)) : NaN;
    const categories = [...block.matchAll(/<category\b[^>]*?(?:term="([^"]+)"[^>]*\/?>|>([\s\S]*?)<\/category>)/gi)]
      .map((m) => decode(m[1] ?? m[2] ?? ''))
      .filter(Boolean)
      .slice(0, 5);
    const image =
      block.match(/<media:(?:content|thumbnail)\b[^>]*url="([^"]+)"/i)?.[1] ??
      block.match(/<enclosure\b[^>]*url="([^"]+)"[^>]*type="image/i)?.[1];
    out.push({
      title: decode(title),
      ...(link ? { link: decode(link) } : {}),
      ...(Number.isFinite(published) ? { published } : {}),
      categories,
      feedHost,
      ...(image ? { image: decode(image) } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

const normalise = (title: string) => title.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

export function createRssTrendSource(config: RssTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const feeds = config.feeds.map((f) => f.trim()).filter((f) => /^https?:\/\//i.test(f));

  return {
    name: 'rss',
    keywordSupport: 'filter',

    async fetch({ limit, keywords, excludeKeywords }) {
      /* One failing feed must not cost the others — the composite's own rule, one level down. */
      const results = await Promise.allSettled(
        feeds.map(async (url) => {
          const res = await timedFetch(
            url,
            { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } },
            fetchImpl,
          );
          if (!res.ok) throw new Error(`${url}: ${res.status}`);
          return parseFeed(await res.text(), new URL(url).hostname.replace(/^www\./, ''), 30);
        }),
      );
      const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      if (feeds.length && items.length === 0 && results.every((r) => r.status === 'rejected')) {
        throw new Error(`Every RSS feed failed: ${(results[0] as PromiseRejectedResult).reason}`);
      }

      /* The same story in several feeds is one trend with more volume. */
      const byStory = new Map<string, FeedItem[]>();
      for (const it of items) {
        const key = normalise(it.title);
        byStory.set(key, [...(byStory.get(key) ?? []), it]);
      }

      const nowMs = now().getTime();
      const trends: Trend[] = [...byStory.values()].map((group) => {
        const first = group[0]!;
        const newest = Math.max(...group.map((g) => g.published ?? 0));
        const hours = newest > 0 ? Math.max(0, (nowMs - newest) / 3_600_000) : 48;
        return {
          id: `rss::${normalise(first.title).slice(0, 80).replace(/ /g, '_')}`,
          source: 'rss',
          topic: first.title,
          tags: [...new Set(group.flatMap((g) => [g.feedHost, ...g.categories]))],
          metrics: {
            volume: group.length,
            velocity: clamp01(1 - hours / 72),
            saturation: clamp01(hours / 96),
            growth: 0,
          },
          samples: group.flatMap((g) => (g.link ? [{ url: g.link, caption: `${g.feedHost}: ${g.title}` }] : [])).slice(0, 5),
          ...(first.image ? { media: { url: first.image, kind: 'image' as const } } : {}),
          language: 'en',
          regions: [],
        };
      });

      trends.sort((a, b) => b.metrics.velocity - a.metrics.velocity);
      return applyKeywordFilters(trends.slice(0, Math.max(limit, 1)), {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
      });
    },
  };
}
