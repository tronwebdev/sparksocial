import { chromium, type Browser } from 'playwright';
import { checkPublicHttpUrl } from '@sparksocial/shared/safeUrl';

/**
 * Site crawl for genome bootstrap (`ONB-01`).
 *
 * Playwright rather than `fetch` + a parser, because the input is a marketing
 * site or an Instagram profile: the text that describes a business is routinely
 * rendered by JavaScript, and a fetch-based crawler reads an empty shell and
 * concludes the brand has nothing to say. The genome is inferred from this
 * text, so a thin crawl produces a thin genome and every downstream decision
 * inherits it.
 *
 * Runs in-process rather than against a separate capture service. Crawling
 * happens once per onboarding, not per request, so the isolation a separate
 * service buys is solving a scale problem that does not exist yet; the seam to
 * extract it later is this function's signature.
 *
 * Returns raw page text. Wrapping it in `untrusted()` is deliberately the
 * caller's job (`bootstrap.ts`), so the containment step stays visible at the
 * point where crawled text meets a prompt.
 */

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

/** Why an entry URL produced no usable pages. */
export type CrawlFailure = 'blocked' | 'not_found' | 'server_error' | 'unreachable' | 'empty';

export interface CrawlResult {
  pages: CrawledPage[];
  /** Set only when `pages` is empty. */
  failure?: CrawlFailure;
}

export interface CrawlOptions {
  maxPages: number;
  /** Per-page navigation budget. */
  timeoutMs?: number;
}

/**
 * Minimal shape of the browser globals `page.evaluate` runs against.
 *
 * The root tsconfig's `lib` is ES2022 with no DOM, deliberately — it also
 * governs `packages/db` and `apps/api`, where a `document` global in scope
 * would be a bug rather than a convenience. These callbacks execute inside
 * Chromium, so the reference is type-only and erased before the function is
 * serialised across.
 */
interface BrowserGlobals {
  document?: {
    body?: { innerText?: string };
    querySelectorAll(selector: string): ArrayLike<{ href: string }>;
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Total wall-clock ceiling. P2's exit criterion is a genome in under 3 minutes. */
const TOTAL_BUDGET_MS = 90_000;

/** Text shorter than this is a nav stub or a cookie wall, not a page worth inferring from. */
const MIN_TEXT = 80;

/** Per-page cap. Enough for a long about-page, far below anything that bloats a prompt. */
const MAX_TEXT = 20_000;

/**
 * Paths that are never worth a page budget: legal boilerplate describes a law
 * firm's template, not this business, and auth walls return a login form.
 */
const SKIP = /\/(privacy|terms|cookie|legal|login|signin|sign-in|register|cart|checkout|account)(\/|$|\?)/i;

/** Extensions Playwright would happily navigate to and produce nothing useful from. */
const ASSET = /\.(pdf|zip|jpe?g|png|gif|svg|webp|mp4|mov|avi|mp3|wav|css|js|ico|xml|rss)(\?|$)/i;

export async function crawl(url: string, opts: CrawlOptions): Promise<CrawlResult> {
  // The entry URL is already `PublicHttpUrl`-validated by the tool schema, but
  // this function is exported and a future caller may not be a tool.
  const entry = checkPublicHttpUrl(url);
  if (!entry.ok) throw new Error(`Refusing to crawl ${url}: ${entry.reason}`);
  const entryUrl = new URL(url).toString();

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const origin = new URL(entryUrl).origin;

  const queue: string[] = [entryUrl];
  const seen = new Set<string>([normalise(entryUrl)]);
  const pages: CrawledPage[] = [];

  /**
   * Why the entry URL yielded nothing, when it yields nothing.
   *
   * The caller previously got "no pages" for four unrelated causes — blocked,
   * missing, unreachable, genuinely empty — and reported the last one for all
   * of them. A business whose site returned 403 was told it had no readable
   * content, which is both false and unactionable: the true answer ("that site
   * refused us") has an obvious next step and the false one has none.
   */
  let entryFailure: CrawlFailure | undefined;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    /**
     * One context for the whole crawl, identifying itself honestly.
     *
     * This comment used to claim the custom UA defeats bot walls. Measured
     * across four sites, it does not: on the one site that blocked us, a
     * *real Chrome* UA was blocked identically and only Playwright's own
     * headless default got through — so the string is not the lever the
     * comment assumed, and picking a UA to evade a WAF would be over-fitting
     * to one vendor's rules.
     *
     * It stays self-identifying because that is what lets a site owner
     * allowlist us deliberately, which is the durable fix when the crawl
     * target belongs to the customer asking us to read it.
     */
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (compatible; SparkSocialBot/1.0; +https://sparksocial.ai/bot) Chrome/120 Safari/537.36',
      // The whole reason for a browser rather than `fetch` — see the header.
      javaScriptEnabled: true,
    });
    await context.route('**/*', (route) => {
      const decision = screen(route.request().url(), route.request().resourceType());
      return decision === 'continue' ? route.continue() : route.abort('blockedbyclient');
    });

    while (queue.length > 0 && pages.length < opts.maxPages && Date.now() < deadline) {
      const next = queue.shift()!;
      const page = await context.newPage();
      try {
        // `domcontentloaded`, not `networkidle`: analytics beacons and chat
        // widgets keep a marketing site's network busy indefinitely, and
        // waiting for quiet means timing out on sites that rendered fine.
        const response = await page.goto(next, { waitUntil: 'domcontentloaded', timeout });

        // Only the entry URL's failure is worth reporting. A 404 on a footer
        // link is normal and says nothing about the business.
        if (next === entryUrl) entryFailure = failureFor(response?.status());

        const title = (await page.title().catch(() => '')) ?? '';
        const text = clean(await page.evaluate(() => (globalThis as unknown as BrowserGlobals).document?.body?.innerText ?? ''));

        if (text.length >= MIN_TEXT) {
          pages.push({ url: next, title, text: text.slice(0, MAX_TEXT) });
        }

        if (pages.length < opts.maxPages) {
          const links = await page
            .evaluate(() => Array.from((globalThis as unknown as BrowserGlobals).document?.querySelectorAll('a[href]') ?? [], (a) => a.href))
            .catch(() => [] as string[]);

          for (const href of links) {
            if (queue.length + pages.length >= opts.maxPages * 3) break;
            const candidate = admit(href, origin, seen);
            if (candidate) {
              seen.add(normalise(candidate));
              queue.push(candidate);
            }
          }
        }
      } catch {
        // One unreachable page must not abort the crawl — a broken link in a
        // footer is not a reason to fail onboarding.
        //
        // `??=`, not `=`. A 403 page that then throws while being read is
        // *blocked*, and blocked is both more specific and more actionable than
        // "could not reach". Overwriting here reported the vaguer cause for a
        // site we had in fact reached and been refused by — which is the exact
        // confusion this whole change exists to remove.
        if (next === entryUrl) entryFailure ??= 'unreachable';
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  const crawled = dedupeChrome(pages);
  // A page that loaded and had text overrides any status-based guess: some
  // sites serve a perfectly good page under a 404 or 403 status.
  return { pages: crawled, ...(crawled.length === 0 && entryFailure ? { failure: entryFailure } : {}) };
}

/**
 * What a status code means for *onboarding*, in the words the owner needs.
 *
 * Grouped by the action each one implies rather than by HTTP semantics: 401 and
 * 403 both mean "ask them to let us in", 5xx means "try later", and only a
 * genuine 2xx with no text means the page really is empty.
 */
function failureFor(status: number | undefined): CrawlFailure | undefined {
  if (status === undefined) return 'unreachable';
  if (status === 401 || status === 403 || status === 429) return 'blocked';
  if (status === 404 || status === 410) return 'not_found';
  if (status >= 500) return 'server_error';
  return 'empty';
}

/**
 * Collapse the nav, footer and cookie banner that repeat on every page.
 *
 * Measured on a real five-page crawl: ~800 of each page's first characters were
 * the identical header, so roughly 15% of the text budget was one navigation
 * menu sent to the model five times. That is not merely wasted budget — a
 * phrase repeated five times reads to an inference step as five independent
 * pieces of evidence, so the site's own menu labels start to outweigh the
 * sentences that actually describe the business.
 *
 * **First occurrence is kept, later ones dropped.** The alternative — deleting
 * every repeated line — is tempting and wrong: a tagline in the footer of all
 * five pages is boilerplate by frequency and the single best statement of
 * positioning on the site. Keeping it once preserves the signal and removes
 * only the redundancy, which means this needs no judgement about what counts as
 * "real" content.
 *
 * Below three pages there is nothing to compare, so the text is returned
 * untouched rather than guessed at.
 */
export function dedupeChrome(pages: CrawledPage[]): CrawledPage[] {
  if (pages.length < 3) return pages;

  const pagesContaining = new Map<string, number>();
  for (const page of pages) {
    for (const line of new Set(lines(page.text))) {
      pagesContaining.set(line, (pagesContaining.get(line) ?? 0) + 1);
    }
  }

  // Two-thirds, not "every page": a nav that differs by one active item, or a
  // cookie banner that only shows until dismissed, would escape a stricter rule.
  const threshold = Math.ceil(pages.length * 0.6);
  const emitted = new Set<string>();

  return pages.map((page) => {
    const kept = lines(page.text).filter((line) => {
      if ((pagesContaining.get(line) ?? 0) < threshold) return true;
      if (emitted.has(line)) return false;
      emitted.add(line);
      return true;
    });

    // A page that is *entirely* chrome — a bare index, a sitemap — would empty
    // out here. Returning it whole is the safer failure: MIN_TEXT already had
    // its say, and an empty page teaches the inference step nothing.
    const text = kept.join('\n').trim();
    return text.length >= MIN_TEXT ? { ...page, text } : page;
  });
}

function lines(text: string): string[] {
  return text.split('\n');
}

/**
 * Whether the browser may issue a given request at all.
 *
 * This is the choke point `safeUrl.ts`'s own docstring asks for. `admit()` below
 * screens *links we choose to follow*, but a crawl makes many requests nobody
 * chose: `page.goto` follows 3xx redirects transparently, and a rendered page
 * fires its own XHRs. A site that 302s to `http://169.254.169.254/metadata`
 * defeats any check that only ran on the URL we typed — which is precisely the
 * bypass called out in `safeUrl.ts:27-29`.
 *
 * Playwright's route handler fires once per request *including each redirect
 * hop*, so screening here covers navigation, redirects and subresources with one
 * rule instead of three.
 *
 * Kept pure and exported so the decision is testable without launching Chromium.
 *
 * **Still not closed:** DNS rebinding, and a public hostname whose A record
 * points at a private address. This sees the URL, not the socket's peer. Closing
 * it needs `route.continue()` against a pinned resolved IP, which Playwright
 * does not expose — the honest mitigation is that the crawler runs with no
 * ambient credentials of its own.
 */
export function screen(url: string, resourceType: string): 'continue' | 'block' {
  if (!checkPublicHttpUrl(url).ok) return 'block';
  // Images, media and fonts are pure cost — this crawl wants text.
  return resourceType === 'image' || resourceType === 'media' || resourceType === 'font'
    ? 'block'
    : 'continue';
}

/**
 * Whether a discovered link may be visited.
 *
 * **Every followed link is re-checked against the SSRF guard**, not just the
 * entry URL. That is the whole point: a page we were pointed at can contain
 * `<a href="http://169.254.169.254/...">`, and on Container Apps with Managed
 * Identity that endpoint mints tokens for the app's own identity. Validating
 * only the entry URL would make the crawler a confused deputy for anything the
 * crawled site chose to link to.
 *
 * Same-origin is a second, independent limit: it keeps the crawl describing
 * *this* business rather than wandering into whatever it links out to.
 */
export function admit(href: string, origin: string, seen: Set<string>): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return undefined;
  }

  parsed.hash = '';
  const candidate = parsed.toString();

  if (parsed.origin !== origin) return undefined;
  if (seen.has(normalise(candidate))) return undefined;
  if (ASSET.test(parsed.pathname)) return undefined;
  if (SKIP.test(parsed.pathname)) return undefined;

  // The guard runs last so its cost is only paid for links that were otherwise
  // going to be visited.
  return checkPublicHttpUrl(candidate).ok ? candidate : undefined;
}

/** Trailing slashes and fragments are not distinct pages. */
function normalise(u: string): string {
  return u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

/** Collapse the whitespace a rendered page is full of, so more signal fits in the budget. */
function clean(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
