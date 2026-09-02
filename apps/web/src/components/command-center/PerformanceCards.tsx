'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { compactNumber } from '@/lib/relativeTime';
import { platformLabel } from '@/lib/platforms';
import type { BrandSeries } from '@/components/dashboard/types';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';
import { EmptyCard } from '@/components/common/EmptyCard';

/**
 * `CC-04`'s Performance & Learning body — the Top Post card, the metric tiles,
 * the insight banner and the Top Trending Post list.
 *
 * ── Where each number comes from ──────────────────────────────────────────
 *
 * Five tiles are `analytics.brand_series`, which returns the interactions
 * individually as of the change that made this screen buildable: Views, Likes,
 * Impressions, Saves and Replies (`comments` — a comment on a post is what a
 * reply is), each with its own delta and its own per-day series for the
 * sparkline.
 *
 * The ranking is `analytics.campaign_report`, whose `topPosts` is the campaign's
 * posts ordered by engagement in one call. It carries only
 * `{ contentItemId, engagement }`, so the title, date and platform come from the
 * `content.list` the screen already needs and are joined on the id here.
 *
 * ── Clicks are not a sixth tile, and this is the honest reason ────────────
 *
 * The design's sixth tile is Clicks. A click is a CTA-link event Dub owns, read
 * by `analytics.cta_traffic` — which takes a **contentItemId**. There is no
 * brand-wide click total anywhere: getting one means one Dub round trip per post
 * in the window, server-side, on the read this screen waits for.
 *
 * So clicks appear where one call answers the question honestly: on the top
 * post, labelled as that post's. A sixth tile in a row of brand-wide numbers
 * that was secretly one post's would be worse than five tiles, because the
 * label is the only thing that would have told you.
 */

interface TopPostRow {
  contentItemId: string;
  engagement: number;
}

interface Published {
  contentItemId: string;
  playbookName: string;
  mediaType?: string;
  platform?: string;
  summary: string;
  scheduledAt?: string;
}

export function PerformanceCards({
  genomeId,
  series,
  onOpenPost,
}: {
  genomeId: string | undefined;
  series: BrandSeries | null;
  onOpenPost?: (contentItemId: string) => void;
}) {
  const [ranked, setRanked] = useState<TopPostRow[] | null>(null);
  const [published, setPublished] = useState<Published[]>([]);
  const [topClicks, setTopClicks] = useState<number | null>(null);
  const [insight, setInsight] = useState<Explanation | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      const [campaigns, posts] = await Promise.all([
        invoke<{ campaigns: Array<{ campaignId: string; status: string }> }>('campaign.list', {
          genomeId,
          limit: 5,
        }),
        invoke<{ items: Published[] }>('content.list', { genomeId, status: 'published', limit: 50 }),
      ]);
      if (cancelled) return;

      if (posts.status === 'succeeded') setPublished(posts.output.items);

      const campaign =
        campaigns.status === 'succeeded'
          ? (campaigns.output.campaigns.find((c) => c.status === 'active') ??
            campaigns.output.campaigns[0])
          : undefined;

      if (!campaign) {
        setRanked([]);
        return;
      }

      const report = await invoke<{ topPosts: TopPostRow[] }>('analytics.campaign_report', {
        genomeId,
        campaignId: campaign.campaignId,
      });
      if (cancelled) return;
      setRanked(report.status === 'succeeded' ? report.output.topPosts : []);
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  /*
    The insight, and the click count, both hang off results above — so they are
    their own effect rather than extending the chain. `learning.explain` reads
    the mix engine's own weights, which is the closest thing to the design's
    "the Agent has increased carousel frequency" that is actually measured.
  */
  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ why: Explanation }>('learning.explain', { genomeId });
      if (!cancelled && res.status === 'succeeded') setInsight(res.output.why);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  const top = ranked?.[0];
  const topPost = top ? published.find((p) => p.contentItemId === top.contentItemId) : undefined;

  useEffect(() => {
    if (!genomeId || !top) return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ totalClicks: number }>('analytics.cta_traffic', {
        genomeId,
        contentItemId: top.contentItemId,
      });
      if (!cancelled) setTopClicks(res.status === 'succeeded' ? res.output.totalClicks : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, top]);

  const t = series?.totals;
  const c = series?.changePct;

  return (
    <div className="mt-6 flex flex-col gap-6">
      {/* ── Top Post card ────────────────────────────────────────────── */}
      <section
        className="rounded-xl p-[18px]"
        style={{
          background: 'linear-gradient(122deg, #FCE3F6 0%, #FDF0FA 46%, #FFF8FD 100%)',
          boxShadow: 'inset 0 0 0 2px #FFFFFF',
        }}
      >
        <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[minmax(0,540fr)_minmax(0,565fr)]">
          {/* the post itself */}
          <div className="min-w-0">
            <span
              className="inline-flex h-[30px] items-center gap-[7px] rounded-lg px-3 text-14 font-semibold text-ink"
              style={{ background: '#9CEFFF' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 1.4 9.8 5.6l4.6.4-3.5 3 1 4.5L8 11.2 4.1 13.5l1-4.5-3.5-3 4.6-.4L8 1.4Z" fill="currentColor" />
              </svg>
              Top Post
            </span>

            {topPost ? (
              <div className="mt-[24px] flex flex-wrap gap-[28px]">
                {/* 110x110 at radius 14. `ContentListItem` still has no
                    `mediaUrl`, so it names the medium. */}
                <div
                  className="flex h-[110px] w-[110px] shrink-0 items-center justify-center rounded-[14px] bg-white text-[12px] text-ink-muted"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}
                >
                  {topPost.mediaType ?? 'text'}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-20 font-semibold leading-[1.28] text-ink">{topPost.playbookName}</p>
                  <p className="mt-2 line-clamp-2 max-w-[400px] text-[14.5px] leading-[1.35] text-ink-muted">
                    {topPost.summary}
                  </p>

                  <div className="mt-[18px] flex flex-wrap items-center gap-[9px]">
                    {topPost.scheduledAt ? (
                      <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
                          <rect x="2" y="3.2" width="14" height="12.6" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
                          <path d="M2 7h14M6 1.8v2.6M12 1.8v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        {new Date(topPost.scheduledAt).toLocaleString('en', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    ) : null}
                    {topPost.platform ? (
                      <span className="text-[15px] font-medium text-ink">{platformLabel(topPost.platform)}</span>
                    ) : null}

                    {/* Clicks, where one `cta_traffic` call answers honestly. */}
                    {topClicks !== null ? (
                      <span
                        className="inline-flex h-[33px] items-center gap-2 rounded-lg bg-white px-3 text-[13.5px] font-medium text-ink"
                        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                        title="Clicks on this post's CTA links, from Dub. There is no brand-wide click total — see PerformanceCards."
                      >
                        {compactNumber(topClicks)} link clicks
                      </span>
                    ) : null}

                    {onOpenPost ? (
                      <button
                        type="button"
                        onClick={() => onOpenPost(top!.contentItemId)}
                        className="inline-flex h-[33px] items-center gap-2 rounded-lg bg-white px-3 text-[13.5px] font-medium text-ink"
                        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                      >
                        View insights
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              ranked === null ? (
                <p className="mt-6 text-16 text-ink-muted">Working out which post did best…</p>
              ) : (
                <EmptyCard
                  glyph="chart"
                  title="No top post yet"
                  body="Once posts have gone out and the platforms report back, the best performing one appears here."
                />
              )
            )}
          </div>

          {/* ── the five tiles ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
            <Tile label="Views" value={t?.views} colour="#0BAAC7" change={c?.views} days={series?.days} pick={(d) => d.views} kind="line" />
            <Tile label="Likes" value={t?.likes} colour="#F56BFF" change={c?.likes} days={series?.days} pick={(d) => d.likes} kind="line" />
            <Tile label="Impressions" value={t?.impressions} colour="#13A711" change={c?.impressions} days={series?.days} pick={(d) => d.impressions} kind="bars" />
            <Tile label="Saves" value={t?.saves} colour="#F5A623" change={c?.saves} days={series?.days} pick={(d) => d.saves} kind="bars" />
            <Tile label="Replies" value={t?.comments} colour="#2474ED" change={c?.comments} days={series?.days} pick={(d) => d.comments} kind="line" />
          </div>
        </div>
      </section>

      {/* ── the insight banner ───────────────────────────────────────── */}
      {insight && !dismissed ? (
        <section
          className="rounded-xl p-[26px]"
          style={{ background: '#C9F1FA', boxShadow: 'inset 0 0 0 1.5px #7ADCEF' }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[24px] font-semibold leading-[1.27] text-ink">What the agent has learned</p>
              <p className="mt-3 max-w-[900px] text-16 leading-[1.4]" style={{ color: 'rgba(12,12,12,0.75)' }}>
                {insight.summary}
              </p>
              {/* The factors behind it, which `learning.explain` returns and the
                  design has nowhere to put. */}
              <WhyPopover why={insight} />
            </div>

            <div className="flex shrink-0 items-center gap-[10px]">
              {/*
                The design's Apply. Nothing applies an explanation: `learning
                .reweight` changes the arms from recorded outcomes, and the mix
                engine already uses whatever it has learned — there is no
                pending change here for a button to accept.
              */}
              <button
                type="button"
                disabled
                title="This is what the mix engine is already doing — there is no pending change to apply."
                className="inline-flex h-[34px] cursor-not-allowed items-center gap-[7px] rounded-lg bg-white px-[13px] text-[14.5px] font-semibold text-ink opacity-55"
              >
                <svg width="13" height="11" viewBox="0 0 14 12" fill="none" aria-hidden>
                  <path d="m1 6 4 4L13 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Apply
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="inline-flex h-[34px] items-center rounded-lg bg-white px-[13px] text-[14.5px] font-medium"
                style={{ boxShadow: 'inset 0 0 0 1px #F35525', color: '#F35525' }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Top Trending Post ────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-lg bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 pb-[22px] pt-[26px]">
          <div className="flex items-center gap-3">
            <h3 className="text-20 font-semibold text-ink">Top Trending Post</h3>
            <span
              title="Your published posts, ordered by measured engagement."
              className="flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
              style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
            >
              i
            </span>
          </div>
          <span className="flex items-center gap-[9px] text-16 font-medium text-ink">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
              <rect x="2" y="3.2" width="14" height="12.6" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2 7h14M6 1.8v2.6M12 1.8v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })}
          </span>
        </div>

        <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

        {ranked === null ? (
          <p className="px-6 py-8 text-16 text-ink-muted">Loading…</p>
        ) : ranked.length === 0 ? (
          <EmptyCard
            glyph="chart"
            title="Nothing measured yet"
            body="Your published posts appear here ranked by engagement, once the platforms report their numbers."
          />
        ) : (
          <ul>
            {ranked.slice(0, 4).map((row, i) => {
              const post = published.find((p) => p.contentItemId === row.contentItemId);
              return (
                <li
                  key={row.contentItemId}
                  className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-[22px]"
                  style={{ borderTop: i === 0 ? undefined : '1px solid rgba(131,131,131,0.1)' }}
                >
                  <div className="min-w-[220px] flex-1">
                    <p className="truncate text-20 font-semibold leading-[1.28] text-ink">
                      {post?.playbookName ?? 'Published post'}
                    </p>
                    <p className="mt-2.5 flex items-center gap-2.5 text-16 font-medium text-ink-muted">
                      <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
                        <rect x="2" y="3.2" width="14" height="12.6" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
                        <path d="M2 7h14M6 1.8v2.6M12 1.8v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                      {post?.scheduledAt
                        ? new Date(post.scheduledAt).toLocaleString('en', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </p>
                  </div>

                  <div
                    className="flex h-[94px] w-[94px] shrink-0 items-center justify-center rounded-xl text-[11px] text-ink-muted"
                    style={{ background: 'rgba(131,131,131,0.08)' }}
                  >
                    {post?.mediaType ?? 'text'}
                  </div>

                  <span className="w-[110px] shrink-0 text-18 font-medium text-ink">
                    {post?.mediaType ?? 'text'}
                  </span>

                  <span className="w-[130px] shrink-0 text-18 font-medium text-ink">
                    {post?.platform ? platformLabel(post.platform) : '—'}
                  </span>

                  {/* The design shows an avatar cluster here. There is no
                      per-post audience list, so this is the number the ranking
                      is actually made of. */}
                  <span className="w-[130px] shrink-0 text-16 text-ink-muted">
                    {compactNumber(row.engagement)} interactions
                  </span>

                  {onOpenPost ? (
                    <button
                      type="button"
                      onClick={() => onOpenPost(row.contentItemId)}
                      className="flex h-[42px] w-[92px] shrink-0 items-center justify-center gap-2 rounded-lg bg-white text-[15px] font-medium text-ink"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
                    >
                      <svg width="15" height="11" viewBox="0 0 18 12" fill="none" aria-hidden>
                        <path d="M1 6s2.9-5 8-5 8 5 8 5-2.9 5-8 5-8-5-8-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        <circle cx="9" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" />
                      </svg>
                      View
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One metric tile: 265x146 at radius 15 on white, the label at 16px/500, the
 * value at 32px/600 in the metric's own colour, a delta pill, and a sparkline
 * from `days`.
 *
 * The pill follows `KpiRow`'s settled rule — it always renders, and where there
 * is nothing to compare against it says so on hover rather than in the 90px it
 * does not have.
 */
function Tile({
  label,
  value,
  colour,
  change,
  days,
  pick,
  kind,
}: {
  label: string;
  value: number | undefined;
  colour: string;
  change: number | null | undefined;
  days: BrandSeries['days'] | undefined;
  pick: (d: BrandSeries['days'][number]) => number;
  kind: 'bars' | 'line';
}) {
  const points = (days ?? []).map(pick);
  const peak = Math.max(1, ...points);
  const up = (change ?? 0) >= 0;

  return (
    <div className="relative min-h-[138px] rounded-lg bg-white p-[18px]">
      <p className="text-16 font-medium text-ink">{label}</p>
      <p className="mt-2 text-[32px] font-semibold leading-none" style={{ color: colour }}>
        {value === undefined ? '—' : compactNumber(value)}
      </p>

      <span
        className="mt-[18px] inline-flex h-[30px] items-center gap-[5px] rounded-[9px] bg-white px-2.5"
        style={{ boxShadow: 'inset 0 0 0 0.8px rgba(12,12,12,0.12)' }}
        title={
          change === null || change === undefined
            ? 'No previous period to compare against yet, so this reads as no change.'
            : undefined
        }
      >
        <span className="text-14 font-medium" style={{ color: up ? '#13D711' : '#F35525' }}>
          {up ? '+' : '−'}
        </span>
        <span className="text-[14.5px] font-medium text-ink">{Math.abs(change ?? 0)}%</span>
      </span>

      {/* The sparkline. Bars where the design draws bars, a polyline where it
          draws a line — both from the same `days` array. */}
      {points.length > 0 ? (
        <span aria-hidden className="absolute bottom-[18px] right-[18px] block h-[64px] w-[118px]">
          {kind === 'bars' ? (
            <span className="flex h-full items-end gap-[7px]">
              {points.map((p, i) => (
                <span
                  key={i}
                  className="flex-1 rounded"
                  style={{
                    height: `${Math.max(6, Math.round((p / peak) * 100))}%`,
                    background: p > 0 ? colour : '#E9E9E9',
                  }}
                />
              ))}
            </span>
          ) : (
            <svg viewBox={`0 0 ${Math.max(1, points.length - 1)} 10`} preserveAspectRatio="none" className="h-full w-full">
              <polyline
                points={points.map((p, i) => `${i},${10 - (p / peak) * 9.5}`).join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth="0.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </span>
      ) : null}
    </div>
  );
}
