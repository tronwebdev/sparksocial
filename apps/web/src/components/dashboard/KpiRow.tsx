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
      changePct: series.changePct.impressions,
      before: series.previous.impressions,
    },
    {
      label: 'Engagements',
      value: compactNumber(series.totals.engagements),
      changePct: series.changePct.engagements,
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
    /*
      270x107 at radius 15, on a tint rather than a bordered white card - the
      prototype gives the three cards `rgba(108,232,255,0.3)`,
      `rgba(163,65,255,0.2)` and `rgba(254,222,181,0.5)` in that order, and no
      border at all. The 288px pitch (356, 644, 932) is 270 plus an 18px gutter.

      `h-[107px]`, not `min-h-`: with a `pb-4` under it the card measured
      111.8, so the design's 107 became a floor nothing sat on and the whole
      left column below - activity feed, tab card - ran 5px low. The design's
      interior is the label at 15 (22 tall) and the value at 50 (44.8 tall),
      leaving 12 under it, which is exactly the 15/13 top offsets with no
      bottom padding. `flex-wrap` came off the value row for the same reason:
      a wrap grows a card that no longer has room to grow.

      The prototype's second card is "CTA Clicks", which `analytics.brand_series`
      does not carry - there is no click field on it. Rather than leave a card
      showing nothing, the three real metrics keep the three tints in position
      order; the tint belongs to the slot, not the metric.
    */
    <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-3">
      {cards.map((c, i) => (
        <div
          key={c.label}
          className={cn('relative h-dash-kpi rounded-lg px-[21px] pt-[15px]', TINTS[i % TINTS.length])}
        >
          <p className="text-18 font-medium leading-[1.28] text-ink-muted">{c.label}</p>
          <div className="mt-[13px] flex items-center gap-3">
            <span className="text-[35px] font-semibold leading-[1.28] tabular-nums text-ink">{c.value}</span>
            <Delta changePct={c.changePct} absolute={c.absolute} before={c.before} />
          </div>
          {/*
            No caption. The design's card is three things - label, value, delta
            pill - and the window is stated once on the Performance Insights tab
            ("Impressions · last 7 days") rather than three times here. The
            `hint` that used to ride along with it (the maturing-posts caveat)
            travels with the chart on that tab, which is where it can be read
            next to the bars it explains.
          */}
        </div>
      ))}
    </div>
  );
}

/**
 * The prototype's three card tints, in its own order — now `bg-kpi-*` utilities
 * over `--ss-dash-kpi-*` rather than three rgba literals in an inline style.
 * CLAUDE.md's rule: exact values go in `tokens.css`/`tailwind.config.ts`, not in
 * a component.
 */
const TINTS = ['bg-kpi-1', 'bg-kpi-2', 'bg-kpi-3'] as const;

/**
 * The 90x36 white pill at radius 11.59 with a `rgba(12,12,12,0.1)` ring: the
 * sign in 17px/500 coloured, the number in 18px/500 ink, and an arrow.
 *
 * `−`/`+` are the prototype's own glyphs - it uses U+2212 for the minus, not a
 * hyphen, which at 17px is a visibly different width.
 */
function Pill({ up, children, title }: { up: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-9 items-center gap-[3px] rounded-[11.59px] bg-white px-[9px]"
      style={{ boxShadow: 'inset 0 0 0 0.77px rgba(12,12,12,0.1)' }}
    >
      <span className="text-[17px] font-medium leading-none" style={{ color: up ? '#13D711' : '#F35525' }}>
        {up ? '+' : '\u2212'}
      </span>
      <span className="text-18 font-medium leading-[1.28] text-ink">{children}</span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="ml-[3px]">
        <path
          d={up ? 'M3 9.5 7 5l4 4.5' : 'M3 4.5 7 9l4-4.5'}
          stroke={up ? '#13D711' : '#F35525'}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * The card always shows a pill, which is a position I argued against and was
 * wrong about.
 *
 * The old rule was: no delta unless there is a real one, because `+100%` is not
 * a percentage and `0%` is a claim about a period that did not happen. The first
 * half still holds. The second does not - when the previous window exists and
 * was also zero, "0%" is simply true, and three cards reading "no comparison
 * yet" in place of the design's pills is a worse screen than three honest
 * zeroes.
 *
 * What survives of the caution is the `title`: where there is genuinely nothing
 * to compare against, the pill says 0% and hovering says why. The fact stays
 * reachable without a sentence where a 90px pill goes.
 */
function Delta({
  changePct,
  absolute,
  before,
}: {
  changePct: number | null;
  absolute?: number;
  before: number;
}) {
  if (absolute !== undefined) {
    const flat = absolute === 0;
    return (
      <Pill
        up={absolute >= 0}
        title={
          before === 0 && flat
            ? 'Nothing either week, so there is no change to report.'
            : flat
              ? 'The same as the week before.'
              : undefined
        }
      >
        {Math.abs(absolute)}
      </Pill>
    );
  }

  return (
    <Pill
      up={(changePct ?? 0) >= 0}
      title={
        changePct === null
          ? 'No previous week to compare against yet, so this reads as no change.'
          : changePct === 0
            ? 'Flat on the week before.'
            : undefined
      }
    >
      {Math.abs(changePct ?? 0)}%
    </Pill>
  );
}
