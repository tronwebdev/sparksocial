'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { WhyPopover } from '@/components/explain/WhyPopover';
import { cn } from '@/lib/utils';

export interface RankedTrendItem {
  trendId: string;
  source: string;
  topic: string;
  score: number;
  relevance: number;
  opportunity: number;
  metrics: { volume: number; velocity: number; saturation: number; growth: number };
  factors: Array<{ label: string; detail: string; weight?: number }>;
  /** Set where the source returned an image in the response it was already making. */
  media?: { url: string; kind: 'image' | 'video' };
  samples: Array<{ url: string; caption?: string }>;
  tags: string[];
  /**
   * Where the trend is trending, largest first. `volume` is absent when the
   * vendor's figure is global rather than per-region — YouTube's view count is
   * the same number whichever country's chart returned it, and summing those
   * per region invented a number nobody reported.
   *
   * The card does not draw this; it carries it so the detail screen can render
   * the breakdown without re-fetching every region (see `TrendDetail`).
   */
  regions: Array<{ code: string; volume?: number }>;
  /** Set on a trend `trend.rank` excluded — why it was skipped. */
  because?: string;
}

export interface WatchlistTrendItem {
  trendId: string;
  source: string;
  topic: string;
  note?: string;
  createdAt: string;
}

interface RepurposeSuggestion {
  playbookId: string;
  playbookName: string;
  pillar: string;
  intent: string;
  unlockable: boolean;
  missingRoles: string[];
}

/**
 * One trend card — `SparkSocial Discovery.dc.html`, the 3-up grid.
 *
 *   card       h470, radius 18, `inset 0 0 0 1px rgba(131,131,131,.18)`, white
 *   title      20,22        21px/700
 *   velocity   right 16 / top 16, h36 r9, px12, 14.5px/600 in a
 *              `rgba(131,131,131,.3)` ring
 *   strip      top 66, full width, h44, a 1px `rgba(131,131,131,.15)` line
 *              above and below, four flex cells (1.05 / 1.15 / 0.95 / 1.35)
 *              divided by 1px rules — Vol, the window, Accel, Saturation, all
 *              14.5px
 *   media      16,126 to right 16, h270, radius 12
 *   footer     left 16 / bottom 16 / right 16, gap 10 — Open Detail on
 *              `#0C0C0C` h42 r10, Re-purpose with the cyan→purple star,
 *              Re-share, then a 42x42 bookmark on `margin-left:auto`
 *
 * ── The three places real data and the prototype part ────────────────────
 *
 * **The media well.** The design draws five variants — an image pair, a video
 * with a play badge, a tile collage, a banner, and a text block. This rendered
 * the text one for every trend, because `trend.rank`'s output schema had no
 * image field: the sources fetch thumbnails, `toOutput` dropped them. That is
 * fixed at the tool (`Trend.media`, filled from responses the sources were
 * already making), so the well now renders:
 *
 *   video   the thumbnail, cover-fit, with the design's centred 44px play badge
 *   image   the thumbnail, cover-fit
 *   text    the ranking argument — the weighted factors in the design's
 *           18px/700-over-14.5px type
 *
 * The text variant is still the fallback rather than an empty frame, because
 * two sources have no image at any price (Hacker News, and Pinterest's
 * growing-keywords endpoint) and a thumbnail can 404 at render time. It is
 * also what a card shows after Re-purpose answers. PRD §7.3 names trend
 * selection first among the decisions that must be explainable, so the
 * argument stays one click away on every card via `WhyPopover`.
 *
 * **Re-share.** `trend.reshare` exists — I had this disabled on the claim that
 * it did not. It is not "repost someone else's post": it takes a
 * `contentItemId` and reframes one of *this brand's own* posts around the
 * trend, reusing that post's playbook and assets. It needs a post chosen
 * first, which is a screen (`ReshareModal`), which is why the button hands
 * upward instead of calling the tool itself.
 *
 * **The window cell.** The design reads "7d +31%". `metrics.growth` is real but
 * its window is the source's, not a fixed 7 days, so the cell says "+31% growth"
 * without inventing the period.
 *
 * Open Detail, Re-purpose and the bookmark are all real: `TrendDetail`,
 * `trend.repurpose` (read-only by design — see that tool's comment) and
 * `trend.watchlist`.
 *
 * ── Skipped trends ────────────────────────────────────────────────────────
 *
 * A trend `trend.rank` excluded renders as the same card with `because` set: a
 * ring in `#F35525` at 35%, an amber "Skipped" chip carrying the reason, and
 * every action still live. The user disagreeing with a rejection is exactly the
 * case the screen has to serve — the ranker's judgement is a default, not a
 * lock — and it cannot be served by a line of text under the grid.
 */

/**
 * Adapter name → the name a person would write.
 *
 * A trend's `source` is the adapter's own id (`youtube`, `x`, `google`), which
 * is right for code and wrong on a button — "Mute youtube" is not how anyone
 * spells it. Shared by the rail and the detail screen so the two cannot
 * disagree; an adapter this does not know renders under its own name rather
 * than being hidden.
 */
export const SOURCE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  hackernews: 'Hacker News',
  producthunt: 'Product Hunt',
  tiktok: 'TikTok',
  x: 'X / Twitter',
  google: 'Google Trends',
  stub: 'Sample set',
};

export const sourceLabel = (name: string): string => SOURCE_LABELS[name] ?? name;

/** 42k, 1.2M — the design's compact volumes. */
export function compactVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** The design has three words here; `saturation` is a 0..1 ratio. */
export function saturationWord(saturation: number): 'Low' | 'Med' | 'HIGH' {
  if (saturation >= 0.6) return 'HIGH';
  if (saturation >= 0.3) return 'Med';
  return 'Low';
}

const CELL = 'flex items-center justify-center whitespace-nowrap text-center text-[14.5px]';
const DIVIDER = 'h-full w-px shrink-0 bg-[rgba(131,131,131,0.15)]';
const GHOST_BTN =
  'flex h-[42px] shrink-0 items-center gap-[8px] whitespace-nowrap rounded-[10px] bg-white px-[13px] text-[14.5px] font-semibold text-ink transition-shadow';
const GHOST_RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' } as const;

export function TrendCard({
  trend,
  genomeId,
  watched: watchedInitially = false,
  onWatchChanged,
  onOpen,
  onViewMedia,
  onRepurpose,
  onReshare,
}: {
  trend: RankedTrendItem;
  genomeId: string;
  /** Whether this trend is already on the watchlist, when the caller knows. */
  watched?: boolean;
  onWatchChanged?: (trendId: string, watched: boolean) => void;
  /** Opens `DISC-02` for this trend. Absent where there is nowhere to open into. */
  onOpen?: () => void;
  /** The media viewer — the well and the play badge both call it. */
  onViewMedia?: () => void;
  /** The Re-purpose modal (`346,60 · 1035x900`). */
  onRepurpose?: () => void;
  /** The Re-share composer the prototype only toasts. */
  onReshare?: () => void;
}) {
  const [watching, setWatching] = useState(watchedInitially);
  const [watchBusy, setWatchBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<RepurposeSuggestion | null>(null);
  const [repurposeBusy, setRepurposeBusy] = useState(false);
  const [repurposeError, setRepurposeError] = useState<string | null>(null);
  /** A thumbnail that 404s or is blocked falls back to the text variant. */
  const [mediaFailed, setMediaFailed] = useState(false);

  const velocityPct = Math.round(trend.metrics.velocity * 100);
  const growthPct = Math.round(trend.metrics.growth * 100);
  /**
   * `growth` is 0 for every source that reports one snapshot — YouTube, Reddit,
   * Hacker News and Product Hunt all set it to 0 rather than derive a
   * period-over-period figure they cannot see, and only Pinterest returns a
   * real one. So 0 means "not measured", not "flat", and the strip says so
   * instead of drawing a rising arrow over an unknown.
   */
  const measuredGrowth = trend.metrics.growth !== 0;
  const rising = growthPct > 0;
  const UNMEASURED = 'This source reports one snapshot per fetch, so there is no period-over-period figure to show. Velocity is the early signal here; the detail view has the 14-day series.';

  async function toggleWatch() {
    if (watchBusy) return;
    setWatchBusy(true);
    const action = watching ? 'remove' : 'add';
    const res = await invoke('trend.watchlist', { genomeId, action, trendId: trend.trendId, topic: trend.topic });
    setWatchBusy(false);
    if (res.status !== 'succeeded') return;
    setWatching(!watching);
    onWatchChanged?.(trend.trendId, !watching);
  }

  async function repurpose() {
    if (repurposeBusy) return;
    setRepurposeBusy(true);
    setRepurposeError(null);
    const res = await invoke<{ suggestion: RepurposeSuggestion | null; why: { summary: string } }>(
      'trend.repurpose',
      { genomeId, trendId: trend.trendId },
    );
    setRepurposeBusy(false);
    if (res.status !== 'succeeded') {
      setRepurposeError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setSuggestion(res.output.suggestion);
    if (!res.output.suggestion) setRepurposeError(res.output.why.summary);
  }

  return (
    <li
      className="relative h-disc-trend overflow-hidden rounded-[18px] bg-white"
      style={{
        boxShadow: trend.because
          ? 'inset 0 0 0 1px rgba(243,85,37,0.35)'
          : 'inset 0 0 0 1px rgba(131,131,131,0.18)',
      }}
    >
      {/* The title truncates rather than wrapping — the design pins the strip at
          66, so a second line would run under it. */}
      <p className="absolute left-[20px] right-[150px] top-[22px] truncate text-[21px] font-bold text-ink">
        {trend.topic}
      </p>

      <div
        className="absolute right-4 top-4 flex h-[36px] items-center rounded-[9px] bg-white px-3 text-[14.5px] font-semibold text-ink"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
      >
        Velocity: {velocityPct > 0 ? '+' : ''}
        {velocityPct}%
      </div>

      <div
        className="absolute left-0 top-[66px] flex h-disc-strip w-full items-center"
        style={{
          boxShadow:
            'inset 0 -1px 0 rgba(131,131,131,0.15), inset 0 1px 0 rgba(131,131,131,0.15)',
        }}
      >
        <span className={cn(CELL, 'font-semibold text-ink')} style={{ flex: 1.05 }}>
          Vol: {compactVolume(trend.metrics.volume)}
        </span>
        <div className={DIVIDER} />
        <span
          className={cn(CELL, 'gap-[5px] font-medium text-ink')}
          style={{ flex: 1.15 }}
          title={measuredGrowth ? undefined : UNMEASURED}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="5.6" stroke="#838383" strokeWidth="1.4" />
            <path d="M7 4v3l2 1.4" stroke="#838383" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {measuredGrowth ? `${growthPct > 0 ? '+' : ''}${growthPct}% growth` : 'growth n/a'}
        </span>
        <div className={DIVIDER} />
        <span
          className={cn(CELL, 'font-medium text-ink')}
          style={{ flex: 0.95 }}
          title={measuredGrowth ? undefined : UNMEASURED}
        >
          Accel:&nbsp;
          {measuredGrowth ? (
            <b className="font-bold" style={{ color: rising ? '#13D711' : '#F35525' }}>
              {rising ? '↑' : '↓'}
            </b>
          ) : (
            <b className="font-bold text-ink-muted">–</b>
          )}
        </span>
        <div className={DIVIDER} />
        <span className={cn(CELL, 'font-medium text-ink')} style={{ flex: 1.35 }}>
          Saturation: {saturationWord(trend.metrics.saturation)}
        </span>
      </div>

      {/* The media well — the thumbnail where there is one, the ranking argument
          where there is not, and the re-purpose answer once it arrives. */}
      <div className="absolute left-4 right-4 top-[126px] h-disc-media overflow-hidden rounded-xl">
        {trend.media && !mediaFailed && !suggestion && !repurposeError ? (
          /*
            The well is the click target, not just the badge: a cropped still
            with a play button on it is a control, and it was inert. `group` so
            the badge can respond to a hover anywhere on the image.
          */
          <button
            type="button"
            onClick={onViewMedia}
            disabled={!onViewMedia}
            aria-label={trend.media.kind === 'video' ? `Play ${trend.topic}` : `View the image for ${trend.topic}`}
            className="group block h-full w-full cursor-zoom-in disabled:cursor-default"
          >
            <img
              src={trend.media.url}
              alt=""
              loading="lazy"
              /* Reddit and YouTube both serve thumbnails that 403 when a
                 referrer is attached. */
              referrerPolicy="no-referrer"
              onError={() => setMediaFailed(true)}
              className="h-full w-full rounded-xl object-cover"
            />
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 flex h-[44px] w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-transform group-hover:scale-110"
              style={{ background: 'rgba(255,255,255,0.9)' }}
            >
              {trend.media.kind === 'video' ? (
                <svg width="15" height="17" viewBox="0 0 9 10" fill="none" className="ml-[2px]">
                  <path d="M8.2 3.5c1 .5 1 2 0 2.5L2.2 9.3C1.2 9.8 0 9.1 0 8V1.4C0 .3 1.2-.3 2.2.2l6 3.3Z" fill="#0C0C0C" />
                </svg>
              ) : (
                /* An image gets a magnifier rather than a play badge — the
                   design draws the badge only on its video variant, and the
                   well is now clickable for both. */
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
                  <circle cx="8.6" cy="8.6" r="6.4" stroke="#0C0C0C" strokeWidth="1.7" />
                  <path d="m13.4 13.4 4.4 4.4M6.2 8.6h4.8M8.6 6.2v4.8" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              )}
            </span>
          </button>
        ) : suggestion || repurposeError ? (
          <div className={cn('h-full overflow-y-auto px-[4px] py-[6px]', trend.because && 'pt-[38px]')}>
            <p className="text-[18px] font-bold leading-[1.3] text-ink">
              {suggestion ? `Re-purpose as ${suggestion.playbookName}` : 'No re-purpose for this one'}
            </p>
            <p className="mt-[10px] text-[14.5px] leading-[1.4]" style={{ color: '#3B3B3B' }}>
              {suggestion ? suggestion.intent : repurposeError}
            </p>
            <button
              type="button"
              onClick={() => {
                setSuggestion(null);
                setRepurposeError(null);
              }}
              className="mt-[12px] text-[14.5px] font-semibold text-ink underline"
            >
              Back to why it ranked
            </button>
          </div>
        ) : (
          <div className={cn('h-full overflow-y-auto px-[4px] py-[6px]', trend.because && 'pt-[38px]')}>
            <p className="text-[18px] font-bold leading-[1.3] text-ink">
              {trend.because
                ? `Would have ranked ${Math.round(trend.score * 100)}%`
                : `Ranked ${Math.round(trend.score * 100)}% for this brand`}
            </p>
            {trend.factors.length === 0 ? (
              <p className="mt-[10px] text-[14.5px] leading-[1.4]" style={{ color: '#3B3B3B' }}>
                No factors recorded for this trend.
              </p>
            ) : (
              trend.factors.map((f, i) => (
                <p
                  key={`${f.label}-${i}`}
                  className={cn('text-[14.5px] leading-[1.4]', i === 0 ? 'mt-[10px]' : 'mt-[8px]')}
                  style={{ color: '#3B3B3B' }}
                >
                  <span className="font-semibold text-ink">{f.label}</span>
                  {typeof f.weight === 'number' ? ` (${Math.round(f.weight * 100)}%)` : ''}: {f.detail}
                </p>
              ))
            )}
            {/* The popover keeps the full, weighted explanation reachable — the
                well shows it, but `WhyPopover` is what renders an `Explanation`
                everywhere else in the app, and §7.3 is about the shape not the
                placement. Label-less so it doesn't repeat the text above. */}
            <div className="mt-[10px]">
              <WhyPopover
                why={{ summary: `Ranked ${Math.round(trend.score * 100)}% for this brand.`, factors: trend.factors }}
                label={`Relevance ${Math.round(trend.relevance * 100)}% · Opportunity ${Math.round(trend.opportunity * 100)}%`}
              />
            </div>
          </div>
        )}
      </div>

      {/*
        The design's gap is 10, and at three columns the design's own footer
        overflows its card: its bookmark is squeezed from 42 to 15 and pushed
        35px past the right edge, where `overflow:hidden` cuts it off entirely.
        Losing the only control that saves a trend is not a thing to reproduce,
        so the gap is 6 — the smallest change that keeps all four at their
        design sizes and on screen. `shrink-0` and `whitespace-nowrap` above
        stop flex from taking it out of the labels instead.
      */}
      {/* The reason, over the well's top-left corner — the one place on this
          card with room for a sentence, and legible over a photo. */}
      {trend.because ? (
        <p
          title={`Skipped — ${trend.because}`}
          className="absolute left-[24px] right-[24px] top-[134px] flex items-center gap-[7px] truncate rounded-lg px-[10px] py-[6px] text-[13.5px] font-semibold"
          style={{ background: 'rgba(255,241,223,0.94)', color: '#8A4B12' }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
            <circle cx="7" cy="7" r="6" stroke="#8A4B12" strokeWidth="1.4" />
            <path d="M7 4v4M7 10.2h.01" stroke="#8A4B12" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="truncate font-medium">Skipped — {trend.because}</span>
        </p>
      ) : null}

      <div className="absolute bottom-4 left-4 right-4 flex items-center gap-[6px]">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex h-[42px] shrink-0 items-center gap-[9px] whitespace-nowrap rounded-[10px] bg-ink px-[14px] text-[14.5px] font-semibold text-white transition-colors hover:bg-[#242424]"
          >
            <svg width="17" height="13" viewBox="0 0 19 15" fill="none" aria-hidden>
              <path d="M1.5 7.5S4.4 1.8 9.5 1.8s8 5.7 8 5.7-2.9 5.7-8 5.7-8-5.7-8-5.7Z" stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
              <circle cx="9.5" cy="7.5" r="2.4" stroke="#FFFFFF" strokeWidth="1.4" />
            </svg>
            Open Detail
          </button>
        ) : null}

        <button
          type="button"
          disabled={repurposeBusy}
          onClick={() => (onRepurpose ? onRepurpose() : void repurpose())}
          className={cn(GHOST_BTN, 'hover:shadow-[inset_0_0_0_1.4px_#838383]')}
          style={GHOST_RING}
        >
          <svg width="16" height="16" viewBox="0 0 20 19" fill="none" aria-hidden>
            <defs>
              <linearGradient id={`dv-sp-${trend.trendId}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6CE8FF" />
                <stop offset="0.5" stopColor="#F56BFF" />
                <stop offset="1" stopColor="#A341FF" />
              </linearGradient>
            </defs>
            <path d="M10 0.8 11.9 6.4 17.6 8.3 11.9 10.2 10 15.8 8.1 10.2 2.4 8.3 8.1 6.4Z" fill={`url(#dv-sp-${trend.trendId})`} />
            <path d="m16.6 12.2.9 2.6 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9Z" fill={`url(#dv-sp-${trend.trendId})`} />
          </svg>
          {repurposeBusy ? 'Thinking…' : 'Re-purpose'}
        </button>

        <button
          type="button"
          onClick={onReshare}
          disabled={!onReshare}
          title={
            onReshare
              ? 'Reframe one of your own posts around this trend — same playbook, same assets.'
              : 'Re-share needs a screen to pick which of your posts to reframe.'
          }
          className={cn(GHOST_BTN, onReshare ? 'hover:shadow-[inset_0_0_0_1.4px_#838383]' : 'cursor-not-allowed opacity-50')}
          style={GHOST_RING}
        >
          <svg width="16" height="15" viewBox="0 0 17 16" fill="none" aria-hidden>
            <path
              d="M12.5 1 16 4.5 12.5 8M16 4.5H5.4A4.4 4.4 0 0 0 1 8.9v.4M4.5 15 1 11.5 4.5 8M1 11.5h10.6a4.4 4.4 0 0 0 4.4-4.4v-.4"
              stroke="#0C0C0C"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Re-share
        </button>

        <button
          type="button"
          disabled={watchBusy}
          aria-pressed={watching}
          aria-label={watching ? `Remove ${trend.topic} from your watchlist` : `Save ${trend.topic} to your watchlist`}
          onClick={() => void toggleWatch()}
          className="ml-auto flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-white transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
          style={GHOST_RING}
        >
          <svg width="15" height="19" viewBox="0 0 15 19" fill="none" aria-hidden>
            <path
              d="M1 3.2A2.2 2.2 0 0 1 3.2 1h8.6A2.2 2.2 0 0 1 14 3.2V17.4a.6.6 0 0 1-.96.48L7.5 13.7l-5.54 4.18A.6.6 0 0 1 1 17.4V3.2Z"
              stroke="#0C0C0C"
              strokeWidth="1.5"
              strokeLinejoin="round"
              fill={watching ? '#0C0C0C' : 'none'}
            />
          </svg>
        </button>
      </div>
    </li>
  );
}
