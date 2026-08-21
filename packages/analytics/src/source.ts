/**
 * `AnalyticsSource` — the one vendor seam `analytics.sync` needs.
 *
 * Deliberately narrow: one post, one platform, in — normalized counts, out.
 * `packages/publish/src/adapter.ts`'s `PlatformAdapter` is the model this
 * mirrors (a small interface a vendor client implements, swapped in behind a
 * factory gated on an API key) rather than something new.
 */
export interface RawPostMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
  impressions: number;
  /**
   * `CC-04`'s "Saves". Optional on the seam, because not every platform reports
   * it and a vendor client that cannot must not have to invent a number —
   * absent normalizes to zero, which is the honest reading of "this platform
   * does not tell us".
   */
  saves?: number;
  /** The vendor's unnormalized response, kept verbatim for anything the normalization missed. */
  raw: unknown;
}

export interface AnalyticsSource {
  fetchMetrics(args: { platform: string; externalId: string }): Promise<RawPostMetrics>;
}
