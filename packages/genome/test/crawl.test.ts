import { describe, expect, it } from 'vitest';
import { admit, crawlerUserAgent, dedupeChrome, screen, textFloorFor } from '../src/crawl.js';
import { explainCrawlFailure } from '../src/bootstrap.js';

/**
 * The crawler's security surface.
 *
 * `crawl()` itself needs Chromium and a public site, so it is verified live
 * rather than here. What is unit-tested is the two pure decisions — which
 * requests may leave the browser (`screen`) and which links may be queued
 * (`admit`) — because those are where an SSRF gets in, and a bug in either is
 * invisible in a passing crawl.
 *
 * The threat is specific: this runs on Container Apps with Managed Identity,
 * where `169.254.169.254` mints tokens for the app's own identity. Not one
 * tenant's data — every tenant's.
 */

const ORIGIN = 'https://emekacuts.example';
const fresh = () => new Set<string>();

describe('screen — every request, including redirect hops', () => {
  it('blocks the Azure metadata endpoint', () => {
    // The one that matters. A site we were pointed at 302s here, Playwright
    // follows redirects transparently, and the entry-URL check never re-runs.
    expect(screen('http://169.254.169.254/metadata/identity/oauth2/token', 'document')).toBe('block');
  });

  it('blocks loopback and private ranges reached by redirect', () => {
    expect(screen('http://127.0.0.1:8080/v1/tools/publish.now', 'document')).toBe('block');
    expect(screen('http://10.0.0.5/', 'document')).toBe('block');
    expect(screen('http://192.168.1.1/', 'document')).toBe('block');
    expect(screen('http://[::1]/', 'document')).toBe('block');
  });

  it('blocks the IPv4-mapped IPv6 form of the metadata address', () => {
    // WHATWG parsing normalises `::ffff:169.254.169.254` to hex, which is why
    // this bypass survives naive dotted-quad matching.
    expect(screen('http://[::ffff:a9fe:a9fe]/', 'document')).toBe('block');
  });

  it('blocks a page’s own XHR to the metadata service', () => {
    // Not a redirect and not a link: JavaScript we chose to execute making its
    // own request. Screening at the route handler covers it; screening links
    // would not.
    expect(screen('http://169.254.169.254/', 'xhr')).toBe('block');
    expect(screen('http://169.254.169.254/', 'fetch')).toBe('block');
  });

  it('blocks non-http schemes', () => {
    expect(screen('file:///etc/passwd', 'document')).toBe('block');
  });

  it('lets an ordinary public page through', () => {
    expect(screen(`${ORIGIN}/about`, 'document')).toBe('continue');
    expect(screen(`${ORIGIN}/app.js`, 'script')).toBe('continue');
  });

  it('drops images, media and fonts — cost, not security', () => {
    expect(screen(`${ORIGIN}/hero.jpg`, 'image')).toBe('block');
    expect(screen(`${ORIGIN}/promo.mp4`, 'media')).toBe('block');
    expect(screen(`${ORIGIN}/onest.woff2`, 'font')).toBe('block');
  });

  it('applies the address check before the resource-type check', () => {
    // A stylesheet request to the metadata endpoint is still an SSRF. If the
    // cheap resource-type branch ran first this would read `continue`.
    expect(screen('http://169.254.169.254/x.css', 'stylesheet')).toBe('block');
  });
});

describe('admit — which discovered links get queued', () => {
  it('rejects unrendered template placeholders', () => {
    // Read before the page's script runs, clientforce.io's menu links are
    // literally `{{ it.u }}` — which `URL` percent-encodes into a real-looking
    // same-origin path that 404s and burns a page of the budget.
    expect(admit(`${ORIGIN}/{{ it.u }}`, ORIGIN, fresh())).toBeUndefined();
    expect(admit(`${ORIGIN}/%7B%7B%20p.u%20%7D%7D`, ORIGIN, fresh())).toBeUndefined();
    expect(admit(`${ORIGIN}/services/\${slug}`, ORIGIN, fresh())).toBeUndefined();
    expect(admit(`${ORIGIN}/pricing.html`, ORIGIN, fresh())).toBe(`${ORIGIN}/pricing.html`);
  });

  it('rejects a link into the metadata service', () => {
    // The confused-deputy case: we were pointed at a legitimate site and its
    // markup links to IMDS. Note this is rejected by *same-origin* — see the
    // next test for the guard itself.
    expect(admit('http://169.254.169.254/metadata', ORIGIN, fresh())).toBeUndefined();
  });

  it('re-runs the SSRF guard even on a same-origin link', () => {
    // The previous test passes with the guard deleted, because same-origin
    // rejects it first — verified by mutation. This is the case that actually
    // exercises the guard: an origin that is itself private, so the origin
    // check passes and only the guard is left standing.
    //
    // Unreachable through `crawl()` today, since a private entry URL is
    // rejected before the browser launches. It is reachable the moment anyone
    // calls `admit()` from somewhere else or relaxes same-origin to
    // same-registrable-domain, and defence that only works in the current
    // call order is not defence.
    const priv = 'http://169.254.169.254';
    expect(admit(`${priv}/metadata/identity/oauth2/token`, priv, fresh())).toBeUndefined();
    expect(admit('http://10.0.0.5/internal', 'http://10.0.0.5', fresh())).toBeUndefined();
  });

  it('rejects a link whose origin merely looks like ours', () => {
    // `emekacuts.example.evil.com` shares a prefix and nothing else.
    expect(admit('https://emekacuts.example.evil.com/about', ORIGIN, fresh())).toBeUndefined();
    expect(admit('https://evil.com/?x=emekacuts.example', ORIGIN, fresh())).toBeUndefined();
  });

  it('treats a scheme change as a different origin', () => {
    // Downgrading to http is a different origin by definition, and following
    // it would strip transport security from the rest of the crawl.
    expect(admit('http://emekacuts.example/about', ORIGIN, fresh())).toBeUndefined();
  });

  it('accepts a same-origin page', () => {
    expect(admit(`${ORIGIN}/about`, ORIGIN, fresh())).toBe(`${ORIGIN}/about`);
  });

  it('strips the fragment so one page is not crawled twice', () => {
    expect(admit(`${ORIGIN}/about#team`, ORIGIN, fresh())).toBe(`${ORIGIN}/about`);
  });

  it('treats trailing-slash and case variants as already seen', () => {
    const seen = new Set(['https://emekacuts.example/about']);
    expect(admit(`${ORIGIN}/about/`, ORIGIN, seen)).toBeUndefined();
    expect(admit(`${ORIGIN}/About`, ORIGIN, seen)).toBeUndefined();
  });

  it('skips assets that would burn a page budget for no text', () => {
    for (const path of ['/brochure.pdf', '/logo.svg', '/reel.mp4', '/feed.xml', '/style.css']) {
      expect(admit(ORIGIN + path, ORIGIN, fresh())).toBeUndefined();
    }
  });

  it('skips legal boilerplate and auth walls', () => {
    // A privacy policy describes a law firm's template, not this business, and
    // spending one of five page slots on it makes the genome worse.
    for (const path of ['/privacy', '/terms', '/legal/', '/sign-in', '/checkout?step=1']) {
      expect(admit(ORIGIN + path, ORIGIN, fresh())).toBeUndefined();
    }
  });

  it('does not skip a page that merely contains a skipped word', () => {
    // `/our-terms-of-service-explained` is prose; `/services` contains no
    // segment we skip. Substring matching here would silently starve the crawl.
    expect(admit(`${ORIGIN}/services`, ORIGIN, fresh())).toBe(`${ORIGIN}/services`);
    expect(admit(`${ORIGIN}/accountants`, ORIGIN, fresh())).toBe(`${ORIGIN}/accountants`);
  });

  it('ignores unparseable hrefs rather than throwing', () => {
    // `page.evaluate` returns resolved absolute hrefs, but `javascript:` and
    // `mailto:` links come back verbatim and must not abort the crawl.
    expect(admit('mailto:hi@emekacuts.example', ORIGIN, fresh())).toBeUndefined();
    expect(admit('javascript:void(0)', ORIGIN, fresh())).toBeUndefined();
    expect(admit('', ORIGIN, fresh())).toBeUndefined();
  });

  it('keeps the query string — it can select a real page', () => {
    expect(admit(`${ORIGIN}/s?p=2`, ORIGIN, fresh())).toBe(`${ORIGIN}/s?p=2`);
  });
});

describe('dedupeChrome — the nav is evidence once, not five times', () => {
  const NAV = 'Home\nServices\nBook now\nContact';
  const FOOT = 'Emeka Cuts — sharp fades since 2004';

  /** Padded past MIN_TEXT, since short pages are returned whole by design. */
  const body = (n: number) =>
    Array.from({ length: 6 }, (_, i) => `Page ${n} sentence ${i} describing this business at length.`).join('\n');

  const site = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      url: `https://x.example/${i}`,
      title: `Page ${i}`,
      text: `${NAV}\n${body(i)}\n${FOOT}`,
    }));

  it('keeps the repeated nav on the first page only', () => {
    const out = dedupeChrome(site(5));
    expect(out[0]!.text).toContain('Book now');
    for (const page of out.slice(1)) expect(page.text).not.toContain('Book now');
  });

  it('never deletes a repeated line everywhere — a footer tagline is positioning', () => {
    // The failure mode this design exists to avoid. "Sharp fades since 2004" is
    // boilerplate by frequency and the best sentence on the site; dropping it
    // from all five pages would delete the brand's own positioning.
    const out = dedupeChrome(site(5));
    expect(out.filter((p) => p.text.includes(FOOT))).toHaveLength(1);
  });

  it('leaves each page’s own content untouched', () => {
    const out = dedupeChrome(site(5));
    out.forEach((page, i) => expect(page.text).toContain(`Page ${i} sentence 0`));
  });

  it('measurably shrinks the text handed to inference', () => {
    const before = site(5).reduce((n, p) => n + p.text.length, 0);
    const after = dedupeChrome(site(5)).reduce((n, p) => n + p.text.length, 0);
    expect(after).toBeLessThan(before);
  });

  it('does nothing below three pages — too few to tell chrome from content', () => {
    // With two pages every shared line looks like boilerplate, including a
    // one-page site's entire message.
    const two = site(2);
    expect(dedupeChrome(two)).toEqual(two);
  });

  it('keeps a line shared by only a minority of pages', () => {
    // Under the 60% threshold. Two of five pages mentioning the same service is
    // a fact about the business, not a template.
    const pages = site(5);
    pages[1]!.text += '\nWe also do beard trims';
    pages[2]!.text += '\nWe also do beard trims';
    const out = dedupeChrome(pages);
    expect(out.filter((p) => p.text.includes('beard trims'))).toHaveLength(2);
  });

  it('returns a page whole rather than emptying it', () => {
    // A bare index that is nothing but nav would otherwise dedupe to nothing,
    // and an empty page teaches the inference step less than a redundant one.
    const pages = [...site(4), { url: 'https://x.example/i', title: 'Index', text: NAV }];
    const out = dedupeChrome(pages);
    expect(out[4]!.text).toBe(NAV);
  });
});

describe('failureFor — why a crawl found nothing', () => {
  /**
   * The caller used to get "no pages" for four unrelated causes and reported
   * the least likely one for all of them: a site behind Cloudflare was told it
   * had no readable content. That is false, and — unlike "they blocked us" —
   * there is nothing a business owner can do with it.
   *
   * `failureFor` is not exported; these go through `crawl`'s contract via the
   * copy in `bootstrap.ts`, which is what a person actually reads.
   */
  it('groups statuses by the action they imply, not by HTTP semantics', () => {
    // 401 and 403 differ to a protocol and are identical to an owner: someone
    // has to let us in. 429 belongs with them for the same reason.
    // Matched loosely on purpose: what this pins is that a blocked site is told
    // it was refused, not that it had no content. The exact wording has already
    // changed once — it used to name Cloudflare, and the first site measured
    // doing this was behind plain nginx — and pinning prose would make every
    // such correction look like a regression.
    expect(explainCrawlFailure('https://x.example', 'blocked')).toMatch(/refused|block/i);
    expect(explainCrawlFailure('https://x.example', 'not_found')).toMatch(/no page at/i);
    expect(explainCrawlFailure('https://x.example', 'server_error')).toMatch(/may be down/i);
    expect(explainCrawlFailure('https://x.example', 'unreachable')).toMatch(/could not reach/i);
    expect(explainCrawlFailure('https://x.example', 'empty')).toMatch(/no readable text/i);
  });

  it('never blames the owner for a firewall', () => {
    // The most common failure, and the one most likely to be read as "your
    // site is broken" when it means the opposite.
    const message = explainCrawlFailure('https://tronweb.co', 'blocked');
    expect(message).toMatch(/not anything you did/i);
    expect(message).toContain('tronweb.co');
  });

  it('always offers the way forward', () => {
    // Every one of these used to be a dead end. `genome.create` is the exit,
    // and a message that does not mention it leaves the user stuck on a step
    // whose only button retries something that just refused.
    for (const failure of ['blocked', 'not_found', 'server_error', 'unreachable', 'empty'] as const) {
      expect(explainCrawlFailure('https://x.example', failure)).toMatch(/answering a few questions/i);
    }
  });

  it('falls back to the empty message for an unknown cause', () => {
    expect(explainCrawlFailure('https://x.example', undefined)).toMatch(/no readable text/i);
  });

  /**
   * `unavailable` — the only cause in this union that is about us.
   *
   * The container shipped without a Chromium, so `chromium.launch` threw and the
   * onboarding URL step rendered `browserType.launch: Executable doesn't exist at
   * /home/spark/.cache/ms-playwright/…` in full, in red, to a business owner. The
   * message must therefore do two things the other five need not: not blame the
   * site, and not describe our deployment.
   */
  describe('unavailable', () => {
    it('says the failure is ours, not the site’s', () => {
      const message = explainCrawlFailure('https://tronweb.co', 'unavailable');
      expect(message).toMatch(/our website reader/i);
      expect(message).toMatch(/nothing to do with tronweb\.co/i);
    });

    it('offers the same way forward as every other cause', () => {
      expect(explainCrawlFailure('https://x.example', 'unavailable')).toMatch(/answering a few questions/i);
    });

    it('leaks nothing about the deployment', () => {
      // The specific strings that were on screen. A message naming a cache path,
      // a binary, or a library is one an owner can neither act on nor report.
      const message = explainCrawlFailure('https://x.example', 'unavailable');
      expect(message).not.toMatch(/playwright|chromium|executable|browserType|\.cache|npx/i);
    });

    it('does not claim the site was unreachable', () => {
      // The nearest wrong answer, and an expensive one: it sends the owner to
      // check their own DNS for a fault in our image.
      expect(explainCrawlFailure('https://x.example', 'unavailable')).not.toMatch(/could not reach/i);
    });
  });
});

describe('crawlerUserAgent — what the site sees', () => {
  const ua = crawlerUserAgent('141.0.7390.37');

  it('carries the running browser version, not a constant', () => {
    // A hard-coded `Chrome/120` is what clientforce.io refused: hosts 403
    // outdated Chrome versions as a scraper fingerprint.
    expect(ua).toContain('Chrome/141.0.7390.37 ');
    expect(crawlerUserAgent('150.0.1.2')).toContain('Chrome/150.0.1.2 ');
    expect(ua).not.toContain('Chrome/120');
  });

  it('is shaped like a real Chrome UA, so it is not filtered as malformed', () => {
    expect(ua).toMatch(
      /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/[\d.]+ Safari\/537\.36 /,
    );
  });

  it('still names SparkSocialBot at the end, so an owner can allowlist us', () => {
    expect(ua).toMatch(/ SparkSocialBot\/1\.0 \(\+https:\/\/sparksocial\.ai\/bot\)$/);
  });
});

describe('textFloorFor — an error page is not content', () => {
  /*
   * The measurement that set the number. clientforce.io answers the crawler
   * with an nginx 403 whose entire visible body is
   *
   *     "403 - Forbidden bg_error_lines circle_dots 403 - Forbidden
   *      Access to this page is forbidden. clouds_shape"
   *
   * — 105 characters, twenty-five over the ordinary 80-character floor. It was
   * therefore counted as a crawled page, which discarded the `blocked` failure
   * (only reported when nothing was crawled at all) and sent "Forbidden" to the
   * inference pass as though it were a business's website.
   */
  const NGINX_403_BODY_LENGTH = 105;

  it('refuses the 105-character error page that caused this', () => {
    expect(NGINX_403_BODY_LENGTH).toBeLessThan(textFloorFor(403));
  });

  it('keeps the ordinary bar for a page served 200', () => {
    expect(textFloorFor(200)).toBe(80);
    expect(NGINX_403_BODY_LENGTH).toBeGreaterThan(textFloorFor(200));
  });

  it('applies to every status that means "we were refused or it broke"', () => {
    for (const status of [401, 403, 429, 500, 503]) {
      expect(textFloorFor(status)).toBeGreaterThan(textFloorFor(200));
    }
  });

  /*
   * Deliberately still possible. Some sites serve a real page under a 403 or a
   * 404, which is why a failure status does not disqualify a page outright —
   * it only has to be substantial before it is believed.
   */
  it('still admits a substantial page served under a failure status', () => {
    const realPageUnder403 = 4_000;
    expect(realPageUnder403).toBeGreaterThan(textFloorFor(403));
  });

  it('treats an unreachable page (no status) as a failure too', () => {
    expect(textFloorFor(undefined)).toBeGreaterThan(textFloorFor(200));
  });
});
