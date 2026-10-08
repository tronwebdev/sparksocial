'use client';

import { PLATFORM_LIMITS } from '@sparksocial/shared';
import { cn } from '@/lib/utils';
import { backdropOf, type DraftView } from './types';

/**
 * The preview — `DP prevText.dc.html`, "Review your post".
 *
 * ── What it replaces ──────────────────────────────────────────────────────
 *
 * A bordered box with the caption as plain text and, under it, whichever beats
 * happened to have `kind: 'generated_*'`. Auto-illustration attaches media
 * without changing a beat's kind, so an illustrated post previewed as a
 * paragraph and nothing else — and the composed video, which the render queue
 * had already made, was not shown at all because the panel only ever held
 * renders that came back from a `compose.render` *it* had just called.
 *
 * The design's answer is the post as it will appear: a real post card with the
 * brand's avatar and name, the copy, the media, and the platform's own
 * engagement row beneath it.
 *
 * ── Measured off the rendered prototype at 1728 ───────────────────────────
 *
 *   "Post preview"   x821 y147 · 15/500 grey
 *   card             x817 y183 · 872 wide · r10 · white
 *     avatar         x841 y201 · 63x63 · r76 · #CFFCCF, initials 27.9/500 #13AD12
 *     name           x915 y211 · 18/500 grey
 *     "Sponsored ·"  x915 y239 · 15/500 grey
 *     body           x844 y289 · 647 wide · 18/500 grey
 *     Like/Comment/Share  y543 · x867 / x946 / x1068 · 16/400 grey
 *   "Character count by platform" y609 · 15/500 grey
 *   counts card      x817 y642 · 872x91 · r10 · grey 10%
 *   "Publish to"     y766 · 15/500 grey
 *   platform pills   y797 · h35 · r100 — chosen #B3F3FF, over-limit
 *                    rgba(243,85,37,0.32), unavailable rgba(131,131,131,0.2)
 *   schedule card    x817 y860 · 872x103 · r10 · grey 10%
 *     best time      x830 y908 · 744x41 · r10 · rgba(163,65,255,0.2), 16/600 #A341FF
 *   actions          y1023 — "Publish now" 190x43 ink; "Schedule" 110x44
 *                    rgba(36,116,237,0.1); "Save as Draft" 168x44 white
 */

export interface PostPreviewProps {
  draft: DraftView;
  /** The caption exactly as it will be sent, hashtags and short link included. */
  caption: string;
  /** The brand's display name, for the post card's byline. */
  brandName?: string;
  /** Where this post is going. Empty means no account has been chosen yet. */
  platforms: string[];
  /** The brand's posting window for this date, when one is known. */
  bestTime?: string;
  onPublish: () => void;
  onSchedule?: () => void;
  onSaveDraft: () => void;
  busy?: boolean;
  error?: string;
}

/** `CF` from `ClientForce AI` — two letters, the design's own treatment. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Every piece of media the post carries, in order.
 *
 * The composed render first when there is one: that file *is* the post, and a
 * preview that shows the raw ingredients above the finished cut answers a
 * different question than "what goes out". The per-beat media follows for a
 * post that has not been composed yet.
 */
function mediaOf(draft: DraftView): Array<{ kind: 'image' | 'video'; url: string }> {
  const rendered = (draft.renders ?? []).map((r) => ({
    kind: r.url.endsWith('.mp4') ? ('video' as const) : ('image' as const),
    url: r.url,
  }));
  if (rendered.length > 0) return rendered.slice(0, 1);

  const out: Array<{ kind: 'image' | 'video'; url: string }> = [];
  for (const b of draft.beats) {
    if (b.kind === 'generated_image') out.push({ kind: 'image', url: b.url });
    else if (b.kind === 'generated_video' || b.kind === 'generated_broll') out.push({ kind: 'video', url: b.url });
    else if (b.kind === 'dubbed_media' && b.mediaType === 'video') out.push({ kind: 'video', url: b.url });
    const back = backdropOf(b);
    if (back) for (const u of back.urls) out.push({ kind: back.kind, url: u });
  }
  return out;
}

/**
 * How each platform judges this caption's length.
 *
 * `PLATFORM_LIMITS` is the mechanical number — what the API rejects — and it is
 * the right one here, because this row is answering "will this send", not "is
 * this a good length". A platform the brand has not connected still gets a row:
 * the design shows one greyed out, and knowing X would refuse it is useful
 * before you connect X.
 */
function counts(caption: string): Array<{ platform: string; limit: number; over: boolean }> {
  return Object.entries(PLATFORM_LIMITS).map(([platform, limits]) => ({
    platform,
    limit: limits.maxLength,
    over: caption.length > limits.maxLength,
  }));
}

export function PostPreview({
  draft,
  caption,
  brandName,
  platforms,
  bestTime,
  onPublish,
  onSchedule,
  onSaveDraft,
  busy,
  error,
}: PostPreviewProps) {
  const name = brandName?.trim() || 'Your brand';
  const media = mediaOf(draft);
  const lengths = counts(caption);

  return (
    <div className="px-[30px] pt-[27px] pb-[30px]">
      <p className="text-15 font-medium text-ink-muted">Post preview</p>

      {/* ── The post, as it will appear ─────────────────────────────────── */}
      <article className="mt-[16px] rounded-[10px] bg-white px-[24px] pt-[18px] pb-[20px] shadow-[0_0_0_1px_rgba(131,131,131,0.18)]">
        <header className="flex items-center gap-[10px]">
          <span
            aria-hidden
            className="flex h-[63px] w-[63px] items-center justify-center rounded-full text-28 font-medium"
            style={{ background: '#CFFCCF', color: '#13AD12' }}
          >
            {initials(name)}
          </span>
          <span>
            <span className="block text-18 font-medium text-ink-muted">{name}</span>
            {/*
              "Sponsored ·" in the design, which this is not — nothing here buys
              placement. The line below it is what the post actually is: an
              organic post, and when it is scheduled, when it goes.
            */}
            <span className="mt-[6px] block text-15 font-medium text-ink-muted">
              {draft.scheduledAt
                ? new Date(draft.scheduledAt).toLocaleString('en', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Not scheduled yet'}
            </span>
          </span>
        </header>

        <p className="mt-[28px] whitespace-pre-wrap text-18 font-medium leading-[1.5] text-ink-muted">
          {caption || '(no written copy)'}
        </p>

        {media.length > 0 ? (
          <div className="mt-[20px] grid grid-cols-1 gap-[10px]">
            {media.map((m, i) =>
              m.kind === 'video' ? (
                <video key={m.url + i} src={m.url} controls className="max-h-[420px] w-full rounded-[10px] bg-black/5" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.url + i} src={m.url} alt="" className="max-h-[420px] w-full rounded-[10px] object-contain" />
              ),
            )}
          </div>
        ) : draft.mediaType !== 'text' ? (
          <p className="mt-[20px] rounded-[10px] px-[18px] py-[16px] text-16 text-ink-muted" style={{ background: 'rgba(131,131,131,0.1)' }}>
            Nothing has been rendered for this post yet — render it from the editor and it appears here.
          </p>
        ) : null}

        <footer className="mt-[24px] flex items-center gap-[52px] border-t border-border/50 pt-[16px]">
          {['Like', 'Comment', 'Share'].map((a) => (
            <span key={a} aria-hidden className="text-16 text-ink-muted">
              {a}
            </span>
          ))}
        </footer>
      </article>

      {/* ── Length, per platform ────────────────────────────────────────── */}
      <p className="mt-[28px] text-15 font-medium text-ink-muted">Character count by platform</p>
      <div className="mt-[14px] flex flex-wrap items-center gap-x-[34px] gap-y-[10px] rounded-[10px] px-[22px] py-[18px]" style={{ background: 'rgba(131,131,131,0.1)' }}>
        {lengths.map((l) => (
          <span key={l.platform} className={cn('text-16 font-medium', l.over ? 'text-destructive' : 'text-ink-muted')}>
            {l.platform} {caption.length}/{l.limit}
          </span>
        ))}
      </div>

      {/* ── Where it goes ──────────────────────────────────────────────── */}
      <p className="mt-[28px] text-15 font-medium text-ink-muted">Publish to</p>
      <div className="mt-[14px] flex flex-wrap items-center gap-[11px]">
        {(platforms.length > 0 ? platforms : ['No account chosen']).map((p) => {
          const limit = PLATFORM_LIMITS[p]?.maxLength;
          const over = limit !== undefined && caption.length > limit;
          const chosen = platforms.includes(p);
          return (
            <span
              key={p}
              className={cn(
                'flex h-[35px] items-center rounded-full px-[18px] text-16 font-medium',
                over ? 'text-ink' : chosen ? 'text-ink' : 'text-ink-muted',
              )}
              style={{
                background: over
                  ? 'rgba(243,85,37,0.32)'
                  : chosen
                    ? 'var(--ss-cyan-200)'
                    : 'rgba(131,131,131,0.2)',
              }}
            >
              {p}
              {over ? ' (over limit)' : ''}
            </span>
          );
        })}
      </div>

      {/* ── When ───────────────────────────────────────────────────────── */}
      {bestTime ? (
        <>
          <p className="mt-[28px] text-15 font-medium text-ink-muted">Schedule</p>
          <div className="mt-[14px] rounded-[10px] px-[13px] py-[13px]" style={{ background: 'rgba(131,131,131,0.1)' }}>
            <div
              className="flex h-[41px] items-center rounded-[10px] px-[30px] text-16 font-semibold"
              style={{ background: 'rgba(163,65,255,0.2)', color: 'var(--ss-purple)' }}
            >
              {bestTime}
            </div>
          </div>
        </>
      ) : null}

      {error ? <p className="mt-[20px] text-14 text-destructive">{error}</p> : null}

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="mt-[40px] flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onPublish}
          disabled={busy}
          className="flex h-[43px] w-[190px] items-center justify-center rounded-[8.457px] bg-ink text-17 font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Publishing…' : 'Publish now'}
        </button>

        <div className="flex items-center gap-[18px]">
          {onSchedule ? (
            <button
              type="button"
              onClick={onSchedule}
              disabled={busy}
              className="flex h-[44px] items-center rounded-[8.457px] px-[20px] text-16 font-medium disabled:opacity-60"
              style={{ background: 'rgba(36,116,237,0.1)', color: '#2474ED' }}
            >
              Schedule
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            className="flex h-[44px] items-center rounded-[8.457px] bg-white px-[24px] text-16 font-medium text-ink shadow-[0_0_0_1px_rgba(131,131,131,0.18)] disabled:opacity-60"
          >
            Save as Draft
          </button>
        </div>
      </div>
    </div>
  );
}
