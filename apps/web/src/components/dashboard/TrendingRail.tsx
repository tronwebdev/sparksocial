'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import type { RankedTrend } from './types';

/**
 * TRENDING TOPICS — the cockpit's right rail (`DASH-B-01`, M1).
 *
 * Reads `trend.rank`, the same tool the Discovery screen reads, which is the
 * doctrine `BrandHome` already followed: a preview that calls a *different* tool
 * than its full screen is a second implementation that can disagree with it.
 *
 * The score shown is **opportunity**, not the composite `score`. That is the
 * product's actual claim — trends are ranked by how much of the wave is left
 * rather than how big it already is — and a rail that showed the composite would
 * put the biggest topics at the top, which is the ordering the whole ranker
 * exists to avoid.
 *
 * The prototype's rail toggles between "Post published" and "Trending Topics". The
 * published half is the Upcoming tab's twin and is already reachable from the
 * calendar, so this rail is the trends only — one panel doing one thing rather
 * than a toggle where one side duplicates the card beside it.
 */

const VISIBLE = 5;

export function TrendingRail({ trends }: { trends: RankedTrend[] | null }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-[14px] font-medium text-ink">Trending topics</h2>
        <Link
          href="/discovery"
          className="text-[13px] font-medium text-brand-purple underline underline-offset-2"
        >
          Discovery
        </Link>
      </header>

      {trends === null ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-44" />
        </div>
      ) : trends.length === 0 ? (
        <p className="p-5 text-[13px] text-ink-muted">
          Nothing worth joining right now. SPARK skips trends this brand cannot credibly speak to, and
          says why on each one in Discovery.
        </p>
      ) : (
        <ul>
          {trends.slice(0, VISIBLE).map((t) => (
            <li key={t.trendId} className="border-b border-border last:border-b-0">
              <Link
                href="/discovery"
                className="block px-5 py-3 transition-colors hover:bg-surface-muted"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{t.topic}</span>
                  <span className="shrink-0 text-[12.5px] tabular-nums text-ink-muted">
                    {Math.round(t.opportunity * 100)}% left
                  </span>
                </div>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-border">
                  <span
                    className="block h-full rounded-full bg-brand-pink"
                    style={{ width: `${Math.max(2, Math.round(t.opportunity * 100))}%` }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
