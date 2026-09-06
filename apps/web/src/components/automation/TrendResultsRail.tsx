'use client';

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@/lib/tools';
import { compactVolume, saturationWord, type RankedTrendItem } from '@/components/discovery/TrendCard';

/**
 * "Posts Results" — the rail beside the AutoTrend query step, `atResults`.
 *
 * The design's rail is a live preview of the query being typed, not a summary
 * of the form, and its cards are the trend cards: a metric strip across the top
 * (`Vol · 7d · Accel · Saturation`), a 96×96 thumb, the format, the title, and
 * a checkbox.
 *
 * ── Where the results come from, and the one honest gap ───────────────────
 *
 * `trend.rank` — the same ranked feed Discovery shows, for this brand, honouring
 * the Region and Language dropdowns because those are the two arguments it
 * takes. It does **not** take keywords: only the internal `TrendFetchArgs` the
 * recipe runner uses does, and no tool exposes that. So the keyword and
 * exclusion filtering happens here, against the ranked list, using the engine's
 * own rules — keywords OR-matched, exclusions applied last.
 *
 * That means this is a faithful preview of *ranking* and an approximation of
 * *reach*: at run time the recipe narrows the source query itself, which can
 * surface topics that never made this brand's ranked feed. The rail says so
 * rather than implying the preview is the result set.
 *
 * ── Ticking a result ──────────────────────────────────────────────────────
 *
 * A recipe stores keywords, not trends — there is no "these five topics" field
 * to write — so ticking a result adds its topic to the keyword list, which is
 * the thing that actually makes the recipe find more like it.
 */
export function TrendResultsRail({
  genomeId,
  keywords,
  excludeKeywords,
  region,
  language,
  onAddKeyword,
}: {
  genomeId: string;
  keywords: string[];
  excludeKeywords: string[];
  region: string;
  language: string;
  onAddKeyword: (topic: string) => void;
}) {
  const [trends, setTrends] = useState<RankedTrendItem[] | null>(null);
  /* The refusals, and the engine's one-line reason for them. A brand can score
     zero ranked trends against sixty live ones, and "nothing ranked" would read
     as "the sources are empty" when the truth is "none of these are for you". */
  const [excluded, setExcluded] = useState<Array<RankedTrendItem & { because: string }>>([]);
  const [why, setWhy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Region and language are the only two the tool takes, so they are the only
     two that re-fetch. Everything else filters what is already here. */
  useEffect(() => {
    let cancelled = false;
    setTrends(null);
    setError(null);
    void (async () => {
      const res = await invoke<{
        trends: RankedTrendItem[];
        excluded: Array<RankedTrendItem & { because: string }>;
        why: { summary: string };
      }>('trend.rank', {
        genomeId,
        limit: 20,
        ...(region ? { region } : {}),
        ...(language ? { language } : {}),
      });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setTrends([]);
        setError(res.status === 'failed' ? res.error.message : 'That read was gated.');
        return;
      }
      setTrends(res.output.trends);
      setExcluded(res.output.excluded ?? []);
      setWhy(res.output.why?.summary ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, region, language]);

  const shown = useMemo(() => {
    const words = keywords.map((k) => k.toLowerCase()).filter(Boolean);
    const bad = excludeKeywords.map((k) => k.toLowerCase()).filter(Boolean);
    return (trends ?? [])
      .filter((t) => {
        const hay = `${t.topic} ${t.tags.join(' ')}`.toLowerCase();
        /* OR, exactly as the engine matches them — the intersection would be
           empty for almost any real keyword list. */
        if (words.length && !words.some((w) => hay.includes(w))) return false;
        if (bad.some((w) => hay.includes(w))) return false;
        return true;
      })
      .slice(0, 6);
  }, [trends, keywords, excludeKeywords]);

  return (
    <aside
      className="w-auto-rail shrink-0 rounded-[20px] bg-white pb-[22px] max-lg:w-full"
      style={{ boxShadow: '0 24px 60px -40px rgba(12,12,12,0.25)' }}
      aria-live="polite"
    >
      <p className="px-[26px] pt-[24px] text-[19px] font-bold text-ink">Posts Results</p>
      <div className="mt-[20px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

      <p className="px-[34px] pt-[22px] text-center text-[15.5px] font-normal leading-[1.45]" style={{ color: '#5B5B5B' }}>
        {keywords.length === 0
          ? 'What is trending for this brand right now. Add keywords and this narrows to them.'
          : 'What your query matches in this brand’s ranked feed. Tick one to add its topic to the keywords.'}
      </p>

      {trends === null ? (
        <p className="px-[26px] pt-[24px] text-center text-15 text-ink-muted">Reading the trend sources…</p>
      ) : error ? (
        <p className="px-[26px] pt-[24px] text-center text-15 text-destructive">{error}</p>
      ) : shown.length === 0 ? (
        <div className="px-[26px] pt-[24px]">
          <p className="text-center text-15" style={{ color: '#838383' }}>
            {trends.length > 0
              ? `None of the ${trends.length} ranked trends match those words. The recipe searches the sources directly when it runs, so it can still find more than this preview shows.`
              : (why ?? 'Nothing ranked for this brand yet.')}
          </p>

          {/* The refusals are the argument. A recipe pointed at topics the
              ranker keeps rejecting will produce nothing, and seeing *why* is
              what tells you to change the keywords rather than wait. */}
          {trends.length === 0 && excluded.length > 0 ? (
            <div className="mt-[18px]">
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: '#9A9A9A' }}>
                {excluded.length} passed over
              </p>
              <ul className="mt-[10px] flex flex-col gap-[10px]">
                {excluded.slice(0, 4).map((t) => (
                  <li key={t.trendId} className="rounded-[12px] px-[14px] py-[10px]" style={{ background: 'rgba(131,131,131,0.07)' }}>
                    <p className="line-clamp-2 text-[14.5px] font-semibold text-ink">{t.topic}</p>
                    <p className="mt-[3px] text-[13px]" style={{ color: '#838383' }}>
                      {t.because}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-[14px] px-[22px] pt-[20px]">
          {shown.map((t) => {
            const picked = keywords.some((k) => t.topic.toLowerCase().includes(k.toLowerCase()));
            return (
              <li key={t.trendId} className="rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}>
                {/* The design's 42px metric strip, four cells divided by hairlines. */}
                <div className="flex h-[42px] items-center text-[13px] text-ink" style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.15)' }}>
                  <span className="flex-1 text-center font-semibold">Vol: {compactVolume(t.metrics.volume)}</span>
                  <span className="h-full w-px" style={{ background: 'rgba(131,131,131,0.15)' }} />
                  <span className="flex-[1.1] text-center font-medium">
                    7d {t.metrics.growth >= 0 ? '+' : ''}
                    {Math.round(t.metrics.growth * 100)}%
                  </span>
                  <span className="h-full w-px" style={{ background: 'rgba(131,131,131,0.15)' }} />
                  <span className="flex-[0.9] text-center font-medium">
                    Accel: <b style={{ color: t.metrics.growth >= 0 ? 'var(--ss-green-500)' : 'var(--ss-auto-failed)' }}>{t.metrics.growth >= 0 ? '↑' : '↓'}</b>
                  </span>
                  <span className="h-full w-px" style={{ background: 'rgba(131,131,131,0.15)' }} />
                  <span className="flex-[1.3] text-center font-medium">Saturation: {saturationWord(t.metrics.saturation)}</span>
                </div>

                <div className="flex gap-[18px] p-[18px]">
                  <span className="relative block h-[96px] w-[96px] shrink-0 overflow-hidden rounded-[10px]" style={{ background: 'rgba(131,131,131,0.08)' }}>
                    {t.media ? (
                      <img src={t.media.url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-16 font-medium" style={{ color: '#838383' }}>
                      {t.media?.kind === 'video' ? 'Video' : t.media ? 'Image' : 'Topic'}
                    </span>
                    <span className="mt-[6px] line-clamp-3 block text-[17px] font-bold leading-[1.3] text-ink">{t.topic}</span>
                  </span>
                </div>

                <div className="flex items-center gap-[10px] px-[18px] pb-[16px]">
                  <button
                    type="button"
                    onClick={() => onAddKeyword(t.topic)}
                    disabled={picked}
                    aria-pressed={picked}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] transition-colors disabled:cursor-default"
                    style={{ background: picked ? '#0C0C0C' : '#FFFFFF', boxShadow: picked ? 'none' : 'inset 0 0 0 1.4px rgba(12,12,12,0.3)' }}
                    aria-label={picked ? `${t.topic} is already a keyword` : `Add ${t.topic} to the keywords`}
                  >
                    {picked ? (
                      <svg width="12" height="10" viewBox="0 0 11 9" fill="none">
                        <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                  <span className="text-[13.5px]" style={{ color: '#838383' }}>
                    {picked ? 'In your keywords' : 'Use this topic'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
