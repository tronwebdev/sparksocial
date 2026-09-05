'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { TrendCard, saturationWord, sourceLabel, type RankedTrendItem, type WatchlistTrendItem } from './TrendCard';
import { TrendDetail } from './TrendDetail';
import { InfluencerWatchlist } from './InfluencerWatchlist';
import { DiscoveryFilterRail, type RailSection } from './DiscoveryFilterRail';
import { TrendMediaViewer } from './TrendMediaViewer';
import { RepurposeModal } from './RepurposeModal';
import { ReshareModal } from './ReshareModal';

/**
 * Discovery — `SparkSocial Discovery.dc.html`, `DISC-01`/`DISC-02`, plan §12 P5.
 *
 * The card is at 48,140 — 1632 wide, radius 20, white — and holds everything:
 *
 *   tabs      top 22, h42 r9, px15 gap9, icon 18, label 15.5/600; active
 *             `#6CE8FF`, inactive white in a `rgba(131,131,131,.25)` ring;
 *             lefts 20 + [0,122,222,356,468,596]
 *   sorts     top 24, h38 r8 at 1066 / 1210 / 1330 / 1470
 *   rule      20,76   120x4, the cyan→purple→peach gradient
 *   rail      20,140  300 wide (`DiscoveryFilterRail`)
 *   header    "Trending Now" 352,106 21/700 with the flame; search 1110,98
 *             378x46 r12; Insights 1512,108 17/600
 *   grid      352,158 1256 wide, three columns, gap 18
 *   empty     352,240 centred, 17/500 `#838383`
 *
 * The tabs' vertical centres agree — 22+21 and 24+19 are both 43 — so they are
 * one flex row here, the sorts pushed right, rather than eight absolute
 * positions that would collapse below 1632.
 *
 * ── The six tabs, against the tools that exist ────────────────────────────
 *
 * The prototype filters six hard-coded trends; each tab has to mean something
 * against `trend.rank`, which returns a topic, a source, four metrics and the
 * weighted factors behind the score:
 *
 *   For you      the ranked list as `trend.rank` ordered it — brand fit first
 *   Global       the same trends re-sorted by raw volume, which is what
 *                "global" means once "for you" is the ranking
 *   Competitors  `InfluencerWatchlist` — accounts you watch *is* the competitor
 *                facet, and it already owns two real tools
 *   Sounds       YouTube-sourced trends; there is no audio source connected, and
 *                YouTube is the only source of the five whose trends are sound
 *   Hashtags     topics that start with `#`
 *   Hooks        nothing — no source classifies a trend as a hook, so the tab
 *                says so rather than showing an arbitrary subset
 *
 * `DISC-02` opens in place of the feed rather than on its own route. The detail
 * view is a step inside "find something worth posting about", not a destination
 * — a full page navigation would lose the ranked list and the excluded-trends
 * argument beneath it, which is the context that makes one trend's score mean
 * anything.
 */

const TAB_ICONS: React.ReactNode[] = [
  <>
    <circle cx="9" cy="5.4" r="3.4" stroke="currentColor" strokeWidth="1.7" />
    <path d="M2.6 16c.5-3.6 3.2-6 6.4-6s5.9 2.4 6.4 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </>,
  <>
    <circle cx="9" cy="9" r="7.6" stroke="currentColor" strokeWidth="1.6" />
    <path d="M1.6 9h14.8M9 1.4c2 2.2 3 4.7 3 7.6s-1 5.4-3 7.6c-2-2.2-3-4.7-3-7.6s1-5.4 3-7.6Z" stroke="currentColor" strokeWidth="1.6" />
  </>,
  <>
    <path d="M3.4 16.6V2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M3.8 3c3.2-1.7 5.7 1.5 8.8.3.8-.3 1.6.3 1.6 1.1v5c0 .6-.4 1.2-1 1.3-3.4.9-5.9-2.1-9.4-.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </>,
  <path d="M2 7v4M5.5 4.5v9M9 2v14M12.5 5.5v7M16 7.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  <>
    <circle cx="9" cy="9" r="7.6" stroke="currentColor" strokeWidth="1.6" />
    <path d="M6 6.6h6.4M5.6 11h6.4M7.8 4 6.6 14M11.4 4l-1.2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </>,
  <>
    <path d="M12.6 2.2c.9 2.5-.2 3.9-1.6 5.5-1.5 1.7-3.4 3.2-4.3 5.4a5.8 5.8 0 0 0 3.2 7.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform="scale(0.82) translate(2,-1)" />
    <path d="M6.5 12.7c-.4 1.5.4 3 1.9 3.6 1.5.5 3.1-.2 3.7-1.6.5-1.2.1-2.5-.7-3.5-.6-.8-1.4-1.5-1.7-2.3-.7 1.4-2.7 2.2-3.2 3.8Z" fill="currentColor" />
  </>,
];

const TABS = ['For you', 'Global', 'Competitors', 'Sounds', 'Hashtags', 'Hooks'] as const;

/**
 * A trend `trend.rank` excluded. The same shape as a ranked one — the tool
 * scores every fetched trend before splitting them — plus the reason.
 */
type SkippedTrendItem = RankedTrendItem & { because: string };

/**
 * One row of `trend.sources`.
 *
 * Four states, and the rail draws each differently because they need different
 * things done about them: **live** (filter it, or mute it), **muted** (this
 * brand switched it off — unmute), **off** (the operator set
 * `TREND_SOURCE_*_ENABLED=false`), and **not connected** (no credentials —
 * `requires` names the variables). The rail used to list only the live ones,
 * so X, TikTok, Reddit and Pinterest were invisible rather than explained.
 */
interface SourceStatus {
  name: string;
  keywordSupport: 'server' | 'filter';
  muted: boolean;
  configured: boolean;
  enabled: boolean;
  requires: string[];
  note?: string;
}

const SORTS = [
  { key: 'velocity', label: 'Velocity' },
  { key: 'volume', label: 'Volume' },
  { key: 'fit', label: 'Brand fit' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

/** The three sorts the prototype toasts that no field supports. */
const DEAD_SORTS = [
  { label: 'Time frame', why: 'A ranked trend carries no observation window — trend.rank returns the current metrics, not a series. The detail view has the 14-day series.' },
  { label: 'Region: Global', why: 'No source returns a region. Reddit, YouTube, Pinterest, Hacker News and Product Hunt are all global feeds here.' },
  { label: 'Industry: SaaS', why: 'Industry is a genome dimension, not a trend one — trends are already ranked against your genome, so there is nothing to switch between.' },
];


const SEC_ICONS: Record<string, React.ReactNode> = {
  Sources: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7 10 2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Signal: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M1.6 10h3.2l2.2-5.4 3.6 10.8 2.4-5.4h5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Language: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.2 10h15.6M10 2.2c2.2 2.4 3.3 5.1 3.3 7.8s-1.1 5.4-3.3 7.8c-2.2-2.4-3.3-5.1-3.3-7.8S7.8 4.6 10 2.2Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  'Brand Safety': (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 1.6 17 4.3v5c0 4.4-2.8 8.2-7 9.6-4.2-1.4-7-5.2-7-9.6v-5L10 1.6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  'Saved Watchlist': (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 3.4A2.4 2.4 0 0 1 6.4 1h7.2A2.4 2.4 0 0 1 16 3.4v14.8a.6.6 0 0 1-.95.49L10 15l-5.05 3.7A.6.6 0 0 1 4 18.2V3.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  Influencers: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="m10 1.8 2.4 5 5.4.6-4 3.7 1.1 5.4L10 13.7l-4.9 2.8 1.1-5.4-4-3.7 5.4-.6 2.4-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
};

const SIGNAL_TESTS: Record<string, (t: RankedTrendItem) => boolean> = {
  Velocity: (t) => t.metrics.velocity >= 0.5,
  Acceleration: (t) => t.metrics.growth > 0,
  Saturation: (t) => saturationWord(t.metrics.saturation) === 'Low',
};

export function DiscoveryFeed() {
  const { genome, loading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [tab, setTab] = useState(0);
  const [sort, setSort] = useState<SortKey>('velocity');
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [trends, setTrends] = useState<RankedTrendItem[] | null>(null);
  const [excluded, setExcluded] = useState<SkippedTrendItem[]>([]);
  const [whySummary, setWhySummary] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistTrendItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  /** The prototype opens with three boxes ticked; those would silently narrow
      a real feed on first paint, so this starts empty. */
  const [checks, setChecks] = useState<string[]>([]);
  /**
   * The workspace's configured sources and this brand's mutes, from
   * `trend.sources`.
   *
   * The rail used to list a hard-coded five, which went stale the moment X,
   * TikTok and Google Trends were added and lied about Reddit and Pinterest
   * (neither is configured here). Reading it from the tool means the rail
   * describes the deployment it is running against.
   */
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [muteBusy, setMuteBusy] = useState<string | null>(null);
  const [openTrendId, setOpenTrendId] = useState<string | null>(null);
  /**
   * The three modals the card's buttons open, each holding the trend it was
   * opened from — the card cannot own them: at 470px tall inside an
   * `overflow-hidden` grid cell it has nowhere to put a 1035x900 panel, and the
   * prototype draws all three over the whole screen.
   */
  const [modal, setModal] = useState<{ kind: 'media' | 'repurpose' | 'reshare'; trend: RankedTrendItem } | null>(null);
  const router = useRouter();

  const loadTrending = useCallback(async (id: string) => {
    setTrends(null);
    setError(null);
    const res = await invoke<{
      trends: RankedTrendItem[];
      excluded: SkippedTrendItem[];
      why: { summary: string };
    }>('trend.rank', { genomeId: id, limit: 15 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setTrends([]);
      return;
    }
    setTrends(res.output.trends);
    setExcluded(res.output.excluded);
    setWhySummary(res.output.why.summary);
  }, []);

  const loadWatchlist = useCallback(async (id: string) => {
    const res = await invoke<{ watchlist: WatchlistTrendItem[] }>('trend.watchlist', { genomeId: id, action: 'list' });
    if (res.status === 'succeeded') setWatchlist(res.output.watchlist);
  }, []);

  const loadSources = useCallback(async (id: string) => {
    const res = await invoke<{ sources: SourceStatus[] }>('trend.sources', { genomeId: id });
    if (res.status === 'succeeded') setSources(res.output.sources);
  }, []);

  const toggleMute = useCallback(
    async (name: string, muted: boolean) => {
      if (!genomeId) return;
      setMuteBusy(name);
      const res = await invoke<{ mutedSources: string[] }>('trend.source.mute', { genomeId, source: name, muted });
      setMuteBusy(null);
      if (res.status !== 'succeeded') return;
      const mutedSet = new Set(res.output.mutedSources);
      setSources((prev) => prev.map((s) => ({ ...s, muted: mutedSet.has(s.name) })));
      /* Re-rank: a muted source is excluded before the fetch, so the feed that
         is on screen was built from a different set of vendors than the one
         now configured. */
      void loadTrending(genomeId);
    },
    [genomeId, loadTrending],
  );

  useEffect(() => {
    if (!genomeId) return;
    void loadTrending(genomeId);
    // The watchlist is read once rather than per tab: the rail's Saved
    // Watchlist section and every card's bookmark both need it, on every tab.
    void loadWatchlist(genomeId);
    void loadSources(genomeId);
  }, [genomeId, loadTrending, loadWatchlist, loadSources]);

  const savedIds = useMemo(() => new Set(watchlist.map((w) => w.trendId)), [watchlist]);

  const sections: RailSection[] = useMemo(
    () => [
      {
        label: 'Sources',
        icon: SEC_ICONS.Sources,
        items:
          sources.length === 0
            ? [
                {
                  label: 'No source reported',
                  disabledReason:
                    'trend.sources answered with nothing, which means the API could not be reached. The feed falls back to the built-in sample set.',
                },
              ]
            : sources.map((s) => {
                const label = sourceLabel(s.name);
                if (!s.configured) {
                  /* Visible and explained rather than absent. A filter for a
                     vendor with no credentials would narrow to nothing, so the
                     checkbox is disabled and the row says what is missing. */
                  return {
                    label: `${label} — not connected`,
                    disabledReason: `${label} is supported but not configured. Set ${s.requires.join(' and ')} in the API environment to turn it on.${s.note ? ` ${s.note}` : ''}`,
                  };
                }
                if (!s.enabled) {
                  return {
                    label: `${label} — off`,
                    disabledReason: `${label} has credentials but is switched off for this deployment (TREND_SOURCE_${s.name.toUpperCase()}_ENABLED=false). That is the operator's switch, not this brand's — muting is the per-brand one.`,
                  };
                }
                return {
                  label,
                  mute: {
                    muted: s.muted,
                    busy: muteBusy === s.name,
                    onToggle: () => void toggleMute(s.name, !s.muted),
                    title: s.muted
                      ? `${label} is muted for this brand — press to unmute`
                      : `Mute ${label} for this brand`,
                  },
                };
              }),
      },
      {
        label: 'Signal',
        icon: SEC_ICONS.Signal,
        items: [
          { label: 'Velocity' },
          { label: 'Acceleration' },
          {
            label: 'Novelty',
            disabledReason:
              'No source returns a novelty score — a trend carries volume, velocity, saturation and growth. Velocity and Acceleration are the early-signal filters here.',
          },
          { label: 'Saturation' },
        ],
      },
      {
        label: 'Language',
        icon: SEC_ICONS.Language,
        items: [{ label: 'English' }, { label: 'French' }, { label: 'Spanish' }, { label: 'Arabic' }],
        disabledReason: 'A ranked trend carries no language. Nothing in trend.rank tags one, so this cannot narrow the feed.',
      },
      {
        label: 'Brand Safety',
        icon: SEC_ICONS['Brand Safety'],
        items: [{ label: 'Hide NSFW' }, { label: 'Hide Politics' }, { label: 'Hide Competitors' }],
        disabledReason:
          'Brand safety is applied before you see the feed — packages/trends/src/safety.ts drops unsafe trends inside trend.rank, and the ones it dropped are listed under the grid with the reason. There is nothing left here to hide.',
      },
      {
        label: 'Saved Watchlist',
        icon: SEC_ICONS['Saved Watchlist'],
        items:
          watchlist.length === 0
            ? [{ label: 'Nothing saved yet', disabledReason: 'Save a trend with the bookmark on any card and it appears here.' }]
            : watchlist.map((w) => ({ label: w.topic })),
      },
      {
        label: 'Influencers',
        icon: SEC_ICONS.Influencers,
        items: [{ label: 'Open the Competitors tab' }],
        disabledReason:
          'Watched accounts are their own list, not a filter on trends — the Competitors tab above is that list, with its own add and review actions.',
      },
    ],
    [watchlist, sources, muteBusy, toggleMute],
  );

  /**
   * Ranked first, then skipped — one list through one filter pipeline.
   *
   * The tabs, the rail, the search and the sort have to apply to a skipped
   * card exactly as they do to a ranked one, or the grid stops agreeing with
   * its own controls: filtering to YouTube would leave Reddit rejections on
   * screen. Ordering is by segment first so the ranker's answer still leads,
   * and the sort operates inside each segment.
   */
  /**
   * Skipped trends that came back with the full ranked shape.
   *
   * `trend.rank` gained `metrics`/`factors`/`media` on its excluded entries;
   * an API deployed before that change still answers with a name and a reason.
   * Rendering one of those as a card would read `metrics.velocity` off
   * `undefined` and take the screen down, so the guard is on the data rather
   * than on every comparator: cards for what can be a card, and the notice
   * below counts all of them either way.
   */
  const skippedCards = useMemo(
    () => excluded.filter((e): e is SkippedTrendItem => Boolean(e && e.metrics && e.factors)),
    [excluded],
  );

  const visible = useMemo(() => {
    if (!trends) return [];
    let list: Array<RankedTrendItem & { because?: string }> = [...trends, ...skippedCards];

    if (tab === 3) list = list.filter((t) => t.source.toLowerCase().includes('youtube'));
    else if (tab === 4) list = list.filter((t) => t.topic.trim().startsWith('#'));
    else if (tab === 5) list = [];

    // The rail, then the sort, then the search — narrowest last, so the count
    // under the header always describes what is on screen.
    /* Checked labels map back to adapter names — a trend's `source` is the
       adapter's name, and the label is only for reading. */
    const sourceChecks = sources
      .filter((s) => s.configured && s.enabled && checks.includes(sourceLabel(s.name)))
      .map((s) => s.name);
    if (sourceChecks.length > 0) {
      list = list.filter((t) => sourceChecks.some((name) => t.source.toLowerCase().includes(name)));
    }
    for (const [label, test] of Object.entries(SIGNAL_TESTS)) {
      if (checks.includes(label)) list = list.filter(test);
    }
    const savedChecks = watchlist.filter((w) => checks.includes(w.topic));
    if (savedChecks.length > 0) list = list.filter((t) => savedChecks.some((w) => w.trendId === t.trendId));

    const bySegment = (a: { because?: string }, b: { because?: string }) =>
      Number(Boolean(a.because)) - Number(Boolean(b.because));
    if (tab === 1) list.sort((a, b) => bySegment(a, b) || b.metrics.volume - a.metrics.volume);
    else if (sort === 'velocity') list.sort((a, b) => bySegment(a, b) || b.metrics.velocity - a.metrics.velocity);
    else if (sort === 'volume') list.sort((a, b) => bySegment(a, b) || b.metrics.volume - a.metrics.volume);
    else list.sort((a, b) => bySegment(a, b) || b.score - a.score);

    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.topic.toLowerCase().includes(q));
    return list;
  }, [trends, skippedCards, tab, checks, watchlist, sort, search, sources]);

  if (loading) return <Skeleton className="h-64 w-full rounded-[20px]" />;
  if (genomeError || !genomeId) {
    return (
      <section className="rounded-[20px] bg-white p-8">
        <p className="text-16 text-ink-muted">{genomeError ?? 'No brand selected.'}</p>
      </section>
    );
  }

  // DISC-02 replaces the feed while it is open. `key` on the trend id so
  // opening a second trend remounts rather than showing the first one's data
  // while the second loads.
  if (openTrendId) {
    /* No wrapper: `TrendDetail` draws the design's own 1648-wide card. It used
       to be a generic panel inside a white `p-[40px]` box, and leaving that box
       around it put a card inside a card — 40px of padding on every side, and
       the right column squeezed from 832 to 737. */
    /* `regions` comes from the ranked list rather than being re-fetched — see
       the prop's own note in `TrendDetail`. */
    const opened = [...(trends ?? []), ...excluded].find((t) => t.trendId === openTrendId);
    return (
      <TrendDetail
        key={openTrendId}
        genomeId={genomeId}
        trendId={openTrendId}
        {...(opened?.regions ? { regions: opened.regions } : {})}
        onClose={() => setOpenTrendId(null)}
      />
    );
  }

  return (
    <section className="rounded-[20px] bg-white px-[20px] pb-[28px] pt-[22px]">
      {/* Tabs and sorts share one row — their design centres are both 43. */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          {TABS.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={tab === i}
              onClick={() => setTab(i)}
              className={cn(
                'flex h-[42px] items-center gap-[9px] rounded-[9px] px-[15px] text-[15.5px] font-semibold text-ink transition-colors',
                tab === i ? 'bg-disc-tab' : 'bg-white hover:bg-[rgba(131,131,131,0.07)]',
              )}
              style={tab === i ? undefined : { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="shrink-0">
                {TAB_ICONS[i]}
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* 6px, not 10: the design's four sort pills are absolutely placed at
            1114/1258/1378/1518 and its own labels overlap by up to 4px, so the
            tightest gap that keeps them apart is the honest reading. */}
        <div className="ml-auto flex flex-wrap items-center gap-[6px]">
          <div className="relative">
            <button
              type="button"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
              className="flex h-[38px] items-center gap-[9px] rounded-lg bg-white px-[13px] text-[14.5px] font-medium transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: '#5B5B5B' }}
            >
              Sort: {SORTS.find((s) => s.key === sort)?.label}
              <svg width="11" height="7" viewBox="0 0 13 8" fill="none" aria-hidden>
                <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {sortOpen ? (
              <div
                className="absolute right-0 top-[44px] z-20 w-[184px] rounded-xl bg-white p-[6px]"
                style={{ boxShadow: '0 18px 40px -18px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.2)' }}
              >
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setSort(s.key);
                      setSortOpen(false);
                    }}
                    className={cn(
                      'flex h-[36px] w-full items-center rounded-lg px-[10px] text-left text-[14.5px] font-medium',
                      s.key === sort ? 'bg-[rgba(131,131,131,0.1)] text-ink' : 'text-ink-muted hover:bg-[rgba(131,131,131,0.07)]',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
                {tab === 1 ? (
                  <p className="px-[10px] pb-[4px] pt-[6px] text-[13px] text-ink-muted">
                    Global orders by volume, so the sort is ignored on this tab.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {DEAD_SORTS.map((d) => (
            <button
              key={d.label}
              type="button"
              disabled
              title={d.why}
              className="flex h-[38px] cursor-not-allowed items-center gap-[9px] rounded-lg bg-white px-[13px] text-[14.5px] font-medium opacity-50"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: '#5B5B5B' }}
            >
              {d.label}
              <svg width="11" height="7" viewBox="0 0 13 8" fill="none" aria-hidden>
                <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* 20,76 — a 120x4 gradient rule under the tab row. */}
      <div className="mt-[12px] h-[4px] w-[120px] rounded bg-disc-rule" />

      <div className="mt-[28px] flex flex-col gap-[32px] xl:flex-row">
        <DiscoveryFilterRail
          sections={sections}
          collapsed={collapsed}
          onToggleSection={(label) =>
            setCollapsed((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]))
          }
          checks={checks}
          onToggleCheck={(item) =>
            setChecks((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]))
          }
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-[24px] gap-y-3">
            <div className="flex items-center gap-[10px]">
              <svg width="20" height="26" viewBox="0 0 22 28" fill="none" aria-hidden>
                <path
                  d="M11 1.5c.2 2.6-.9 4.4-2.8 6.5C6.2 10.2 3.6 12.4 2.4 15.5a9.3 9.3 0 0 0 5.2 11.9 9.6 9.6 0 0 0 12-4.2c1.5-3 .8-6.5-.8-9.3-1.2-2-2.8-3.7-3.6-5.9-.5-1.4-.7-3-.4-4.9"
                  fill="rgba(245,107,255,0.25)"
                  stroke="#F56BFF"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                <path d="M8.6 20.3c-.5 2 .6 4.1 2.5 4.8 2 .7 4.2-.2 5-2.1.7-1.6.2-3.4-.9-4.8-.8-1-1.9-1.9-2.3-3.1-.9 1.9-3.7 3-4.3 5.2Z" fill="#F56BFF" />
              </svg>
              <h2 className="whitespace-nowrap text-[21px] font-bold text-ink">
                {tab === 2 ? 'Accounts you watch' : 'Trending Now'}
              </h2>
            </div>

            {tab === 2 ? null : (
              <>
                <div
                  className="relative ml-auto h-[46px] w-full max-w-[378px] rounded-xl bg-white"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                >
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search trends"
                    placeholder="Search topics, #hashtags, keywords, sounds..."
                    className="h-[46px] w-full bg-transparent pl-4 pr-[40px] text-15 font-medium text-ink outline-none placeholder:text-ink-muted"
                  />
                  <svg width="17" height="17" viewBox="0 0 26 26" fill="none" aria-hidden className="absolute right-[15px] top-[15px]">
                    <circle cx="11" cy="11" r="8" stroke="#838383" strokeWidth="2" />
                    <path d="m17 17 6 6" stroke="#838383" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>

                {/* The prototype toasts "Insights digest — mock". The digest
                    real data can write is `trend.rank`'s own `why` plus what it
                    ranked and dropped, so this opens that rather than a toast. */}
                <button
                  type="button"
                  aria-expanded={insightsOpen}
                  onClick={() => setInsightsOpen((v) => !v)}
                  className="flex items-center gap-[9px] whitespace-nowrap text-[17px] font-semibold text-ink transition-opacity hover:opacity-70"
                >
                  <svg width="21" height="19" viewBox="0 0 21 19" fill="none" aria-hidden>
                    <path d="M1 12.5 6 7l4 3.6L15.5 4" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M16 1h4v4" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M1 18h19" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  Insights
                </button>
              </>
            )}
          </div>

          {insightsOpen && tab !== 2 ? (
            <div className="mt-[18px] rounded-2xl p-[18px]" style={{ background: 'var(--ss-disc-sec)' }}>
              <p className="text-[15px] font-semibold text-ink">
                Showing {visible.length} of {(trends?.length ?? 0) + excluded.length} —{' '}
                {trends?.length ?? 0} ranked, {excluded.length} skipped.
              </p>
              {whySummary ? <p className="mt-2 text-[14.5px] text-ink-muted">{whySummary}</p> : null}
            </div>
          ) : null}

          {tab === 2 ? (
            <div className="mt-[18px]">
              <InfluencerWatchlist genomeId={genomeId} />
            </div>
          ) : trends === null ? (
            <div className="mt-[18px] grid grid-cols-1 gap-disc-grid-gap md:grid-cols-2 2xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-disc-trend w-full rounded-[18px]" />
              ))}
            </div>
          ) : error ? (
            <p className="mt-[82px] text-center text-[17px] font-medium text-ink-muted">{error}</p>
          ) : visible.length === 0 ? (
            <p className="mt-[82px] text-center text-[17px] font-medium text-ink-muted">
              {tab === 5
                ? 'No source classifies a trend as a hook, so there is nothing to show here. The Hooks a playbook uses live on the draft itself.'
                : trends.length === 0 && excluded.length === 0
                  ? /* Nothing was filtered — the ranker itself returned nothing,
                       and it says why. Blaming the filters would be wrong. */
                    (whySummary ??
                    'Nothing worth joining right now — every current trend is either saturated, off-brand, or unsafe.')
                  : tab === 3
                    ? 'No YouTube trends right now — that is the only sound-bearing source connected.'
                    : 'No trends match your search or filters.'}
            </p>
          ) : (
            <ul className="mt-[18px] grid grid-cols-1 gap-disc-grid-gap md:grid-cols-2 2xl:grid-cols-3">
                {visible.map((t) => (
                <TrendCard
                  key={t.trendId}
                  trend={t}
                  genomeId={genomeId}
                  watched={savedIds.has(t.trendId)}
                  onWatchChanged={(trendId, watched) => {
                    setWatchlist((prev) =>
                      watched
                        ? [...prev, { trendId, source: t.source, topic: t.topic, createdAt: new Date().toISOString() }]
                        : prev.filter((w) => w.trendId !== trendId),
                    );
                  }}
                  onOpen={() => setOpenTrendId(t.trendId)}
                  onViewMedia={() => setModal({ kind: 'media', trend: t })}
                  onRepurpose={() => setModal({ kind: 'repurpose', trend: t })}
                  onReshare={() => setModal({ kind: 'reshare', trend: t })}
                />
              ))}
            </ul>
          )}

          {/* The skipped notice stays — `trend.rank`'s refusals are the
              product's argument, and a grid that mixes kept and skipped cards
              needs to say so out loud. It is a count and a rule now rather
              than a second copy of the reasons, which each card carries. */}
          {tab !== 2 && excluded.length > 0 ? (
            <div className="mt-[18px] rounded-2xl p-[18px]" style={{ background: 'var(--ss-disc-sec)' }}>
              <p className="text-[15px] font-semibold text-ink">
                {excluded.length} skipped, shown after the ranked ones
              </p>
              <p className="mt-2 text-[14.5px] text-ink-muted">
                SPARK would not have picked these — each card carries the reason. They are still
                yours to act on: the ranker&rsquo;s verdict is a default, not a lock.
                {excluded.some((e) => !e.because.startsWith('nothing this brand'))
                  ? ' Ones skipped on brand safety are flagged as such.'
                  : ''}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* `openDraft` closes first: these panels are fixed-position, and leaving
          one mounted across the route change animates it in again over the
          Draft Panel. Same handoff the prototype's two Generate Draft buttons
          make to `SparkSocial Draft Panel.dc.html`. */}
      {modal?.kind === 'media' ? (
        <TrendMediaViewer trend={modal.trend} onClose={() => setModal(null)} />
      ) : modal?.kind === 'repurpose' ? (
        <RepurposeModal
          trend={modal.trend}
          genomeId={genomeId}
          onClose={() => setModal(null)}
          onOpenDraft={(contentItemId) => {
            setModal(null);
            router.push(`/agents?draft=${encodeURIComponent(contentItemId)}`);
          }}
        />
      ) : modal?.kind === 'reshare' ? (
        <ReshareModal
          trend={modal.trend}
          genomeId={genomeId}
          onClose={() => setModal(null)}
          onOpenDraft={(contentItemId) => {
            setModal(null);
            router.push(`/agents?draft=${encodeURIComponent(contentItemId)}`);
          }}
        />
      ) : null}
    </section>
  );
}
