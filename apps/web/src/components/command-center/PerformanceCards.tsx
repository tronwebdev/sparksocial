'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { compactNumber } from '@/lib/relativeTime';
import { platformLabel } from '@/lib/platforms';
import type { BrandSeries } from '@/components/dashboard/types';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';
import { EmptyCard } from '@/components/common/EmptyCard';
import { cn } from '@/lib/utils';

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

/**
 * The per-row detail columns under Top Trending Post, switched off.
 *
 * Each row carried four secondary columns beside the post: a media-type tile,
 * the media type again as text, the platform, and the interaction count. Two of
 * them said the same thing, and the platform read an em dash for every post
 * that had not recorded one. Flip this back on to restore them.
 *
 * The post itself stays: its name, when it went out, and View. That is what a
 * ranking is for.
 */
const SHOW_TOP_POST_DETAILS = false;

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

/** The design's three learning-row tints, in its order. */
const LEARNING_TINTS = ['#F5E9FB', '#E7F7EC', '#E9F0FB'] as const;

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
      {/*
        1159x330 at radius 20, and it is two *rows*, not two columns.

        The design lays it out as: the post itself on the left of row one with
        Views at 584 and Likes at 865 beside it, then four tiles across the full
        width of row two at 18 / 298 / 582 / 865. It was a two-column grid with
        all five tiles stacked 2-up in the right half, which is a different card
        — taller than 330, and with no tile on the design's second row.

        The columns are `fr` so they hold at the 1159.7 the card actually
        measures: row one 542/265/268 with 20px gutters puts Views on 580, and
        row two 267/271/267/268 with 14px gutters puts the four on 18/299/584/865
        — the design's own numbers to within 2px.
      */}
      <section
        className="rounded-[20px] px-[18px] pb-[16px] pt-[14px] xl:min-h-[330px]"
        style={{
          background: 'linear-gradient(122deg, #FCE3F6 0%, #FDF0FA 46%, #FFF8FD 100%)',
          boxShadow: 'inset 0 0 0 2px #FFFFFF',
        }}
      >
        <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[minmax(0,542fr)_minmax(0,265fr)_minmax(0,268fr)] xl:gap-x-[20px]">
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

          {/* Row one's two tiles: 265 and 268 wide, 146 tall. */}
          <Tile label="Views" value={t?.views} colour="#0BAAC7" change={c?.views} days={series?.days} pick={(d) => d.views} kind="line" tall />
          <Tile label="Likes" value={t?.likes} colour="#F56BFF" change={c?.likes} days={series?.days} pick={(d) => d.likes} kind="line" tall />
        </div>

        {/*
          Row two — four tiles at 18 / 298 / 582 / 865, 138 tall.

          `Clicks` is the design's fourth metric and the one thing here with no
          source: `analytics.brand_series` carries no click field on purpose — a
          click is a CTA-link event Dub owns, read by `analytics.cta_traffic`,
          and putting it on this snapshot would either duplicate Dub's number or
          make the tab wait on an external API. So the slot is kept and the tile
          says why rather than the row losing a column.
        */}
        <div className="mt-[16px] grid grid-cols-2 gap-[14px] xl:grid-cols-[minmax(0,267fr)_minmax(0,271fr)_minmax(0,267fr)_minmax(0,268fr)]">
          <Tile label="Impressions" value={t?.impressions} colour="#13A711" change={c?.impressions} days={series?.days} pick={(d) => d.impressions} kind="bars" />
          <Tile
            label="Clicks"
            value={undefined}
            colour="#A341FF"
            change={undefined}
            days={undefined}
            pick={() => 0}
            kind="line"
            note="Clicks are CTA-link events Dub owns — read by analytics.cta_traffic, not by this snapshot."
          />
          <Tile label="Saves" value={t?.saves} colour="#F5A623" change={c?.saves} days={series?.days} pick={(d) => d.saves} kind="bars" />
          <Tile label="Replies" value={t?.comments} colour="#2474ED" change={c?.comments} days={series?.days} pick={(d) => d.comments} kind="line" />
        </div>
      </section>

      {/*
        ── the insight banner ──────────────────────────────────────────

        1159x135 at radius 20 on `#C9F1FA` inside a 1.5px `#7ADCEF` ring. The
        colours were already right; the box was not — `p-[26px]` put the title
        on 26 where the design has it on 62, because the design clears a 24px
        arrow at 16,56 on each side. Those arrows carry a cursor and no handler
        in the prototype, exactly like the campaign hero's, so they are drawn
        `aria-hidden` rather than as controls that would do nothing.
      */}
      {insight && !dismissed ? (
        <section
          className="relative rounded-[20px] px-[62px] py-[26px] xl:h-[135px]"
          style={{ background: '#C9F1FA', boxShadow: 'inset 0 0 0 1.5px #7ADCEF' }}
        >
          {/* 24px at 16,56 and 1119,56 — decorative in the design. */}
          {[0, 1].map((i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'absolute top-[56px] hidden h-[24px] w-[24px] items-center justify-center rounded-full xl:flex',
                i === 0 ? 'left-[16px]' : 'right-[16px]',
              )}
              style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.4)', background: 'rgba(255,255,255,0.5)' }}
            >
              <svg width="5" height="9" viewBox="0 0 5 9" fill="none" className={i === 0 ? '-scale-x-100' : undefined}>
                <path d="m1 1 3 3.5L1 8" stroke="#0C0C0C" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))}

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

      {/*
        ── What the Agent learned ──────────────────────────────────────

        1159x360 at radius 15: the heading on 24,26 with an info glyph at 262,
        then three 1131x80 rows at radius 15 on 72 / 166 / 260 — a 94px pitch —
        each with a sparkle glyph and its line in 18/500, on `#F5E9FB`,
        `#E7F7EC` and `#E9F0FB`.

        The card did not exist. The design fills it with three written
        conclusions ("Short hooks outperform long introductions on LinkedIn");
        what the build actually has is `learning.explain`'s factors, which are
        the same thing one level less polished — the reasons the mix engine is
        weighted the way it is, each with its own detail. So the rows are the
        factors, and the card only appears when there are any. Three tints for
        three slots, cycled if the explanation returns more.
      */}
      {insight?.factors?.length ? (
        <section className="rounded-lg bg-white px-[14px] pb-[14px] pt-0">
          <div className="flex items-center gap-3 px-[10px] pb-[16px] pt-[26px]">
            <h3 className="text-20 font-semibold leading-none text-ink">What the Agent learned</h3>
            <span
              title="What SPARK has concluded from how this brand's posts have performed, and why the mix is weighted the way it is."
              className="flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
              style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
            >
              i
            </span>
          </div>

          <ul className="flex flex-col gap-[14px]">
            {insight.factors.map((f, i) => (
              <li
                key={`${f.label}-${i}`}
                title={f.detail}
                className="flex min-h-[80px] items-center gap-[16px] rounded-[15px] px-[26px]"
                style={{ background: LEARNING_TINTS[i % LEARNING_TINTS.length] }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
                  <path
                    d="M12 2.2a10 10 0 1 0 .01 20.01 10 10 0 0 0 4.4-19"
                    stroke="#0C0C0C"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <path d="m12 7 1 2.7 2.7 1-2.7 1-1 2.7-1-2.7-2.7-1 2.7-1 1-2.7Z" fill="#0C0C0C" />
                  <path d="m18.6 2.3.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" fill="#0C0C0C" />
                </svg>
                <span className="text-18 font-medium text-ink">{f.label}</span>
                {/* The weight is what makes a factor a *finding* rather than a
                    remark, and the design has nowhere to put it. */}
                {typeof f.weight === 'number' ? (
                  <span className="ml-auto shrink-0 text-16 font-semibold tabular-nums text-ink-muted">
                    {Math.round(f.weight * 100)}%
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
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

                  {SHOW_TOP_POST_DETAILS ? (
                    <>
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
                    </>
                  ) : null}

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
  tall,
  note,
}: {
  label: string;
  value: number | undefined;
  colour: string;
  change: number | null | undefined;
  days: BrandSeries['days'] | undefined;
  pick: (d: BrandSeries['days'][number]) => number;
  kind: 'bars' | 'line';
  /** Row one's tiles are 146 in the design; row two's are 138. */
  tall?: boolean;
  /** Shown on hover where a metric has no source — see the Clicks tile. */
  note?: string;
}) {
  const points = (days ?? []).map(pick);
  const peak = Math.max(1, ...points);
  const up = (change ?? 0) >= 0;

  return (
    <div
      title={note}
      className={cn(
        'relative rounded-lg bg-white p-[18px]',
        tall ? 'min-h-[146px] xl:h-[146px]' : 'min-h-[138px] xl:h-[138px]',
        note ? 'cursor-help' : undefined,
      )}
    >
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
