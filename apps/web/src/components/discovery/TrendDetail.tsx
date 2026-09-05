'use client';

import { useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';
import { compactVolume, saturationWord, sourceLabel, type RankedTrendItem } from './TrendCard';
import { RepurposeModal } from './RepurposeModal';
import { ReshareModal } from './ReshareModal';
import { TrendMediaViewer, youTubeId } from './TrendMediaViewer';

/**
 * `DISC-02` — the trend detail screen, PRD §8.9, drawn to
 * `SparkSocial Discovery.dc.html`'s detail page.
 *
 *   card            40,118   1648x1560 r20 white
 *   heading         28,32    22px/700; four pickers at top 26 (h40 r8) from
 *                   1010; "+ Create Draft" 1494,26 h40 r8 on `#6CE8FF`
 *   hairline        top 88
 *   "Trend Metrics" 28,114   19px/700 + the info glyph
 *   metric tiles    top 152  136x82 r12, lefts 28/176/324/472/620
 *   Time Series     28,262   706x420 r15, chart well inset 22 with a
 *                   `#FCFCFC` ground, dashed vertical gridlines, a
 *                   cyan→magenta→purple line over a cyan area fill, and the
 *                   day labels along the bottom
 *   Geo & Audience  28,706   400x400 r15
 *   Top Segments    452,706  282x400 r15
 *   Related Topics  28,1140  heading; chips at 1182, h44 r10
 *   Samples & Pack  772,118  heading; card 772,156 848x526 — rows 106 tall
 *                   with a 60x90 thumb, a kind pill, and the hook line
 *   Recommendations 772,718  848x520 — rows 800x118 r14, each tinted
 *
 * The two columns are 706 and 848 with a 38px gutter, which is why the left one
 * is a fixed width here and the right one takes the rest: at 1632 (our card is
 * 16 narrower than the prototype's 1648) the design's own column widths still
 * fit, and everything inside them is measured from those numbers.
 *
 * ── The four tools this screen exists to reach ────────────────────────────
 *
 * `trend.detail`, `trend.explain`, `trend.reshare` and `trend.safety_filter`
 * were all registered, tested and callable, and no component called any of
 * them. The feed showed a score and a "Suggest a post" button, and the two
 * things §8.9 asks this view to answer — *why* is this trend worth my time,
 * and what does joining it look like — were unreachable.
 *
 * ── What the design asserts that no tool can answer ───────────────────────
 *
 * Two of its panels have no data behind them, and each says so in place rather
 * than being dropped (the layout is the argument; a hole in it reads as a bug)
 * or filled with a plausible number (which is worse):
 *
 *   **Top Segments.** "Founder / CEO", "Creators" — audience segmentation of a
 *   trend's participants. Nothing in `trend.*` classifies who is posting.
 *
 *   **"Expected +59% ER"** on the recommendation rows, and **"ER: +62%"** per
 *   sample. No tool predicts engagement for an unwritten post, and per-post
 *   metrics belong to `analytics.*` for *our* posts, not to a stranger's video
 *   on YouTube. The rows carry what the tools do return: the playbook, what it
 *   reuses, and what it still needs.
 *
 * Everything else is live: the five tiles, the series and its trajectory, the
 * tags, the samples (with per-sample YouTube thumbnails derived from the
 * permalink), the safety verdict, the weighted factors, all three routes out —
 * Re-purpose, Re-share and Create Draft — and, as of the `TREND_REGIONS` work,
 * the Geo & Audience breakdown and a working Mute Source.
 */

interface TrendMetrics {
  volume: number;
  velocity: number;
  saturation: number;
  growth: number;
}

interface SeriesPoint {
  at: string;
  volume: number;
  velocity: number;
  saturation: number;
  growth: number;
}

interface TrendDetailView {
  trend: {
    id: string;
    source: string;
    topic: string;
    tags: string[];
    metrics: TrendMetrics;
    samples: Array<{ url: string; caption?: string }>;
    media?: { url: string; kind: 'image' | 'video' };
    /**
     * Largest first — `createMultiRegionTrendSource` sorts it. `volume` is
     * absent where the vendor's figure is global rather than per-region (see
     * `Trend.regions`), which is most of them.
     */
    regions: Array<{ code: string; volume?: number }>;
    /**
     * Both returned by `trend.detail` and both dropped by this local type until
     * `4.1` — the same omission that had the Assets Library rendering captions
     * and no media. `region` stays optional because no source populates it,
     * which is a fact the screen states rather than hides.
     */
    region?: string;
    language: string;
  };
  score: number;
  relevance: number;
  opportunity: number;
  safety: { safe: boolean; reasons: string[]; detail?: string };
  factors: Array<{ label: string; detail: string; weight?: number }>;
  series: SeriesPoint[];
  trajectory: {
    direction: 'climbing' | 'flat' | 'cooling';
    saturationChange: number;
    volumeChange: number | null;
    observations: number;
    spanHours: number;
  } | null;
  why: Explanation;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The design's four pickers at 1010/1148/1286/1422. Only the first has data. */
const WINDOWS = [7, 14, 30, 90] as const;

/*
 * The design's third picker, "Industry: SaaS", is deliberately not rendered.
 *
 *   { label: 'Industry: SaaS' }
 *
 * Industry is a **genome** dimension, not a trend one. Every trend on this
 * screen has already been scored against this brand's genome — that is what
 * `relevance` is — so an industry switch here would either do nothing or
 * silently score the trend against a brand that is not yours. It was rendered
 * disabled with that explanation on hover, which spent a control's worth of
 * space on a sentence nobody hovers. Industry belongs in Settings, where the
 * genome is edited, and changing it there changes this screen's numbers
 * legitimately.
 *
 * Region and Mute Source were the other two dead pickers. Both are real now —
 * `regions` on the trend and `trend.source.mute` — so this list is empty and
 * kept only as the place the reason lives.
 */

/** The design's tinted rows, reused as bar fills so the panel stays in palette. */
const REGION_BAR = ['#35B7D4', '#B37BE8', '#E8B06B', '#13D711', '#F56BFF'];

/**
 * A flag for an ISO-3166 alpha-2 code, by offsetting each letter into the
 * regional-indicator block. No lookup table, no images, and an input that is
 * not two letters (`WORLD`, or a code a vendor invented) falls back to a globe
 * rather than rendering two stray letter-tiles.
 */
export function regionFlag(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌍';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const CARD = 'rounded-[15px] bg-white';
const CARD_RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.22)' } as const;
const PICKER =
  'flex h-[40px] items-center gap-[9px] rounded-lg bg-white px-[13px] text-[14.5px] font-medium transition-shadow';
const PICKER_RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: '#5B5B5B' } as const;

function Chevron() {
  return (
    <svg width="11" height="7" viewBox="0 0 13 8" fill="none" aria-hidden>
      <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoGlyph({ title }: { title: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="11" cy="11" r="9.8" stroke="#838383" strokeWidth="1.5" />
      <path d="M11 10v5.4" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="11" cy="6.8" r="1.05" fill="#838383" />
    </svg>
  );
}

/**
 * §8.9's time series, in the design's 706x420 card.
 *
 * Charts **saturation**, not volume, and that is the editorial decision on this
 * screen: volume rising tells you the trend is loud, saturation rising tells
 * you the window is closing, and only the second changes what you should do
 * this afternoon. Volume is still reported, as the multiple over the window,
 * because its absence would read as an omission rather than a choice.
 *
 * The domain is fixed 0–1, not fitted to the data. An autoscaled axis makes a
 * drift from 0.18 to 0.21 look like a collapse, which is the classic way a
 * truthful chart tells a lie. Below two observations it draws nothing and says
 * why — a two-point line across a 660px card looks like a trend; it is a pair
 * of measurements. The threshold matches `summariseTrajectory`, so the chart
 * and the verdict never disagree about whether there is enough history.
 */
function SaturationChart({ series, trajectory }: { series: SeriesPoint[]; trajectory: TrendDetailView['trajectory'] }) {
  const W = 662;
  const H = 298;

  if (series.length < 2 || !trajectory) {
    return (
      <div
        className="flex h-full items-center justify-center rounded-xl px-10 text-center"
        style={{ background: '#FCFCFC', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.12)' }}
      >
        <p className="text-[15px] font-medium text-ink-muted">
          {series.length === 0
            ? 'No history for this trend yet.'
            : 'Only one reading so far — not enough to show a direction.'}{' '}
          SPARK records a point every time this trend is fetched; check back tomorrow.
        </p>
      </div>
    );
  }

  const path = series
    .map((p, i) => {
      const x = (i / (series.length - 1)) * W;
      const y = H - Math.min(1, Math.max(0, p.saturation)) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L${W} ${H} L0 ${H} Z`;

  return (
    <div
      className="relative h-full overflow-hidden rounded-xl"
      style={{ background: '#FCFCFC', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.12)' }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Saturation ${trajectory.direction} over ${trajectory.spanHours} hours, from ${pct(series[0]!.saturation)} to ${pct(series[series.length - 1]!.saturation)}.`}
      >
        <defs>
          <linearGradient id="dv-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(108,232,255,0.65)" />
            <stop offset="1" stopColor="rgba(108,232,255,0.05)" />
          </linearGradient>
          <linearGradient id="dv-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6CE8FF" />
            <stop offset="0.5" stopColor="#F56BFF" />
            <stop offset="1" stopColor="#A341FF" />
          </linearGradient>
        </defs>
        <g stroke="rgba(131,131,131,0.25)" strokeWidth="1" strokeDasharray="4 5">
          {[60, 134, 208, 282, 356, 430, 504, 578, 645].map((x) => (
            <path key={x} d={`M${x} 12V286`} />
          ))}
        </g>
        {/* 70% saturation — where `Tile` starts warning, so the chart marks the
            same line the numbers do. */}
        <line
          x1="0"
          x2={W}
          y1={H * 0.3}
          y2={H * 0.3}
          stroke="#F35525"
          strokeOpacity="0.4"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area} fill="url(#dv-area)" />
        <path d={path} fill="none" stroke="url(#dv-line)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function TrendDetail({
  genomeId,
  trendId,
  regions: regionsFromFeed,
  onClose,
}: {
  genomeId: string;
  trendId: string;
  /**
   * The breakdown the ranked list already had, from the card that opened this.
   *
   * `trend.detail` calls the source's `get()`, and the multi-region wrapper's
   * `get()` deliberately asks the **primary region only** — a detail view of one
   * trend does not justify one full chart fetch per region against YouTube's
   * quota. So the re-fetched trend carries one region and this panel would show
   * one row, while the feed behind it already knew about all of them. Passing
   * them down costs nothing and is the same data.
   */
  regions?: Array<{ code: string; volume?: number }>;
  onClose: () => void;
}) {
  const [view, setView] = useState<TrendDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(14);
  const [windowOpen, setWindowOpen] = useState(false);
  const [modal, setModal] = useState<'repurpose' | 'reshare' | 'media' | null>(null);
  /**
   * Whether this brand has muted the source this trend came from.
   *
   * Read from `trend.sources` (which reports `muted` per source when given a
   * genome) rather than kept as a boolean the button flips blind, so the
   * control shows the stored state on arrival — including a mute set from the
   * rail on the feed behind this screen.
   */
  const [muted, setMuted] = useState<boolean | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setView(null);
      setError(null);
      const res = await invoke<TrendDetailView>('trend.detail', { genomeId, trendId, seriesDays: days });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setView(res.output);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, trendId, days]);

  const sourceName = view?.trend.source;

  useEffect(() => {
    if (!sourceName) return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ sources: Array<{ name: string; muted: boolean }> }>('trend.sources', { genomeId });
      if (cancelled || res.status !== 'succeeded') return;
      setMuted(res.output.sources.find((s) => s.name === sourceName)?.muted ?? false);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, sourceName]);

  async function toggleMute() {
    if (!sourceName || muteBusy) return;
    setMuteBusy(true);
    const res = await invoke<{ mutedSources: string[] }>('trend.source.mute', {
      genomeId,
      source: sourceName,
      muted: !muted,
    });
    setMuteBusy(false);
    if (res.status !== 'succeeded') return;
    setMuted(res.output.mutedSources.includes(sourceName));
  }

  /**
   * The card shape, from the detail shape — so `RepurposeModal`, `ReshareModal`
   * and `TrendMediaViewer` are the same components the feed opens rather than
   * three more built for this screen.
   */
  const asCard: RankedTrendItem | null = useMemo(
    () =>
      view
        ? {
            trendId: view.trend.id,
            source: view.trend.source,
            topic: view.trend.topic,
            score: view.score,
            relevance: view.relevance,
            opportunity: view.opportunity,
            metrics: view.trend.metrics,
            factors: view.factors,
            ...(view.trend.media ? { media: view.trend.media } : {}),
            samples: view.trend.samples,
            tags: view.trend.tags,
            regions: view.trend.regions,
          }
        : null,
    [view],
  );

  if (error) {
    return (
      <div className="rounded-[20px] bg-white p-[40px]">
        <p className="text-[17px] font-medium text-ink-muted">{error}</p>
        <button type="button" onClick={onClose} className="mt-4 text-[15px] font-semibold text-ink underline">
          Back to trends
        </button>
      </div>
    );
  }

  if (!view || !asCard) {
    return (
      <div className="rounded-[20px] bg-white p-[28px]">
        <Skeleton className="h-[36px] w-[420px] rounded-lg" />
        <div className="mt-[26px] flex gap-[12px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[82px] w-[136px] rounded-xl" />
          ))}
        </div>
        <div className="mt-[28px] flex flex-wrap gap-[38px]">
          <Skeleton className="h-[420px] w-[706px] rounded-[15px]" />
          <Skeleton className="h-[420px] min-w-[400px] flex-1 rounded-[15px]" />
        </div>
      </div>
    );
  }

  /* Prefer whichever list actually has the breakdown — see `regionsFromFeed`. */
  const regions =
    regionsFromFeed && regionsFromFeed.length > view.trend.regions.length ? regionsFromFeed : view.trend.regions;

  const m = view.trend.metrics;
  const measuredGrowth = m.growth !== 0;
  const sat = saturationWord(m.saturation);

  /** The design's five tiles, in its order and its colours. */
  const tiles: Array<{ label: string; value: string; color: string; up?: boolean; title?: string }> = [
    { label: 'Volume', value: `${compactVolume(m.volume)} posts`, color: '#13A711' },
    {
      label: `Last ${days}d`,
      value: measuredGrowth ? `${m.growth > 0 ? '+' : ''}${Math.round(m.growth * 100)}%` : 'n/a',
      color: '#F56BFF',
      title: measuredGrowth
        ? undefined
        : 'This source reports one snapshot per fetch, so it returns no period-over-period figure. The chart below is the history SPARK has recorded itself.',
    },
    { label: 'Velocity', value: `${Math.round(m.velocity * 100)}%`, color: '#A341FF' },
    { label: 'Saturation', value: sat, color: sat === 'HIGH' ? '#F35525' : '#0C0C0C' },
    {
      label: 'Relevance',
      value: view.relevance >= 0.66 ? 'High' : view.relevance >= 0.33 ? 'Medium' : 'Low',
      color: '#0C0C0C',
      up: view.relevance >= 0.66,
    },
  ];

  return (
    <>
      <div className="rounded-[20px] bg-white">
        {/* ── header row ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-[12px] px-[28px] pt-[26px]">
          <div className="flex min-w-0 flex-1 items-center gap-[12px]">
            <button
              type="button"
              onClick={onClose}
              className="flex h-[40px] shrink-0 items-center gap-[11px] rounded-lg px-4 text-[15px] font-semibold transition-colors hover:bg-white"
              style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: '#5B5B5B' }}
            >
              <svg width="8" height="15" viewBox="0 0 8 16" fill="none" aria-hidden>
                <path d="M7 1 1 8l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Discovery
            </button>
            <h2 className="truncate text-[22px] font-bold text-ink">{view.trend.topic}</h2>
          </div>

          <div className="relative">
            <button
              type="button"
              aria-expanded={windowOpen}
              onClick={() => setWindowOpen((v) => !v)}
              className={cn(PICKER, 'hover:shadow-[inset_0_0_0_1.4px_#838383]')}
              style={PICKER_RING}
            >
              Timeframe: {days}d
              <Chevron />
            </button>
            {windowOpen ? (
              <div
                className="absolute right-0 top-[46px] z-20 w-[150px] rounded-xl bg-white p-[6px]"
                style={{ boxShadow: '0 18px 40px -18px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.2)' }}
              >
                {WINDOWS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDays(d);
                      setWindowOpen(false);
                    }}
                    className={cn(
                      'flex h-[36px] w-full items-center rounded-lg px-[10px] text-left text-[14.5px] font-medium',
                      d === days ? 'bg-[rgba(131,131,131,0.1)] text-ink' : 'text-ink-muted hover:bg-[rgba(131,131,131,0.07)]',
                    )}
                  >
                    Last {d} days
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/*
            "Mute Source" — the design's fourth picker, now a real toggle
            (`trend.source.mute`). It mutes **this brand's** feed, not the
            deployment: the operator's switch is `TREND_SOURCE_*_ENABLED` and
            stays where it is, which is why the label names the source rather
            than saying "mute" in the abstract.
          */}
          <button
            type="button"
            onClick={() => void toggleMute()}
            disabled={muteBusy || muted === null}
            aria-pressed={muted ?? false}
            title={
              muted
                ? `${sourceLabel(view.trend.source)} is muted for this brand — its trends are not requested at all. Press to unmute.`
                : `Stop reading ${sourceLabel(view.trend.source)} for this brand. Muted sources are excluded before the fetch, so they stop spending quota too.`
            }
            className={cn(PICKER, 'disabled:opacity-50')}
            style={
              muted
                ? { boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.45)', background: '#FFF1DF', color: '#8A4B12' }
                : PICKER_RING
            }
          >
            {muted ? `${sourceLabel(view.trend.source)} muted` : `Mute ${sourceLabel(view.trend.source)}`}
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path
                d="M8.2 3.4 4.9 6H2.6v6h2.3l3.3 2.6V3.4Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              {muted ? (
                <path d="m11.6 6.6 4 4.8m0-4.8-4 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M11.8 6.2a3.9 3.9 0 0 1 0 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setModal('repurpose')}
            className="flex h-[40px] items-center rounded-lg px-[15px] text-[14.5px] font-semibold text-ink transition-colors"
            style={{ background: '#6CE8FF' }}
          >
            + Create Draft
          </button>
        </div>

        <div className="mt-[24px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

        {!view.safety.safe ? (
          <div className="mx-[28px] mt-[22px] rounded-[14px] px-[22px] py-[14px]" style={{ background: '#FFF1DF', boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.35)' }}>
            <p className="text-[16px] font-semibold" style={{ color: '#8A4B12' }}>
              SPARK would not join this trend — {view.safety.detail ?? view.safety.reasons.join(', ')}
            </p>
            <p className="mt-1 text-[14.5px] font-medium" style={{ color: '#8A4B12' }}>
              Everything below still works; the verdict is a default, not a lock.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-[38px] px-[28px] pb-[34px] pt-[22px]">
          {/* ── left column, 706 ─────────────────────────────────────── */}
          <div className="w-full xl:w-[706px]">
            <div className="flex items-center gap-[10px]">
              <p className="text-[19px] font-bold text-ink">Trend Metrics</p>
              <InfoGlyph title="Ranked on how much of the trend is left times how credibly this brand can join it. Volume is context, never the signal on its own." />
              <div className="ml-auto">
                <WhyPopover why={view.why} label={`Score ${pct(view.score)}`} />
              </div>
            </div>

            {/* `w-max` and no wrap: the design's five tiles run 28..756, which
                is 728 — wider than the 706 column their cards sit in, spilling
                22px into the 38px gutter. Constrained to 706 they wrapped, and
                Relevance dropped onto a second row that pushed everything below
                it down 94px. It scrolls rather than wraps below `xl`. */}
            <div className="mt-[16px] flex w-max max-w-full gap-[12px] overflow-x-auto pb-1 xl:max-w-none xl:overflow-visible">
              {tiles.map((t) => (
                <div key={t.label} className="relative h-[82px] w-[136px] shrink-0 rounded-xl bg-white" style={CARD_RING} title={t.title}>
                  <p className="absolute left-[14px] top-[12px] whitespace-nowrap text-14 font-medium text-ink-muted">{t.label}</p>
                  <p className="absolute left-[14px] top-[40px] whitespace-nowrap text-[19px] font-bold" style={{ color: t.color }}>
                    {t.value}
                  </p>
                  {t.up ? (
                    <svg width="13" height="16" viewBox="0 0 13 16" fill="none" aria-hidden className="absolute right-[14px] top-[42px]">
                      <path d="M6.5 15V1.8M6.5 1.8 1.5 7M6.5 1.8l5 5.2" stroke="#13D711" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Time Series — 706x420 */}
            <div className={cn(CARD, 'relative mt-[28px] h-[420px] w-full')} style={CARD_RING}>
              <p className="absolute left-[22px] top-[20px] text-18 font-bold text-ink">Time Series</p>
              <div
                className="absolute right-[20px] top-[14px] flex h-[36px] items-center gap-[9px] rounded-lg bg-white px-3 text-14 font-medium"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: '#5B5B5B' }}
              >
                <svg width="15" height="16" viewBox="0 0 24 25" fill="none" aria-hidden>
                  <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#5B5B5B" strokeWidth="1.8" />
                  <path d="M2.9 9.9h18.2" stroke="#5B5B5B" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                {view.trajectory ? `${view.trajectory.observations} readings` : 'no readings'}
              </div>

              <div className="absolute bottom-[56px] left-[22px] right-[22px] top-[66px]">
                <SaturationChart series={view.series} trajectory={view.trajectory} />
              </div>

              <div className="absolute bottom-[18px] left-[22px] right-[22px] flex justify-between">
                {view.series.length >= 2 ? (
                  /* The design prints nine dates; the series decides how many
                     there are, so it is sampled to at most nine rather than
                     padded to exactly nine.

                     And it prints the *time* when the window is under two days:
                     eight readings taken this afternoon rendered as nine
                     identical "Sep 4"s, which tells the reader nothing about
                     what they are looking at. Dates once the span is longer,
                     where the clock stops mattering. */
                  Array.from({ length: Math.min(9, view.series.length) }, (_, i) => {
                    const shown = Math.min(9, view.series.length);
                    const idx = Math.round((i / (shown - 1)) * (view.series.length - 1));
                    const at = new Date(view.series[idx]!.at);
                    const intraday = (view.trajectory?.spanHours ?? 0) < 48;
                    return (
                      <span key={i} className="text-[13.5px] font-medium text-ink-muted">
                        {intraday
                          ? at.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })
                          : at.toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-[13.5px] font-medium text-ink-muted">
                    Saturation, 0–100%. The dashed line is the 70% mark, past which the window is closing.
                  </span>
                )}
              </div>
            </div>

            {/* Geo & Audience + Top Segments — 400 and 282, gap 24 */}
            <div className="mt-[28px] flex flex-wrap gap-[24px]">
              {/*
                Geo & Audience — the design's dot map with `+12k 🇺🇸` badges.

                The map itself is not drawn: a dotted world with five pins is a
                picture of a distribution, and what exists is the distribution
                itself — one row per region SPARK actually asked, with the
                volume each returned. Bars, because the comparison between them
                is the whole content, and the design's own "Top Geo Location"
                line is `regions[0]`.

                One region means the deployment has not opted into the
                breakdown (`TREND_REGIONS`), and the panel says so rather than
                implying this trend is unique to one country.
              */}
              <div className={cn(CARD, 'relative h-[400px] w-full sm:w-[400px]')} style={CARD_RING}>
                <p className="absolute left-[22px] top-[20px] text-18 font-bold text-ink">Geo &amp; Audience</p>

                <div className="absolute inset-x-[22px] bottom-[74px] top-[60px] overflow-y-auto">
                  {regions.length === 0 ? (
                    <p className="text-[15px] font-medium text-ink-muted">
                      This source reports no region — Reddit, Hacker News and Product Hunt are single global feeds,
                      so there is nothing to break down. YouTube, TikTok, X and Google Trends all answer per
                      country.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-[10px]">
                        {regions.map((r, i) => {
                          /* A bar needs a per-region number to be a bar. Where
                             the vendor's volume is global, the row is the
                             region and nothing else — equal bars would assert
                             a split that was never measured. */
                          const top = regions[0]?.volume ?? 0;
                          const share =
                            r.volume !== undefined && top > 0 ? Math.max(4, Math.round((r.volume / top) * 100)) : null;
                          return (
                            <div key={r.code}>
                              <div className="flex items-baseline justify-between">
                                <span className="text-[15px] font-semibold text-ink">
                                  {regionFlag(r.code)} {r.code}
                                </span>
                                <span className="text-[15px] font-bold text-ink">
                                  {r.volume !== undefined ? compactVolume(r.volume) : 'trending'}
                                </span>
                              </div>
                              {share !== null ? (
                                <div className="mt-[6px] h-[10px] w-full overflow-hidden rounded-full" style={{ background: 'rgba(131,131,131,0.14)' }}>
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${share}%`, background: REGION_BAR[i % REGION_BAR.length] }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {regions.every((r) => r.volume === undefined) ? (
                        <p className="mt-[14px] text-[14px] font-medium text-ink-muted">
                          This source reports one global figure per trend ({compactVolume(m.volume)}), not a
                          per-country split — so these are the countries it is trending in, without a number
                          attached to each.
                        </p>
                      ) : null}
                      {regions.length === 1 ? (
                        <p className="mt-[14px] text-[14px] font-medium text-ink-muted">
                          One region because that is all the fetch asked for. Set{' '}
                          <span className="font-semibold text-ink">TREND_REGIONS</span> to compare countries — it
                          costs one request per region per rank.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                {/* The design's "Top Geo Location:" line, at bottom 22. */}
                <div className="absolute bottom-[22px] left-[22px] right-[22px] flex flex-wrap items-center gap-[12px]">
                  <span className="text-16 font-semibold text-ink">Top Geo Location:</span>
                  <span
                    className="flex h-[34px] items-center gap-[8px] rounded-[9px] bg-white px-[13px]"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                  >
                    {regions[0] ? (
                      <>
                        <span className="text-14">{regionFlag(regions[0].code)}</span>
                        <span className="text-[15px] font-bold text-ink">
                          {regions[0].code}
                          {regions[0].volume !== undefined ? ` · ${compactVolume(regions[0].volume)}` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-[15px] font-bold text-ink">
                        {view.trend.language} · global
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <div className={cn(CARD, 'relative h-[400px] w-full sm:w-[282px]')} style={CARD_RING}>
                <p className="absolute left-[22px] top-[20px] text-18 font-bold text-ink">Top Segments</p>
                <p className="absolute inset-x-[22px] top-[64px] text-[15px] font-medium text-ink-muted">
                  Nothing in <span className="font-semibold text-ink">trend.*</span> classifies who is posting a
                  trend, so there are no audience segments to list. Your own audience segments live on Performance
                  &amp; Learning, where the posts are ours and the metrics are real.
                </p>
              </div>
            </div>

            <p className="mt-[28px] text-[19px] font-bold text-ink">Related Topics &amp; Entities</p>
            <div className="mt-[16px] flex flex-wrap gap-[12px]">
              {view.trend.tags.length === 0 ? (
                <p className="text-[15px] font-medium text-ink-muted">
                  This source returned no descriptors, so relevance was scored on the topic alone.
                </p>
              ) : (
                view.trend.tags.map((t) => (
                  <span
                    key={t}
                    className="flex h-[44px] items-center whitespace-nowrap rounded-[10px] bg-white px-[17px] text-[15.5px] font-medium"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: '#3B3B3B' }}
                  >
                    {t}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* ── right column, 848 ────────────────────────────────────── */}
          <div className="min-w-0 flex-1">
            <p className="text-[19px] font-bold text-ink">Samples &amp; Content Pack</p>

            <div className={cn(CARD, 'relative mt-[16px] h-[526px] w-full overflow-hidden')} style={CARD_RING}>
              <p className="px-[24px] pt-[24px] text-18 font-bold text-ink">Top Examples</p>

              {view.trend.samples.length === 0 ? (
                <p className="px-[24px] pt-[18px] text-[15px] font-medium text-ink-muted">
                  This source returned no example posts for the trend — Pinterest&rsquo;s growing-keywords endpoint
                  reports keywords with no posts attached, which is the one source that does this.
                </p>
              ) : (
                <ul className="mt-[10px] max-h-[440px] overflow-y-auto">
                  {view.trend.samples.map((sm, i) => {
                    const vid = youTubeId(sm.url);
                    const thumb = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : i === 0 ? view.trend.media?.url : undefined;
                    return (
                      <li key={sm.url} className="relative flex h-[106px] items-center gap-[28px] px-[24px]" style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.12)' }}>
                        <a
                          href={sm.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="relative block h-[90px] w-[60px] shrink-0 overflow-hidden rounded-lg"
                          style={{ background: '#EAF2FB' }}
                          aria-label={`Open example on ${view.trend.source}`}
                        >
                          {thumb ? (
                            <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          ) : null}
                          <svg width="10" height="11" viewBox="0 0 9 10" fill="none" aria-hidden className="absolute left-[25px] top-[40px]" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.5))' }}>
                            <path d="M8.2 3.5c1 .5 1 2 0 2.5L2.2 9.3C1.2 9.8 0 9.1 0 8V1.4C0 .3 1.2-.3 2.2.2l6 3.3Z" fill="#FFFFFF" />
                          </svg>
                        </a>

                        <div className="min-w-0 flex-1">
                          <span
                            className="flex h-[32px] w-fit items-center gap-[8px] rounded-2xl px-3 text-[14.5px] font-semibold text-ink"
                            style={{ background: '#FBDFFB' }}
                          >
                            {view.trend.source === 'youtube' ? 'Video' : view.trend.source === 'reddit' ? 'Thread' : 'Post'}
                            <span aria-hidden className="h-[4px] w-[4px] rounded-full bg-[#838383]" />
                            <span className="font-medium capitalize">{view.trend.source}</span>
                          </span>
                          <p className="mt-[10px] truncate text-[17px] font-semibold text-ink">
                            {sm.caption ?? sm.url}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Recommendations — 848x520 */}
            <div className={cn(CARD, 'relative mt-[36px] w-full')} style={CARD_RING}>
              <div className="flex items-center gap-[10px] px-[24px] pt-[24px]">
                <p className="text-18 font-bold text-ink">Recommendations</p>
                <InfoGlyph title="What SPARK can actually do with this trend, and what each route needs. No expected-engagement figures: nothing predicts engagement for a post that does not exist yet." />
              </div>

              <div className="flex flex-col gap-[22px] px-[24px] py-[22px]">
                {[
                  {
                    kind: 'Re-purpose',
                    desc: 'A new post from this trend — SPARK picks the best-fit playbook you can run right now.',
                    bg: '#FBE6FA',
                    ring: 'rgba(245,107,255,0.35)',
                    action: () => setModal('repurpose'),
                    cta: 'Open',
                  },
                  {
                    kind: 'Re-share',
                    desc: 'Reframe one of your own posts around this trend, reusing its playbook and assets.',
                    bg: '#FCEBD4',
                    ring: 'rgba(228,137,21,0.3)',
                    action: () => setModal('reshare'),
                    cta: 'Pick a post',
                  },
                  {
                    kind: view.trend.media ? 'Watch it first' : 'Read the source',
                    desc: view.trend.media
                      ? 'See what people are actually making before you commit a slot to it.'
                      : 'This trend is text — the examples above link out to the originals.',
                    bg: '#DDEBFB',
                    ring: 'rgba(36,116,237,0.3)',
                    action: view.trend.media ? () => setModal('media') : undefined,
                    cta: 'Play',
                  },
                ].map((r) => (
                  <div
                    key={r.kind}
                    className="flex min-h-[118px] flex-wrap items-center gap-x-[18px] gap-y-3 rounded-[14px] px-[24px] py-[20px]"
                    style={{ background: r.bg, boxShadow: `inset 0 0 0 1px ${r.ring}` }}
                  >
                    <div className="min-w-[240px] flex-1">
                      <p className="text-[19px] font-bold text-ink">{r.kind}</p>
                      <p className="mt-[10px] text-[17px] font-medium" style={{ color: '#5B5B5B' }}>
                        {r.desc}
                      </p>
                    </div>
                    {r.action ? (
                      <button
                        type="button"
                        onClick={r.action}
                        className="flex h-[44px] shrink-0 items-center rounded-xl bg-ink px-[20px] text-[15px] font-semibold text-white transition-colors hover:bg-[#242424]"
                      >
                        {r.cta}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {modal === 'repurpose' ? (
        <RepurposeModal
          trend={asCard}
          genomeId={genomeId}
          onClose={() => setModal(null)}
          onOpenDraft={(id) => {
            setModal(null);
            window.location.assign(`/agents?draft=${encodeURIComponent(id)}`);
          }}
        />
      ) : modal === 'reshare' ? (
        <ReshareModal
          trend={asCard}
          genomeId={genomeId}
          onClose={() => setModal(null)}
          onOpenDraft={(id) => {
            setModal(null);
            window.location.assign(`/agents?draft=${encodeURIComponent(id)}`);
          }}
        />
      ) : modal === 'media' ? (
        <TrendMediaViewer trend={asCard} onClose={() => setModal(null)} />
      ) : null}
    </>
  );
}
