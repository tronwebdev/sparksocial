/**
 * Site crawl for genome bootstrap.
 *
 * Runs against the Playwright capture service (Azure Container Apps) so that
 * JS-rendered marketing sites and Instagram profiles are readable. Returns raw
 * page text; the caller is responsible for wrapping it in `untrusted()` before it
 * reaches a model prompt — this module deliberately does not do that itself, so
 * that the containment step is visible at the call site.
 */

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface CrawlOptions {
  maxPages: number;
  /** Per-page navigation budget. */
  timeoutMs?: number;
}

/**
 * TODO(P2): implement against the capture service. Breadth-first from the entry
 * URL, same-origin only, skipping assets and auth walls, capped at `maxPages`.
 */
export async function crawl(_url: string, _opts: CrawlOptions): Promise<CrawledPage[]> {
  throw new Error('crawl() is not implemented yet — see P2 in the master build plan.');
}
