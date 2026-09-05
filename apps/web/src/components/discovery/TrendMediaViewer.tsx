'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import type { RankedTrendItem } from './TrendCard';

/**
 * The media, viewable — click a card's thumbnail.
 *
 * The card well is 371x270 with `object-fit: cover`, which is the design's
 * frame: a cropped still. There was no way to play the video it is a still
 * *of*, or to see the parts of an image the crop threw away, because a
 * thumbnail is all `Trend.media` carries. The playable thing is in `samples` —
 * the source permalink — which is now passed through with it.
 *
 * So this is one viewer with three behaviours, chosen by what the trend
 * actually has:
 *
 *   YouTube      an inline `youtube-nocookie.com/embed/<id>` player, 16:9,
 *                autoplaying, because the video id is recoverable from the
 *                sample URL and YouTube's embed needs no key
 *   an image     the thumbnail uncropped — `object-contain` on a dark ground,
 *                at whatever resolution the source gave us
 *   neither      the sample link and nothing pretending to be a player
 *
 * Everything keeps a plain "Open on {source}" link out to the original, since
 * an embed can be refused by the uploader (`embeddable: false`) and an image
 * host can rate-limit. The link is the one thing that always works.
 *
 * ── Why not a bare lightbox ───────────────────────────────────────────────
 *
 * It reuses `ModalShell`, so it inherits Escape, the scroll lock, the scrim and
 * the design's box. A hand-rolled overlay would have been a fourth modal
 * implementation on this screen with its own keyboard bugs.
 */

/** The `v` of a watch URL, or the last path segment of a youtu.be/shorts link. */
export function youTubeId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(u.hostname)) return undefined;
    const v = u.searchParams.get('v');
    if (v) return v;
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg && seg !== 'watch' ? seg : undefined;
  } catch {
    return undefined;
  }
}

export function TrendMediaViewer({ trend, onClose }: { trend: RankedTrendItem; onClose: () => void }) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const link = trend.samples[0]?.url;
  const videoId = trend.media?.kind === 'video' ? youTubeId(link) : undefined;
  const sourceName = trend.source.replace(/^\w/, (c) => c.toUpperCase());

  return (
    <ModalShell top={60} height={760} label={`Media for ${trend.topic}`} gradientTo="#F4F7FD" onClose={onClose}>
      <div className="px-[38px] pt-[34px]">
        <p className="pr-[60px] text-[22px] font-bold leading-[1.25] text-ink">{trend.topic}</p>
        <p className="mt-[8px] text-[15px] font-medium text-ink-muted">
          {sourceName}
          {trend.media ? ` · ${trend.media.kind === 'video' ? 'Video' : 'Image'}` : ' · no media'}
        </p>
      </div>

      <div className="px-[38px] pt-[22px]">
        {videoId && !embedFailed ? (
          <div className="relative w-full overflow-hidden rounded-[14px] bg-black pt-[56.25%]">
            <iframe
              /* `nocookie` — the viewer is not being tracked to watch a
                 thumbnail they clicked inside our app. */
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
              title={trend.topic}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              onError={() => setEmbedFailed(true)}
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        ) : trend.media ? (
          <div className="flex h-[440px] w-full items-center justify-center overflow-hidden rounded-[14px] bg-[#111]">
            {/* `contain`, not `cover` — the whole point is to see what the
                card's crop removed. */}
            <img
              src={trend.media.url}
              alt={trend.topic}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <div
            className="flex h-[220px] w-full items-center justify-center rounded-[14px] bg-white px-8 text-center"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
          >
            <p className="text-[16px] font-medium text-ink-muted">
              {trend.source === 'hackernews'
                ? 'Hacker News trends are text — there is no image or video to show. The link below is the thread.'
                : 'This source returned no media for the trend.'}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[10px] px-[38px] pt-[22px]">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-[46px] items-center gap-[9px] rounded-xl bg-ink px-[20px] text-[15px] font-semibold text-white transition-colors hover:bg-[#242424]"
          >
            Open on {sourceName}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M6 2h8v8M14 2 4.5 11.5M11 14H2V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : (
          <p className="text-[15px] font-medium text-ink-muted">This trend carries no example post to link to.</p>
        )}
        {embedFailed ? (
          <p className="text-[14.5px] font-medium text-ink-muted">
            The uploader has disabled embedding — the link opens it on {sourceName}.
          </p>
        ) : null}
      </div>

      {trend.samples.length > 1 ? (
        <div className="px-[38px] pb-[34px] pt-[24px]">
          <p className="text-[15px] font-semibold text-ink">Other examples</p>
          <ul className="mt-[10px] flex flex-col gap-[8px]">
            {trend.samples.slice(1, 5).map((sm) => (
              <li key={sm.url}>
                <a
                  href={sm.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[14.5px] font-medium text-ink underline decoration-ink-muted underline-offset-2"
                >
                  {sm.caption ?? sm.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="pb-[34px]" />
      )}
    </ModalShell>
  );
}
