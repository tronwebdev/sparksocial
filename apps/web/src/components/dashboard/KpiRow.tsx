'use client';

import { cn } from '@/lib/utils';
import { compactNumber } from '@/lib/relativeTime';
import type { BrandSeries } from './types';

/**
 * The cockpit's KPI row (`DASH-B-01`, M1) — three cards, each a number and how
 * it moved.
 *
 * ── The delta is the whole design, and it is the part that can lie ─────────
 *
 * The prototype shows a green arrow and a percentage on every card. A dashboard
 * that always shows a delta has to invent one when there is nothing to compare
 * against, and the two usual inventions are both bad: `+100%` (growth from
 * nothing, which is not a percentage) and `0%` (no change, which is a claim about
 * a period that did not happen). So `analytics.brand_series` returns null in that
 * case and this renders "no comparison yet" — one row of the design that is
 * missing on purpose rather than filled with a number nobody should read.
 *
 * ── Why the last day is understated ───────────────────────────────────────
 *
 * Grouped by publication date, so a post published this morning contributes its
 * first few hours against a week where everything else has had days. `maturing`
 * counts those, and the note says so, because otherwise a good week that ends
 * with a fresh post reads as a collapse.
 */

export function KpiRow({ series }: { series: BrandSeries }) {
  const cards = [
    {
      label: 'Impressions',
      value: compactNumber(series.totals.impressions),
      changePct: series.impressionsChangePct,
      before: series.previous.impressions,
    },
    {
      label: 'Engagements',
      value: compactNumber(series.totals.engagements),
      changePct: series.engagementsChangePct,
      before: series.previous.engagements,
      hint: 'likes, comments, shares and saves',
    },
    {
      label: 'Posts published',
      value: String(series.totals.posts),
      // Computed here rather than returned, because a post count is small enough
      // that the absolute change is more informative than a percentage: "3, up
      // from 2" says more than "+50%".
      changePct: null,
      before: series.previous.posts,
      absolute: series.totals.posts - series.previous.posts,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[13px] font-medium text-ink-muted">{c.label}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <span className="text-[28px] font-semibold tabular-nums leading-none text-ink">{c.value}</span>
            <Delta changePct={c.changePct} absolute={c.absolute} before={c.before} />
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            {c.hint ? `${c.hint} · ` : ''}last {series.windowDays} days
          </p>
        </div>
      ))}
    </div>
  );
}

function Delta({
  changePct,
  absolute,
  before,
}: {
  changePct: number | null;
  absolute?: number;
  before: number;
}) {
  // An absolute change of zero is a real answer ("the same as last week"); a
  // percentage of null is not, and says so.
  if (absolute !== undefined) {
    if (before === 0 && absolute === 0) return <Muted>nothing either week</Muted>;
    if (absolute === 0) return <Muted>same as the week before</Muted>;
    return (
      <span className={cn('text-[13px] font-medium', absolute > 0 ? 'text-success' : 'text-warn')}>
        {absolute > 0 ? '+' : '−'}
        {Math.abs(absolute)} on the week before
      </span>
    );
  }

  if (changePct === null) return <Muted>no comparison yet</Muted>;
  if (changePct === 0) return <Muted>flat on the week before</Muted>;

  return (
    <span className={cn('text-[13px] font-medium', changePct > 0 ? 'text-success' : 'text-warn')}>
      {changePct > 0 ? '↑' : '↓'} {Math.abs(changePct)}%
    </span>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] text-ink-muted">{children}</span>;
}
