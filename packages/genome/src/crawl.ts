import { chromium, type Browser } from 'playwright';
import { checkPublicHttpUrl } from '@sparksocial/shared/safeUrl';
import { kitProbe, rankKit, type CrawledKit } from './brandKit.js';

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

/**
 * Why an entry URL produced no usable pages.
 *
 * Five of these are facts about the *site*. `unavailable` is a fact about *us* —
 * the browser this crawler needs could not start — and it is the one the owner
 * must never be shown in raw form. Before it existed, a container without
 * Chromium installed answered the onboarding URL step with
 * `browserType.launch: Executable doesn't exist at /home/spark/.cache/ms-playwright/…`,
 * rendered in full, in red, under "What's your website?". That text tells a
 * business owner nothing they can act on and everything about our deployment.
 */
export type CrawlFailure = 'blocked' | 'not_found' | 'server_error' | 'unreachable' | 'empty' | 'unavailable';

export interface CrawlResult {
  pages: CrawledPage[];
  /**
   * The site's own palette, fonts and logo, read off the entry page.
   *
   * Entry page only. A brand kit is a property of the site, not of each page,
   * and the homepage is where a business puts its strongest statement of it —
   * running the probe on five pages would cost five times as much to average
   * away the one page that matters.
   */
  kit?: CrawledKit;
  /** Set only when `pages` is empty. */
  failure?: CrawlFailure;
  /**
   * The underlying error text, for the log — never for the owner.
   *
   * Only set for `unavailable`, where the cause is a deployment detail (a missing
   * Chromium, a missing shared library) that an operator needs verbatim and a
   * customer must not see. `explainCrawlFailure` does not read it.
   */
  reason?: string;
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

/** How long to wait for a script-rendered page to produce text after `domcontentloaded`. */
const RENDER_WAIT_MS = 5_000;

/**
 * An unrendered template placeholder in a URL — `{{ it.u }}`, `${slug}`.
 * Read before the page's script swaps them out, these are links to nowhere.
 */
const TEMPLATE = /\{\{|\}\}|\$\{/;

/** Total wall-clock ceiling. P2's exit criterion is a genome in under 3 minutes. */
const TOTAL_BUDGET_MS = 90_000;

/** Text shorter than this is a nav stub or a cookie wall, not a page worth inferring from. */
const MIN_TEXT = 80;

/**
 * The bar a page must clear when its own status code says it is an error.
 *
 * Some sites really do serve a good page under a 403 or a 404, which is why a
 * failure status alone does not disqualify a page. But an error page is also a
 * page, and a short one clears `MIN_TEXT` easily: clientforce.io's nginx 403
 * body is *105 characters* — "403 - Forbidden Access to this page is
 * forbidden." and two decorative class names — twenty-five characters over
 * the bar.
 *
 * That is the whole of the bug this constant exists to close. The crawler
 * counted that error page as content, so `failure` was discarded (it is only
 * reported when nothing at all was crawled), the inference pass was handed a
 * hundred characters of "Forbidden", the model returned something malformed
 * from having nothing to describe, and the owner was told **"The inference
 * pass returned an unusable shape"** — a sentence about our parser, for a
 * site that had simply refused us. The `blocked` message two files over, which
 * names the cause and the remedy, was sitting right there unused.
 */
const ERROR_PAGE_MIN_TEXT = 600;

/**
 * How much text a page must have before it counts as content, given its own
 * HTTP status.
 *
 * Pure and exported for the same reason `failureFor` and `crawlerUserAgent`
 * are: the crawl itself needs a Chromium and is not unit-testable, so every
 * decision inside it that can be a function is one.
 *
 * The status test is written out rather than delegated to `failureFor`, which
 * answers a different question: *why did a crawl find nothing*, and so returns
 * `'empty'` — truthy — for a perfectly good 200. Reusing it here put every
 * successful page behind the error-page bar, which the tests caught
 * immediately. Two similar-looking predicates, one asking "did this request
 * fail" and one asking "what do I tell the owner", and they are not
 * interchangeable.
 */
/**
 * A page that is only a bot check, recognised by what it says.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * `textFloorFor` catches a short error body served under a failure status.
 * It cannot catch the other shape, which is now the commoner one: a challenge
 * page served with **200 OK** and plenty of text. Cloudflare's interstitial,
 * Turnstile, a WAF's "please verify" page — all of them clear 600 characters
 * easily, so the crawl counted one as content, the inference pass was handed a
 * security notice, and the model did the only honest thing it could with it:
 *
 *   Unknown — the site returned only a bot/security check page, with no
 *   business content available.
 *
 * That shape failed validation, and the owner was shown "The inference pass
 * returned an unusable shape" — a sentence about our parser, for a site that
 * had simply refused us. The same wrong answer `ERROR_PAGE_MIN_TEXT` was added
 * to prevent, arriving through the door that constant does not cover.
 *
 * ── Why phrases and not a vendor check ───────────────────────────────────
 *
 * There is no header or status that reliably says "this is a challenge" —
 * that is rather the point of one. What every vendor does have is a page that
 * tells a human what is happening, in a small number of well-worn sentences.
 * Matching those is unglamorous and it is what is actually observable.
 *
 * Two guards against a false positive, which would be the expensive mistake —
 * refusing to read a site that was willing to be read:
 *
 *   * a phrase must appear in the **first 1500 characters**, where a challenge
 *     page has nothing else; an article *about* Cloudflare mentions it deep in
 *     the body, and
 *   * the page must be **short**. A real page that happens to say "checking
 *     your browser" somewhere is a real page, and real pages are long.
 */
const CHALLENGE_PHRASES = [
  'just a moment',
  'checking your browser',
  'enable javascript and cookies to continue',
  'verify you are human',
  'verifying you are human',
  'please verify you are a human',
  'additional security check is required',
  'ddos protection by',
  'attention required!',
  'why have i been blocked',
  'this website is using a security service to protect itself',
  'ray id',
  'cf-browser-verification',
  'challenge-platform',
  'access denied',
  'request unsuccessful. incapsula',
  'pardon our interruption',
  'are you a robot',
  'security check to access',
];

/** Where a challenge page says what it is; past this, it is page content. */
const CHALLENGE_LOOKAHEAD = 1500;

/**
 * Above this, a page carrying one of the phrases is a page *about* the topic,
 * not a challenge. Challenge pages are a sentence and a spinner.
 */
const CHALLENGE_MAX_TEXT = 3_000;

export function isChallengePage(text: string, title?: string): boolean {
  const head = `${title ?? ''} ${text.slice(0, CHALLENGE_LOOKAHEAD)}`.toLowerCase();
  if (!CHALLENGE_PHRASES.some((phrase) => head.includes(phrase))) return false;
  return text.length <= CHALLENGE_MAX_TEXT;
}

export function textFloorFor(status: number | undefined): number {
  const refusedOrBroken = status === undefined || status >= 400;
  return refusedOrBroken ? ERROR_PAGE_MIN_TEXT : MIN_TEXT;
}

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
  let kit: CrawledKit | undefined;

  let browser: Browser | undefined;
  try {
    /**
     * The launch is inside its own try because it fails for a reason unlike every
     * other failure in this function: no browser binary, wrong platform, missing
     * shared library. That is an operator problem, and letting it propagate turned
     * it into a stack trace on a customer's screen.
     *
     * Returned as a result rather than rethrown so `bootstrap.ts` treats it the
     * same way it treats a blocked site — one `ToolError` with a sentence, and the
     * onboarding flow's own "answer questions instead" path already offered. The
     * real cause is logged by the caller, not shown.
     */
    try {
      /**
       * `CHROMIUM_PATH` is the container's own Chromium, shared with Remotion.
       * Unset locally, where Playwright resolves the browser it downloaded
       * itself — so a normal checkout behaves exactly as before.
       */
      browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      });
    } catch (e) {
      return { pages: [], failure: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
    }
    // One context for the whole crawl. See `crawlerUserAgent` for why the
    // version comes from the running browser rather than a constant.
    const context = await browser.newContext({
      userAgent: crawlerUserAgent(browser.version()),
      // The whole reason for a browser rather than `fetch` — see the header.
      javaScriptEnabled: true,
    });
    /*
     * A shim for esbuild's `keepNames` helper, as a *string*.
     *
     * `page.evaluate(fn)` serialises `fn.toString()` and runs it in the page.
     * tsx/esbuild compile every named inner function to `__name(fn, "name")`
     * to preserve `Function.name` — so the source that reaches the browser
     * calls a helper that only exists back in the bundle, and the probe died
     * with `ReferenceError: __name is not defined`. The existing
     * `page.evaluate` calls in this file survive only because they are single
     * anonymous arrows with nothing named inside them.
     *
     * Written as a string literal on purpose: a function here would itself be
     * compiled, which is the problem it is fixing. `addInitScript` puts it in
     * before any document script runs, on every page in the context.
     */
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
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
        const status = response?.status();
        if (next === entryUrl) entryFailure = failureFor(status);

        // `domcontentloaded` fires before a script-rendered page has mounted:
        // clientforce.io has 0 characters of visible text at that point and its
        // full copy a moment later. Wait briefly for real text, and read
        // whatever is there if it never comes — a genuinely thin page still
        // falls to MIN_TEXT below.
        await page
          .waitForFunction(
            (min) => ((globalThis as unknown as BrowserGlobals).document?.body?.innerText?.trim().length ?? 0) >= min,
            MIN_TEXT,
            { timeout: RENDER_WAIT_MS },
          )
          .catch(() => {});

        const title = (await page.title().catch(() => '')) ?? '';
        const text = clean(await page.evaluate(() => (globalThis as unknown as BrowserGlobals).document?.body?.innerText ?? ''));

        /*
         * A challenge page is a refusal wearing a 200.
         *
         * Checked before the length bar, because it passes it: Cloudflare's
         * interstitial and friends are served OK with enough text to clear
         * `ERROR_PAGE_MIN_TEXT`, so the crawl used to count one as content and
         * hand a security notice to the inference pass. See `isChallengePage`.
         *
         * Treated as `blocked` on the entry URL, which is what it is, and
         * which has copy that names the cause and the remedy. On any other
         * page it is simply not content — a footer link into a protected area
         * says nothing about the business.
         */
        if (isChallengePage(text, title)) {
          if (next === entryUrl) entryFailure = 'blocked';
        } else if (text.length >= textFloorFor(status)) {
          /*
           * A page whose status says "error" has to be substantial before it
           * is believed, because the alternative is inferring a brand from the
           * word "Forbidden". A page served 200 keeps the ordinary bar.
           */
          pages.push({ url: next, title, text: text.slice(0, MAX_TEXT) });
        }

        /*
         * The brand kit, from the entry page only, and only once we believe
         * the page: running the probe against an error page would propose a
         * palette made of nginx's default stylesheet.
         *
         * Failure here is not failure of the crawl. A site that renders its
         * stylesheets from an origin we cannot read, or throws inside
         * `getComputedStyle`, still has perfectly good text — and a genome is
         * worth far more than a palette.
         */
        if (next === entryUrl && pages.length > 0 && !kit) {
          kit = await page
            .evaluate(kitProbe)
            .then(rankKit)
            .catch(() => undefined);
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
  // A page that loaded and had *enough* text overrides any status-based guess:
  // some sites serve a perfectly good page under a 404 or 403 status, and
  // `ERROR_PAGE_MIN_TEXT` is where "perfectly good page" stops meaning "the
  // error page itself".
  return {
    pages: crawled,
    ...(kit && (kit.colors.length > 0 || kit.logoUrl || kit.fonts) ? { kit } : {}),
    ...(crawled.length === 0 && entryFailure ? { failure: entryFailure } : {}),
  };
}

/**
 * The crawler's user agent: the real browser's own Chrome token, with
 * `SparkSocialBot` appended so a site owner can still allowlist us by name.
 *
 * The version must be the one actually running, never a constant. This used
 * to hard-code `Chrome/120`, and hosts commonly 403 an outdated Chrome version
 * as a scraper fingerprint. Measured against clientforce.io (nginx): any UA
 * carrying `Chrome/120` was refused, including a byte-perfect real Chrome 120
 * string, while the same string at a current version — with or without the
 * bot suffix — got a 200. A constant goes stale the same way again in a year;
 * `browser.version()` moves with the Chromium the container ships.
 *
 * Linux platform token because the crawler only runs in the Debian image (and
 * locally, where the token is cosmetic). Pure and exported so it is testable
 * without launching Chromium.
 */
export function crawlerUserAgent(browserVersion: string): string {
  return (
    `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${browserVersion} Safari/537.36 SparkSocialBot/1.0 (+https://sparksocial.ai/bot)`
  );
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
  if (TEMPLATE.test(safeDecode(parsed.pathname + parsed.search))) return undefined;

  // The guard runs last so its cost is only paid for links that were otherwise
  // going to be visited.
  return checkPublicHttpUrl(candidate).ok ? candidate : undefined;
}

/** `URL` percent-encodes braces; a malformed escape is left as-is rather than thrown. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
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
