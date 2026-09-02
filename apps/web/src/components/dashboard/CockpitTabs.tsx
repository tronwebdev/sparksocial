'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <Empty
        title="Nothing scheduled"
        body="Activate a campaign and SPARK fills the calendar. Posts appear here as their slots are placed."
        href="/calendar"
        cta="Open Calendar"
      />
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-px">
        {posts.map((p) => (
          <li key={p.contentItemId} className="border-b border-border py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">
                  {/* The slot's own time, in words. An absolute date is the wrong
                      unit here — "in 2 days" is what tells you whether you have
                      time to change it. */}
                  {p.scheduledAt ? relativeTime(p.scheduledAt) : 'Not scheduled yet'}
                  <span className="ml-2 font-normal text-ink-muted">{p.playbookName}</span>
                </p>
                <p className="mt-0.5 truncate text-[13px] text-ink-muted">{p.summary}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* "no account chosen" is a real state — `calendar.generate`
                    places the slot and leaves the platform to the slot's own
                    choice — so it says that rather than showing nothing. */}
                <Badge variant="neutral">
                  {p.platform ? platformLabel(p.platform) : 'no account chosen'}
                </Badge>
                <Link
                  href={`/agents?draft=${encodeURIComponent(p.contentItemId)}`}
                  className="text-[13px] font-medium text-brand-purple underline underline-offset-2"
                >
                  View
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/calendar">Open Calendar</Link>
        </Button>
      </div>
    </div>
  );
}

/* ── Performance Insights ────────────────────────────────────────────────── */

function Insights({ series }: { series: BrandSeries | null }) {
  if (!series || series.totals.posts === 0) {
    return (
      <Empty
        title="Nothing published yet"
        body="Performance appears once posts have gone out and their first metrics have come back."
        href="/calendar"
        cta="Open Calendar"
      />
    );
  }

  const peak = Math.max(1, ...series.days.map((d) => d.impressions));

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div>
        <p className="text-[13px] font-medium text-ink-muted">Impressions</p>
        <p className="mt-1 text-[30px] font-semibold tabular-nums leading-none text-ink">
          {compactNumber(series.totals.impressions)}
        </p>

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
            <li key={d.date} className="flex-1 text-center text-[11px] text-ink-muted">
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
        <p className="text-[13px] font-medium text-ink-muted">By platform</p>
        {series.byPlatform.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-muted">
            No platform has reported numbers for this window yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3.5">
            {series.byPlatform.map((p) => (
              <li key={p.platform}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] text-ink">{platformLabel(p.platform)}</span>
                  <span className="text-[14px] font-medium tabular-nums text-ink">
                    {compactNumber(p.impressions)}
                  </span>
                </div>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border">
                  <span
                    className="block h-full rounded-full bg-brand-cyan"
                    style={{ width: `${Math.round(p.share * 100)}%` }}
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
      <Empty
        title="No leads raised yet"
        body="When someone in the inbox sounds like a customer, SPARK raises them here with a recommended next step."
        href="/engagement"
        cta="Open the inbox"
      />
    );
  }

  return (
    <div>
      <p className="text-[15px] font-medium text-ink">
        {total} sales {total === 1 ? 'opportunity' : 'opportunities'}
      </p>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        People showing buying intent, raised from your inbox.
      </p>

      <ul className="mt-4 flex flex-col">
        {leads.map((lead) => {
          const temp = TEMPERATURE[lead.temperature];
          return (
            <li key={lead.opportunityId} className="border-b border-border py-3.5 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-2 text-[14px]">
                    <span className="font-medium text-ink">
                      {lead.authorName ?? lead.authorHandle ?? 'Unknown sender'}
                    </span>
                    {lead.authorHandle && lead.authorName ? (
                      <span className="text-[13px] text-ink-muted">{lead.authorHandle}</span>
                    ) : null}
                    {lead.platform ? (
                      <span className="text-[13px] text-ink-muted">on {platformLabel(lead.platform)}</span>
                    ) : null}
                  </p>
                  {lead.messageText ? (
                    <p className="mt-1 truncate text-[13px] text-ink-muted">“{lead.messageText}”</p>
                  ) : null}
                  {/* The recommended action is the reason the row exists — a lead
                      with no next step is just a name. */}
                  <p className="mt-1 text-[13px] text-ink">{lead.recommendedAction}</p>
                  {lead.routedTo ? (
                    <p className="mt-1 text-[12px] text-ink-muted">Sent to {lead.routedTo}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge variant={temp.variant}>{temp.label}</Badge>
                  <span className="text-[12px] tabular-nums text-ink-muted">
                    {relativeTime(lead.raisedAt)}
                  </span>
                  <Button asChild size="sm" className="mt-1">
                    <Link href="/engagement">Engage</Link>
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {total > leads.length ? (
        <p className="mt-4 text-[13px] text-ink-muted">
          Showing {leads.length} of {total}.{' '}
          <Link
            href="/engagement"
            className="font-medium text-brand-purple underline underline-offset-2"
          >
            View all opportunities
          </Link>
        </p>
      ) : (
        <div className="mt-4">
          <Link
            href="/engagement"
            className="text-[13px] font-medium text-brand-purple underline underline-offset-2"
          >
            View all opportunities
          </Link>
        </div>
      )}
    </div>
  );
}

function Empty({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="py-4">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-prose text-[13px] text-ink-muted">{body}</p>
      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}
