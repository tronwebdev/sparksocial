'use client';

import { useState } from 'react';
import { PLATFORM_LIMITS, platformTakes, type PostFormat } from '@sparksocial/shared';
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
  /** Every platform the picker offers. */
  options: readonly string[];
  /** The one currently chosen to publish to. */
  selected: string;
  onSelect: (platform: string) => void;
  /** The brand's posting window for this date, when one is known. */
  bestTime?: string;
  /** "Edit outline" — the storyboard is where a slide is actually changed. */
  onEditOutline?: () => void;
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
  /*
    `.slice(0, 1)` for everything except a carousel, and that exception is the
    whole bug. For a video or an image there is one composed file and it *is*
    the post. A carousel's renders are its slides — six files, one per slide —
    so taking the first one turned a six-slide carousel into a single image,
    which is exactly how it looked on the deployed site.
  */
  if (rendered.length > 0) return draft.mediaType === 'carousel' ? rendered : rendered.slice(0, 1);

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


/**
 * A carousel, previewed as a carousel.
 *
 * ── What it replaces ─────────────────────────────────────────────────────
 *
 * Every slide, stacked vertically, in a one-column grid. That is a contact
 * sheet, not a preview: nobody scrolling Instagram sees six images at once,
 * they see the first one and decide whether to swipe. A reviewer looking at
 * the stack cannot tell whether slide 1 earns the swipe, which is the only
 * question a carousel preview has to answer. It also read as a single image
 * when only one slide had been rendered, which is how this was reported.
 *
 * `DP prevCarousel.dc.html` shows one slide in a 4:5 frame, arrows either
 * side, "Slide 2 of 6" above it and a numbered pager below. That is this.
 *
 * ── The pager is the point ───────────────────────────────────────────────
 *
 * Both controls are here on purpose. The arrows are how you read it in order,
 * the way the post is consumed; the numbered pager is how you jump to the
 * slide somebody has complained about. Keyboard arrows do the same, because a
 * reviewer going through six slides should not have to aim at a 28px target
 * six times.
 */
function CarouselDeck({
  media,
  label,
  onEditOutline,
}: {
  media: Array<{ kind: 'image' | 'video'; url: string }>;
  label: string;
  /** "Edit outline" — back to the storyboard, which is where slides are changed. */
  onEditOutline?: () => void;
}) {
  const [at, setAt] = useState(0);
  /*
    "All slides", from the design's own button row.

    One slide at a time is how the post is read and how you judge whether slide
    1 earns the swipe. It is the wrong view for "does this hang together" —
    that question is about the sequence, and answering it one slide at a time
    means holding five slides in your head. Both views, one button.
  */
  const [grid, setGrid] = useState(false);
  const total = media.length;
  const current = media[Math.min(at, total - 1)]!;
  const go = (next: number) => setAt(((next % total) + total) % total);

  return (
    <div
      className="mt-[20px]"
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      }}
    >
      <p className="text-15 font-medium text-ink-muted" aria-live="polite">
        Slide {at + 1} of {total}
      </p>

      {grid ? (
        <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
          {media.map((m, i) => (
            <button
              key={m.url + i}
              type="button"
              aria-label={`Open slide ${i + 1}`}
              onClick={() => {
                setAt(i);
                setGrid(false);
              }}
              className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[10px]"
              style={{ background: 'rgba(131,131,131,0.1)' }}
            >
              {m.kind === 'video' ? (
                <video src={m.url} className="h-full w-full object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={`Slide ${i + 1}`} className="h-full w-full object-contain" />
              )}
            </button>
          ))}
        </div>
      ) : (
      <div className="mt-[10px] flex items-center gap-[10px]">
        <button
          type="button"
          aria-label="Previous slide"
          onClick={() => go(at - 1)}
          className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-white text-16 text-ink shadow-[0_0_0_1px_rgba(131,131,131,0.25)]"
        >
          &#8249;
        </button>

        {/*
          4:5 — the ratio the carousel playbooks render at (1080x1350), and the
          one the design labels under the frame. `object-contain` rather than
          `cover`, because a slide cropped in the preview is a slide whose
          cropping nobody approved.
        */}
        <div className="flex aspect-[4/5] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[10px]" style={{ background: 'rgba(131,131,131,0.1)' }}>
          {current.kind === 'video' ? (
            <video src={current.url} controls className="h-full w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.url} alt={`Slide ${at + 1} of ${total}`} className="h-full w-full object-contain" />
          )}
        </div>

        <button
          type="button"
          aria-label="Next slide"
          onClick={() => go(at + 1)}
          className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-white text-16 text-ink shadow-[0_0_0_1px_rgba(131,131,131,0.25)]"
        >
          &#8250;
        </button>
      </div>
      )}

      <div className="mt-[12px] flex flex-wrap items-center justify-center gap-[6px]">
        {media.map((m, i) => (
          <button
            key={m.url + i}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === at ? 'true' : undefined}
            onClick={() => setAt(i)}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-13 font-medium transition-colors"
            style={
              i === at
                ? { background: 'var(--ss-cyan-200)', color: 'var(--ss-ink)' }
                : { background: 'rgba(131,131,131,0.12)', color: 'var(--ss-ink-muted)' }
            }
          >
            {i + 1}
          </button>
        ))}
      </div>

      <p className="mt-[10px] text-center text-13 text-ink-muted">4:5 &middot; 1080&times;1350</p>

      {/*
        The design's two buttons under the frame, at 875,697 and 1030,697 in
        16/500 ink. "Edit outline" is the storyboard — the one place a slide's
        words and picture are actually changed — rather than a second editor
        grown inside the preview.
      */}
      <div className="mt-[14px] flex flex-wrap items-center justify-center gap-[18px]">
        <button
          type="button"
          onClick={() => setGrid((g) => !g)}
          className="text-16 font-medium text-ink hover:underline"
        >
          {grid ? 'One at a time' : 'All slides'}
        </button>
        {onEditOutline ? (
          <button type="button" onClick={onEditOutline} className="text-16 font-medium text-ink hover:underline">
            Edit outline
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The post card — `DP prevText.dc.html`, and only that.
 *
 * Avatar, byline, copy, media, and the platform's engagement row: a text post
 * previewed as a post. The media formats do not use it, because their design
 * does not — see the layout note on `PostPreview`.
 */
function PostCard({
  name,
  draft,
  caption,
  media,
}: {
  name: string;
  draft: DraftView;
  caption: string;
  media: Array<{ kind: 'image' | 'video'; url: string }>;
}) {
  return (
    <article className="rounded-[10px] bg-white px-[24px] pt-[18px] pb-[20px] shadow-[0_0_0_1px_rgba(131,131,131,0.18)]">
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
      ) : null}

      <footer className="mt-[24px] flex items-center gap-[52px] border-t border-border/50 pt-[16px]">
        {['Like', 'Comment', 'Share'].map((a) => (
          <span key={a} aria-hidden className="text-16 text-ink-muted">
            {a}
          </span>
        ))}
      </footer>
    </article>
  );
}

/**
 * The media column of the two-column preview — `DP prevImage` / `prevCarousel`.
 *
 * 324x405 at the 1728 stage, which is 4:5 exactly, with the format printed
 * under it in 18/500 grey. A carousel puts its deck here; everything else puts
 * its one composed file.
 */
function MediaPane({
  draft,
  media,
  caption,
  onEditOutline,
}: {
  draft: DraftView;
  media: Array<{ kind: 'image' | 'video'; url: string }>;
  caption: string;
  onEditOutline?: () => void;
}) {
  if (media.length === 0) {
    return (
      <p
        className="rounded-[10px] px-[18px] py-[16px] text-16 text-ink-muted"
        style={{ background: 'rgba(131,131,131,0.1)' }}
      >
        Nothing has been rendered for this post yet — render it from the editor and it appears here.
      </p>
    );
  }

  if (draft.mediaType === 'carousel') {
    return (
      <CarouselDeck
        media={media}
        label={caption.slice(0, 60) || 'Carousel preview'}
        {...(onEditOutline ? { onEditOutline } : {})}
      />
    );
  }

  const one = media[0]!;
  return (
    <div>
      <div
        className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[10px]"
        style={{ background: 'rgba(131,131,131,0.1)' }}
      >
        {one.kind === 'video' ? (
          <video src={one.url} controls className="h-full w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={one.url} alt="" className="h-full w-full object-contain" />
        )}
      </div>
      <p className="mt-[10px] text-18 font-medium text-ink-muted">4:5 &middot; 1080&times;1350</p>
    </div>
  );
}

export function PostPreview({
  draft,
  caption,
  brandName,
  platforms,
  options,
  selected,
  onSelect,
  bestTime,
  onEditOutline,
  onPublish,
  onSchedule,
  onSaveDraft,
  busy,
  error,
}: PostPreviewProps) {
  const name = brandName?.trim() || 'Your brand';
  const media = mediaOf(draft);
  const lengths = counts(caption);

  /*
    ── One column or two ──────────────────────────────────────────────────

    This file was built from `DP prevText.dc.html` and applied that layout to
    every format. Half right: the prototypes disagree with each other on
    purpose, and the disagreement is the design.

    Measured at the 1728 stage, `prevText` is one column — "Post preview" at
    821,147, the engagement row at y543, the character counts at y609. But
    `prevImage` and `prevCarousel` are two: the media at 822,184 in a 324x405
    frame (4:5 exactly), and a 493-wide column from x1195 holding the caption,
    the platforms and the schedule. Both media prototypes place their pieces at
    identical coordinates, so it is one layout for both rather than a carousel
    special case.

    Which follows from what each is for. A text post has nothing to look at but
    the words, so the preview is the post. A post with media asks two questions
    — is the picture right, is the copy right — and the design puts one on each
    side so neither answer requires scrolling past the other.
  */
  const twoColumn = draft.mediaType !== 'text';

  /* ── The caption, with the one action the design gives it ───────────── */
  const captionPane = (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-15 font-medium text-ink-muted">AI-written caption</p>
        {/*
          "Rewrite" in the design, in its purple. That control already exists
          one phase back as "Ask for a change", which edits this copy with the
          same tools — so this names where it is instead of offering a second,
          differently-worded version of it.
        */}
        <span
          className="text-14 font-medium"
          style={{ color: '#A341FF' }}
          title="Edit the copy in the editor — Back to editor, then Ask for a change."
        >
          Rewrite in the editor
        </span>
      </div>
      <div className="mt-[14px] max-h-[167px] overflow-y-auto rounded-[10px] bg-white px-[20px] py-[16px] shadow-[0_0_0_1px_rgba(131,131,131,0.18)]">
        <p className="whitespace-pre-wrap text-16 font-medium leading-[1.5] text-ink-muted">
          {caption || '(no written copy)'}
        </p>
      </div>
    </div>
  );

  /* ── Length, per platform ──────────────────────────────────────────── */
  const countsPane = (
    <div>
      <p className="text-15 font-medium text-ink-muted">Character count by platform</p>
      <div
        className="mt-[14px] flex flex-wrap items-center gap-x-[34px] gap-y-[10px] rounded-[10px] px-[22px] py-[18px]"
        style={{ background: 'rgba(131,131,131,0.1)' }}
      >
        {lengths.map((l) => (
          <span key={l.platform} className={cn('text-16 font-medium', l.over ? 'text-destructive' : 'text-ink-muted')}>
            {l.platform} {caption.length}/{l.limit}
          </span>
        ))}
      </div>
    </div>
  );

  /*
    ── Where it goes ──────────────────────────────────────────────────────

    One row, not two. This used to be a read-only list of the accounts the
    calendar slot had chosen, and the panel rendered a *second* "Publish to"
    underneath it — a row of buttons that actually set the target. Two headings
    with the same words, one inert and one live, on the same screen. The live
    one wins and the slot's accounts moved into the line beneath the row, which
    is where that fact belongs: context for the choice, not a second control.

    Unavailable is a state, not an omission. A platform that cannot carry this
    format stays in the row, greyed and unclickable, with the reason printed
    underneath — the design does exactly this for TikTok on a carousel. Hiding
    it would leave somebody looking for the platform they expected and finding
    nothing to explain its absence.
  */
  const publishPane = (
    <div>
      <p className="text-15 font-medium text-ink-muted">Publish to</p>
      <div className="mt-[14px] flex flex-wrap items-center gap-[11px]">
        {options.map((p) => {
          const limit = PLATFORM_LIMITS[p]?.maxLength;
          const over = limit !== undefined && caption.length > limit;
          const takes = platformTakes(p, draft.mediaType as PostFormat);
          const chosen = p === selected;
          return (
            <button
              key={p}
              type="button"
              disabled={!takes.ok}
              aria-pressed={chosen}
              {...(takes.reason ? { title: takes.reason } : {})}
              onClick={() => onSelect(p)}
              className={cn(
                'flex h-[35px] items-center rounded-full px-[18px] text-16 font-medium capitalize transition-colors',
                !takes.ok ? 'cursor-not-allowed text-ink-muted opacity-50' : chosen ? 'text-ink' : 'text-ink-muted',
              )}
              style={{
                background:
                  over && chosen ? 'rgba(243,85,37,0.32)' : chosen ? 'var(--ss-cyan-200)' : 'rgba(131,131,131,0.2)',
              }}
            >
              {p.replace('_', ' ')}
              {over && chosen ? ' (over limit)' : ''}
            </button>
          );
        })}
      </div>

      {/* The refusals, spelled out. One line per platform this post cannot use. */}
      {options
        .map((p) => ({ p, takes: platformTakes(p, draft.mediaType as PostFormat) }))
        .filter((x) => !x.takes.ok)
        .map((x) => (
          <p key={x.p} className="mt-[8px] text-13 text-ink-muted">
            {x.takes.reason}
          </p>
        ))}

      {/* What the calendar slot already decided, as context rather than a control. */}
      <p className="mt-[10px] text-13 text-ink-muted">
        {platforms.length > 0
          ? `This slot is set to ${platforms.join(', ')}.`
          : 'No account has been connected for this slot yet.'}
      </p>
    </div>
  );

  /* ── When ───────────────────────────────────────────────────────────── */
  const schedulePane = bestTime ? (
    <div>
      <p className="text-15 font-medium text-ink-muted">Schedule</p>
      <div className="mt-[14px] rounded-[10px] px-[13px] py-[13px]" style={{ background: 'rgba(131,131,131,0.1)' }}>
        <div
          className="flex h-[41px] items-center rounded-[10px] px-[30px] text-16 font-semibold"
          style={{ background: 'rgba(163,65,255,0.2)', color: 'var(--ss-purple)' }}
        >
          {bestTime}
        </div>
      </div>
    </div>
  ) : null;

  /*
    ── Actions ────────────────────────────────────────────────────────────

    "Publish now" at the left edge and the quieter pair at the right, which is
    where `prevCarousel` puts them: x828 against x1423 and x1571 on an 868-wide
    pane. The split is doing work — the irreversible one is nowhere near the
    two that are not.
  */
  const actions = (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-[20px]">
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
  );

  return (
    <div className="px-[30px] pt-[27px] pb-[30px]">
      {/*
        "Review your post" — 18/600 ink at 867,63, with the state beside it in
        14/600. The design's word is "Generated", which is true of a post that
        has pixels and false of one that does not, so it is read from the post
        rather than printed unconditionally.
      */}
      <div className="flex items-baseline gap-[22px]">
        <h2 className="text-18 font-semibold text-ink">Review your post</h2>
        <span className="text-14 font-semibold" style={{ color: media.length > 0 ? '#13D711' : '#838383' }}>
          {media.length > 0 ? 'Generated' : draft.mediaType === 'text' ? 'Written' : 'Not rendered'}
        </span>
      </div>

      {twoColumn ? (
        /*
          324 + 49 + 493 = 866 on the design's 868-wide pane. The left column is
          fixed because 4:5 at a fixed width is what the format is; the right
          one takes the rest. Below `canvas` they stack, media first — the order
          the two questions get asked in.
        */
        <div className="mt-[28px] flex items-start gap-[49px] max-canvas:flex-col max-canvas:gap-[24px]">
          <div className="w-[324px] shrink-0 max-canvas:w-full">
            <MediaPane draft={draft} media={media} caption={caption} {...(onEditOutline ? { onEditOutline } : {})} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[28px] max-canvas:w-full">
            {captionPane}
            {publishPane}
            {schedulePane}
            {countsPane}
          </div>
        </div>
      ) : (
        <div className="mt-[28px] flex flex-col gap-[28px]">
          <PostCard name={name} draft={draft} caption={caption} media={media} />
          {countsPane}
          {publishPane}
          {schedulePane}
        </div>
      )}

      {error ? <p className="mt-[20px] text-14 text-destructive">{error}</p> : null}

      <div className="mt-[40px]">{actions}</div>
    </div>
  );
}
