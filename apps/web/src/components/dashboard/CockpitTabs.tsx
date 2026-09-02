'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyCard } from '@/components/common/EmptyCard';
import { platformLabel } from '@/lib/platforms';
import { compactNumber, relativeTime } from '@/lib/relativeTime';
import { cn } from '@/lib/utils';
import type { BrandSeries, Lead, UpcomingPost } from './types';

/**
 * The cockpit's three-tab card — the prototype's "Upcoming Contents /
 * Performance Insights / Sales Opportunities" (`DASH-B-01`, M1). Its labels,
 * verbatim.
 *
 * One card with three tabs rather than three stacked panels, because that is what
 * the design does and because the three answer the same question at different
 * ranges: what is about to happen, what happened, and who is waiting on a person.
 */

type Tab = 'upcoming' | 'insights' | 'sales';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'upcoming', label: 'Upcoming Contents' },
  { id: 'insights', label: 'Performance Insights' },
  { id: 'sales', label: 'Sales Opportunities' },
];

export function CockpitTabs({
  upcoming,
  series,
  leads,
  leadCounts,
}: {
  upcoming: UpcomingPost[];
  series: BrandSeries | null;
  leads: Lead[];
  leadCounts: { hot: number; warm: number; cold: number };
}) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const openLeads = leadCounts.hot + leadCounts.warm;

  /*
    The chip is drawn behind the active label, so its box comes from that
    label's own layout rather than a table of hardcoded widths - `Sales
    Opportunities` grows by a count badge, and a fixed 206px would clip it.
  */
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [chip, setChip] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const el = labelRefs.current[tab];
    if (!el?.offsetParent) return;
    const PAD = 17;
    setChip({ left: el.offsetLeft - PAD, width: el.offsetWidth + PAD * 2 });
  }, [tab, openLeads]);

  return (
    /*
      The card is plain white at radius 15 - no border. Its tab row is not three
      buttons with their own backgrounds: it is one 51px chip at radius 10 on
      `#F7F7F7` with a `rgba(12,12,12,0.1)` ring, sitting *behind* whichever
      label is active, and three 18px/500 labels at a 44px gap over the top.
      Active is `#0C0C0C`, inactive `#838383`, and the row is closed by a
      `rgba(131,131,131,0.2)` hairline at y=80.

      One chip that moves rather than three that toggle, for the same reason the
      sidebar glow is one element: it is what produces the slide between tabs.
      The prototype hardcodes the chip's box per tab (11/202, 218/216, 438/206);
      here it is measured off the active label so it stays correct at any font
      metric, with 17px of padding either side - the mean of the prototype's
      three, which are 17, 17 and 18.
    */
    <section className="rounded-lg bg-white">
      <div
        role="tablist"
        aria-label="Cockpit panels"
        className="relative flex flex-wrap items-center gap-x-11 gap-y-2 px-7 pb-[15px] pt-[29px]"
        style={{ borderBottom: '1px solid rgba(131,131,131,0.2)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              labelRefs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative z-10 flex items-center gap-2 bg-transparent text-18 font-medium leading-[1.28] transition-colors',
              tab === t.id ? 'text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.id === 'sales' && openLeads > 0 ? (
              <span className="rounded-full bg-warn/15 px-1.5 text-[12px] font-semibold tabular-nums text-warn">
                {openLeads}
              </span>
            ) : null}
          </button>
        ))}

        {/*
          The design puts an info glyph at the row's right edge (x=803 of 846),
          which this header did not have. `ml-auto` rather than an absolute x, so
          it stays at the edge whatever the tab labels measure.
        */}
        <span
          title="What your agent has lined up, how the last week performed, and who is showing buying intent."
          className="relative z-10 ml-auto flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
          style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
        >
          i
        </span>

        {chip ? (
          <span
            aria-hidden
            /* radius 10, not `rounded-lg` - that token is 15px here, which is
               the *card's* radius, not the chip's. */
            className="pointer-events-none absolute top-[14px] h-[51px] rounded-[10px] transition-[left,width] duration-200 ease-shell motion-reduce:transition-none"
            style={{
              left: chip.left,
              width: chip.width,
              background: '#F7F7F7',
              boxShadow: 'inset 0 0 0 1.28px rgba(12,12,12,0.1)',
            }}
          />
        ) : null}
      </div>

      <div className="p-5">
        {tab === 'upcoming' ? <Upcoming posts={upcoming} /> : null}
        {tab === 'insights' ? <Insights series={series} /> : null}
        {tab === 'sales' ? <Sales leads={leads} counts={leadCounts} /> : null}
      </div>
    </section>
  );
}

/* ── Upcoming Contents ───────────────────────────────────────────────────── */

function Upcoming({ posts }: { posts: UpcomingPost[] }) {
  if (posts.length === 0) {
    return (
      <EmptyCard body={<>Create your first campaign to get started and view upcoming contents</>} />
    );
  }

  return (
    /*
      89px rows on the prototype's own grid: the slot's time at 20px/600 with
      "Confidence" beneath it at 16px/400, a 127x80 media well at x=225, the
      platform at x=450 in 18px/500, and View at x=748 with its chevron - over
      `rgba(131,131,131,0.1)` hairlines. Row type was 14px and 13px before,
      which is the size this list uses in the *draft panel*, not here.
    */
    <div>
      <ul className="flex flex-col">
        {posts.map((p, i) => (
          <li
            key={p.contentItemId}
            className={i < posts.length - 1 ? 'border-b' : undefined}
            style={i < posts.length - 1 ? { borderColor: 'rgba(131,131,131,0.1)' } : undefined}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-[11px]">
              <div className="min-w-0 flex-1">
                <p className="text-20 font-semibold leading-[1.28] text-ink">
                  {/* The slot's own time, in words. An absolute date is the wrong
                      unit here — "in 2 days" is what tells you whether you have
                      time to change it. */}
                  {p.scheduledAt ? relativeTime(p.scheduledAt) : 'Not scheduled yet'}
                </p>
                <p className="mt-[9px] truncate text-16 text-ink-muted">{p.summary}</p>
              </div>

              {/*
                The 127x80 media well. `content.list` carries `mediaType` but no
                URL, so it names the medium instead of showing a still that is
                not the post's - the same gap the rail has, and the same field
                (`mediaUrl` on `ContentListItem`) would close both.
              */}
              <div
                className="flex h-20 w-[127px] shrink-0 items-center justify-center rounded-md text-[12px] text-ink-muted"
                style={{ background: 'rgba(131,131,131,0.1)' }}
              >
                {p.mediaType ?? 'text'}
              </div>

              <div className="flex w-[150px] shrink-0 items-center">
                {/* "no account chosen" is a real state — `calendar.generate`
                    places the slot and leaves the platform to the slot's own
                    choice — so it says that rather than showing nothing. */}
                <span className="text-18 font-medium text-ink">
                  {p.platform ? platformLabel(p.platform) : 'no account chosen'}
                </span>
              </div>

              <Link
                href={`/agents?draft=${encodeURIComponent(p.contentItemId)}`}
                className="flex shrink-0 items-center gap-[11px] text-16 font-medium text-ink-muted transition-colors hover:text-ink"
              >
                View
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
                  <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {/* 134.3x39 at radius 8.29, `rgba(163,65,255,0.1)` inside a 1.06px
          `#A341FF` ring - an outlined purple button, not the shell's default. */}
      <div className="mt-4 flex justify-end">
        {/* 134.3x39 at radius 8.29 - a fixed box, not padding-sized. The
            label is 14.92px/500, which at `px-4` made the button 118px. */}
        <Link
          href="/calendar"
          className="flex h-[39px] w-[134.3px] items-center justify-center rounded-lg text-[14.92px] font-medium"
          style={{ background: 'rgba(163,65,255,0.1)', boxShadow: 'inset 0 0 0 1.06px #A341FF', color: '#A341FF' }}
        >
          Open Calendar
        </Link>
      </div>
    </div>
  );
}

function Insights({ series }: { series: BrandSeries | null }) {
  if (!series || series.totals.posts === 0) {
    return (
      <EmptyCard body={<>Create your first campaign to get started and see how it performs</>} />
    );
  }

  const peak = Math.max(1, ...series.days.map((d) => d.impressions));

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div>
        {/* "Impressions · last 7 days" at 16px/500 grey, the figure at 32px/600,
            and the delta chip beside it - a 26px pill at radius 8 on `#E7FAE7`
            with `#0E9E0C` text in 14px/600. The chip was missing entirely. */}
        <p className="text-16 font-medium text-ink-muted">
          Impressions &middot; last {series.windowDays} days
        </p>
        <div className="mt-[10px] flex flex-wrap items-center gap-3">
          <p className="text-[32px] font-semibold tabular-nums leading-none text-ink">
            {compactNumber(series.totals.impressions)}
          </p>
          <DeltaChip changePct={series.changePct.impressions} />
        </div>

        {/* A column per day, including empty ones. Bars rather than a line,
            deliberately: a line implies a continuous measurement, and these are
            seven separate day totals grouped by when each post was published —
            see `analytics.brand_series` on why a real time series is not
            available. Drawing a smooth curve over discrete buckets would be the
            chart claiming to know something it does not. */}
        <ul className="mt-5 flex h-32 items-end gap-1.5" aria-hidden>
          {series.days.map((d) => (
            <li key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1.5">
              <span
                className="w-full rounded-t bg-brand-purple/70"
                style={{ height: `${Math.max(2, Math.round((d.impressions / peak) * 100))}%` }}
              />
            </li>
          ))}
        </ul>
        <ul className="mt-1.5 flex gap-1.5">
          {series.days.map((d) => (
            <li key={d.date} className="flex-1 text-center text-[13px] text-ink-muted">
              {/* Weekday initial only — seven `YYYY-MM-DD` labels do not fit and
                  a truncated date is worse than a day letter. */}
              {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-US', {
                weekday: 'short',
                timeZone: 'UTC',
              })}
            </li>
          ))}
        </ul>

        {/* The caveat travels with the chart, because the last bar is always the
            shortest for a reason that has nothing to do with performance. */}
        {series.maturing > 0 ? (
          <p className="mt-4 text-[12px] text-ink-muted">
            {series.maturing} of these {series.maturing === 1 ? 'was' : 'were'} published in the last two
            days and {series.maturing === 1 ? 'is' : 'are'} still gaining, so the most recent days read
            low.
          </p>
        ) : null}
        {series.unmeasured > 0 ? (
          <p className="mt-1.5 text-[12px] text-ink-muted">
            {series.unmeasured} post{series.unmeasured === 1 ? '' : 's'} {series.unmeasured === 1 ? 'has' : 'have'}{' '}
            no numbers back from the platform yet, and {series.unmeasured === 1 ? 'counts' : 'count'} as zero
            here.
          </p>
        ) : null}
      </div>

      <div>
        {/* 16px/600 ink, not muted - it is a column heading, and the prototype
            weights it like one. Rows are 44px on a 55px pitch: name at 15px/500,
            value at 15px/600, and a 6px bar at radius 3 on `#EFEFEF` filled with
            the cyan-to-purple sweep rather than flat cyan. */}
        <p className="text-16 font-semibold text-ink">By platform</p>
        {series.byPlatform.length === 0 ? (
          <p className="mt-3 text-[15px] text-ink-muted">
            No platform has reported numbers for this window yet.
          </p>
        ) : (
          <ul className="mt-[14px] flex flex-col gap-[11px]">
            {series.byPlatform.map((p) => (
              <li key={p.platform}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium text-ink">{platformLabel(p.platform)}</span>
                  <span className="text-[15px] font-semibold tabular-nums text-ink">
                    {compactNumber(p.impressions)}
                  </span>
                </div>
                <span
                  className="mt-[9px] block h-[6px] overflow-hidden rounded-[3px]"
                  style={{ background: '#EFEFEF' }}
                >
                  <span
                    className="block h-full rounded-[3px]"
                    style={{
                      width: `${Math.round(p.share * 100)}%`,
                      background: 'linear-gradient(90deg,#6CE8FF,#A341FF)',
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── Sales Opportunities ─────────────────────────────────────────────────── */

/**
 * The prototype's own chip fills, which are not the shared `Badge` variants: a
 * 24px pill at radius 12 with `#E7FAE7`/`#0E9E0C` for high intent and
 * `#FDE9E2`/`#D2470F` for warm, in 13px/600. Cold has no chip in the design -
 * every row it draws is high or warm - so it reuses warm's shape in grey rather
 * than inventing a third fill.
 */
const CHIP: Record<Lead['temperature'], { bg: string; fg: string }> = {
  hot: { bg: '#E7FAE7', fg: '#0E9E0C' },
  warm: { bg: '#FDE9E2', fg: '#D2470F' },
  cold: { bg: 'rgba(131,131,131,0.14)', fg: '#5B5B5B' },
};

/** The initials well behind each avatar, tinted per row as the prototype does. */
const AVATAR_TINTS = [
  { bg: 'rgba(245,107,255,0.16)', fg: '#C23BD6' },
  { bg: 'rgba(108,232,255,0.22)', fg: '#1596B0' },
  { bg: 'rgba(163,65,255,0.16)', fg: '#8B33D6' },
  { bg: 'rgba(243,85,37,0.14)', fg: '#C4451A' },
] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const TEMPERATURE: Record<Lead['temperature'], { label: string; variant: 'success' | 'warn' | 'neutral' }> = {
  // The prototype's own words: "High intent" and "Warm".
  hot: { label: 'High intent', variant: 'success' },
  warm: { label: 'Warm', variant: 'warn' },
  cold: { label: 'Cold', variant: 'neutral' },
};

function Sales({ leads, counts }: { leads: Lead[]; counts: { hot: number; warm: number; cold: number } }) {
  const total = counts.hot + counts.warm + counts.cold;

  if (total === 0) {
    return (
      <EmptyCard body={<>Create your first campaign to get started and see who is showing buying intent</>} />
    );
  }

  return (
    /*
      The prototype's row: a 46px tinted initials well with the platform badged
      onto its corner, the name at 17px/600 with the handle beside it at
      14px/400, the quote beneath at 15px/400, then the intent chip and time
      right-aligned and an 88x36 black Engage button. Rows are 52px tall over
      `rgba(131,131,131,0.12)` hairlines, and the heading is 20px/600.

      Everything here was 13-15px before, which is the draft panel's scale.
    */
    <div>
      <p className="text-20 font-semibold text-ink">
        {total} sales {total === 1 ? 'opportunity' : 'opportunities'}
      </p>
      <p className="mt-[10px] text-[15px] text-ink-muted">
        Leads showing buying intent, flagged by your agent this week.
      </p>

      <ul className="mt-[14px] flex flex-col">
        {leads.map((lead, i) => {
          const temp = TEMPERATURE[lead.temperature];
          const chip = CHIP[lead.temperature];
          const tint = AVATAR_TINTS[i % AVATAR_TINTS.length]!;
          const who = lead.authorName ?? lead.authorHandle ?? 'Unknown sender';
          return (
            <li
              key={lead.opportunityId}
              className={i < leads.length - 1 ? 'border-b' : undefined}
              style={i < leads.length - 1 ? { borderColor: 'rgba(131,131,131,0.12)' } : undefined}
            >
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3 py-[14px]">
                <span className="relative block h-[46px] w-[46px] shrink-0">
                  <span
                    className="flex h-full w-full items-center justify-center rounded-full text-[15px] font-semibold"
                    style={{ background: tint.bg, color: tint.fg }}
                  >
                    {initials(who)}
                  </span>
                  {lead.platform ? (
                    <span
                      className="absolute -bottom-[4px] -right-[4px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white text-[9px] font-semibold uppercase text-ink"
                      style={{ boxShadow: '0 0 0 2px #FFFFFF' }}
                    >
                      {platformLabel(lead.platform).slice(0, 2)}
                    </span>
                  ) : null}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[17px] font-semibold text-ink">{who}</span>
                    {lead.authorHandle && lead.authorName ? (
                      <span className="text-14 text-ink-muted">{lead.authorHandle}</span>
                    ) : null}
                  </p>
                  {lead.messageText ? (
                    <p className="mt-[6px] truncate text-[15px] text-ink-muted">
                      &ldquo;{lead.messageText}&rdquo;
                    </p>
                  ) : null}
                  {/* The recommended action is the reason the row exists — a lead
                      with no next step is just a name. Not in the prototype's
                      row, and the row is the wrong place to drop it. */}
                  <p className="mt-[6px] text-[15px] text-ink">{lead.recommendedAction}</p>
                  {lead.routedTo ? (
                    <p className="mt-[4px] text-[13px] text-ink-muted">Sent to {lead.routedTo}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-start gap-[8px]">
                  <span
                    className="flex h-6 items-center rounded-xl px-2.5 text-[13px] font-semibold"
                    style={{ background: chip.bg, color: chip.fg }}
                  >
                    {temp.label}
                  </span>
                  <span className="text-[13px] tabular-nums text-ink-muted">
                    {relativeTime(lead.raisedAt)}
                  </span>
                </div>

                <Link
                  href="/engagement"
                  className="flex h-9 w-[88px] shrink-0 items-center justify-center rounded-[9px] bg-ink text-14 font-semibold text-white"
                >
                  Engage
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 15px/600 `#A341FF` with a chevron, at the card's bottom left. */}
      <div className="mt-4 flex items-center gap-[7px]">
        <Link href="/engagement" className="text-[15px] font-semibold" style={{ color: '#A341FF' }}>
          View all opportunities
        </Link>
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
          <path d="m1 1 5 5-5 5" stroke="#A341FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {total > leads.length ? (
          <span className="ml-1 text-[13px] text-ink-muted">
            showing {leads.length} of {total}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The prototype's `+16%` pill: 26px tall at radius 8, `#E7FAE7` behind
 * `#0E9E0C` in 14px/600, with an arrow.
 *
 * Nothing renders when there is no comparison, for the same reason `KpiRow`
 * drops its pill: the shape is sign-arrow-number, and there is no sign for
 * "we do not know" that would not be read as a direction. A dashboard that
 * always shows a delta has to invent one.
 */
function DeltaChip({ changePct }: { changePct: number | null }) {
  if (changePct === null || changePct === 0) return null;
  const up = changePct > 0;
  return (
    <span
      className="flex h-[26px] items-center gap-1 rounded-lg px-[9px] text-14 font-semibold"
      style={{ background: up ? '#E7FAE7' : '#FDE9E2', color: up ? '#0E9E0C' : '#D2470F' }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d={up ? 'M2.5 8 6 4l3.5 4' : 'M2.5 4 6 8l3.5-4'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {up ? '+' : '\u2212'}
      {Math.abs(changePct)}%
    </span>
  );
}

