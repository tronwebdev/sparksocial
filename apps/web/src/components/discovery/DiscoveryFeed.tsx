'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { TrendCard, type RankedTrendItem, type WatchlistTrendItem } from './TrendCard';
import { TrendDetail } from './TrendDetail';
import { InfluencerWatchlist } from './InfluencerWatchlist';

/**
 * Discovery — `DISC-01`/`DISC-02`, plan §12 P5. Two tabs: `trend.rank`'s
 * ranked feed (safest-and-most-actionable first, with what got excluded and
 * why — the product's actual argument, per `trend.rank`'s own comment) and
 * `trend.watchlist`'s saved list. Repurpose/reshare/watch actions live on
 * each card (`TrendCard`) rather than here, the same split `EngagementFeed`
 * uses for its per-item actions.
 *
 * `DISC-02` opens in place of the feed rather than on its own route. The detail
 * view is a step inside "find something worth posting about", not a destination
 * — a full page navigation would lose the ranked list and the excluded-trends
 * argument beneath it, which is the context that makes one trend's score mean
 * anything.
 */

/**
 * §8.9 names two watchlists among Discovery's inputs — keywords and accounts.
 * They are separate tabs rather than one merged list because a saved trend and a
 * watched competitor are answers to different questions ("is this still worth
 * joining?" versus "what are they doing?") and are acted on differently.
 */
const TABS: Array<{ key: 'trending' | 'watchlist' | 'influencers'; label: string }> = [
  { key: 'trending', label: 'Trending' },
  { key: 'watchlist', label: 'Saved trends' },
  { key: 'influencers', label: 'Accounts you watch' },
];

export function DiscoveryFeed() {
  const { genome, loading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [tab, setTab] = useState<'trending' | 'watchlist' | 'influencers'>('trending');
  const [trends, setTrends] = useState<RankedTrendItem[] | null>(null);
  const [excluded, setExcluded] = useState<Array<{ trendId: string; topic: string; because: string }>>([]);
  const [watchlist, setWatchlist] = useState<WatchlistTrendItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The trend whose `DISC-02` detail is open, if any. */
  const [openTrendId, setOpenTrendId] = useState<string | null>(null);

  const loadTrending = useCallback(async (id: string) => {
    setTrends(null);
    setError(null);
    const res = await invoke<{ trends: RankedTrendItem[]; excluded: Array<{ trendId: string; topic: string; because: string }>; why: { summary: string } }>(
      'trend.rank',
      { genomeId: id, limit: 15 },
    );
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setTrends([]);
      return;
    }
    setTrends(res.output.trends);
    setExcluded(res.output.excluded);
  }, []);

  const loadWatchlist = useCallback(async (id: string) => {
    setWatchlist(null);
    setError(null);
    const res = await invoke<{ watchlist: WatchlistTrendItem[] }>('trend.watchlist', { genomeId: id, action: 'list' });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setWatchlist([]);
      return;
    }
    setWatchlist(res.output.watchlist);
  }, []);

  useEffect(() => {
    if (!genomeId) return;
    if (tab === 'trending') void loadTrending(genomeId);
    // The influencers tab loads its own data — it owns two tools this component
    // has no other use for, and lifting them here would put a third unrelated
    // loading state in one effect.
    else if (tab === 'watchlist') void loadWatchlist(genomeId);
  }, [genomeId, tab, loadTrending, loadWatchlist]);

  function handleWatchChanged(trendId: string, watched: boolean) {
    // Optimistic: the watchlist tab, if it's the one currently open, refetches
    // on next visit anyway — this just keeps a Trending-tab toggle honest
    // without a round trip back through trend.rank.
    if (tab === 'watchlist' && !watched) {
      setWatchlist((prev) => prev?.filter((w) => w.trendId !== trendId) ?? prev);
    }
  }

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (genomeError || !genomeId) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{genomeError ?? 'No brand selected.'}</p>
      </section>
    );
  }

  // DISC-02 replaces the feed while it is open. `key` on the trend id so
  // opening a second trend remounts rather than showing the first one's data
  // while the second loads.
  if (openTrendId) {
    return (
      <TrendDetail
        key={openTrendId}
        genomeId={genomeId}
        trendId={openTrendId}
        onClose={() => setOpenTrendId(null)}
      />
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Discovery</h2>
      <p className="mt-1 text-[14px] text-ink-muted">
        Trends worth acting on — ranked by how much of the window is left, not by how big they already are.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === t.key ? 'bg-ink text-surface' : 'bg-surface-muted text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'influencers' ? <InfluencerWatchlist genomeId={genomeId} /> : tab === 'trending' ? (
        trends === null ? (
          <div className="mt-4 grid grid-cols-1 gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded" />
            ))}
          </div>
        ) : error ? (
          <p className="mt-4 text-[14px] text-ink-muted">{error}</p>
        ) : trends.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-muted">Nothing worth joining right now — every current trend is either saturated, off-brand, or unsafe.</p>
        ) : (
          <>
            <ul className="mt-4 grid grid-cols-1 gap-3">
              {trends.map((t) => (
                <TrendCard
                  key={t.trendId}
                  trend={t}
                  genomeId={genomeId}
                  onWatchChanged={handleWatchChanged}
                  onOpen={() => setOpenTrendId(t.trendId)}
                />
              ))}
            </ul>
            {excluded.length > 0 ? (
              <div className="mt-4 rounded-lg border border-border bg-surface-muted p-3">
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                  {excluded.length} skipped
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-1">
                  {excluded.map((e) => (
                    <li key={e.trendId} className="text-[13px] text-ink-muted">
                      <span className="text-ink">{e.topic}</span> — {e.because}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )
      ) : watchlist === null ? (
        <div className="mt-4 grid grid-cols-1 gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded" />
          ))}
        </div>
      ) : error ? (
        <p className="mt-4 text-[14px] text-ink-muted">{error}</p>
      ) : watchlist.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-muted">Nothing watched yet — watch a trend from the Trending tab to track it here.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3">
          {watchlist.map((w) => (
            <li key={w.trendId} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-medium text-ink">{w.topic}</p>
                <Badge variant="neutral" className="capitalize">{w.source}</Badge>
              </div>
              {w.note ? <p className="mt-1 text-[13px] text-ink-muted">{w.note}</p> : null}
              <button
                type="button"
                onClick={() => setOpenTrendId(w.trendId)}
                className="mt-2 mr-4 text-[13px] font-medium text-brand-purple hover:underline"
              >
                Open
              </button>
              <button
                type="button"
                onClick={async () => {
                  await invoke('trend.watchlist', { genomeId, action: 'remove', trendId: w.trendId });
                  setWatchlist((prev) => prev?.filter((x) => x.trendId !== w.trendId) ?? prev);
                }}
                className="mt-2 text-[13px] font-medium text-brand-purple hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
