'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { backdropOf, clock, type ResolvedBeat } from './types';

/**
 * The storyboard — `DP video.dc.html`'s scene list and `DP carousel`'s slides.
 *
 * ── Measured off the rendered prototypes at 1728 ──────────────────────────
 *
 * Video, inside a white r20 container at x821 y948, 875 wide:
 *
 *   scene card    x840 · 837 wide · r15 · rgba(131,131,131,0.05)
 *   accent bar    x840 · 7x280 · r15 — cyan by default, warm when overridden
 *   "Scene 1"     x895 (+55) · 15/500 grey
 *   "0:00–0:04"   x965 · 15/500 grey
 *   badges        h26 · r12.38 · tinted 10–20%, label 12.38/500 in the tint's hue
 *   description   x895 · +55 from the card top · 18/500 ink
 *   script card   x891 · 771 wide · r14.06 · white
 *     "Voiceover script" 15.51/500 grey, voice name right 12.57/500 grey
 *     script box  x910 · 729x87 · r10.158 · white, body 16/500 ink
 *     footer      "~3.2s · fits scene length" left; Rewrite; Audio override
 *   add scene     837x65 · r10 · rgba(131,131,131,0.1), label centred 18/500
 *
 * Carousel, with no container around it:
 *
 *   slide card    x818 · 875x181 · r15 · rgba(131,131,131,0.05) · 198 pitch
 *   thumbnail     x873 (+55) · 124x147 · r10 · tinted by the slide's role
 *   "Slide 1"     x1017 (+199) · 15/500 grey, badge beside it
 *   title         x1017 · 18/500 ink
 *   description   x1017 · 16/500 grey
 *
 * ── What fills it ─────────────────────────────────────────────────────────
 *
 * `ResolvedBeat`, which already carries everything the design draws: `label` is
 * the badge the prototype puts in the first pill ("Hook", "CTA"), `durationSec`
 * gives the ranges and the running total, and `voice` is the per-scene audio
 * override that earns the amber pill and the warm accent bar. The second pill —
 * "Talking head", "B-roll + text overlay" — is the beat's own `kind`, which is
 * the one thing the design names that the beat does not spell out.
 *
 * So this renders a real storyboard or nothing. A post with no beats yet says
 * so in one line rather than drawing five placeholder cards, because five grey
 * cards that cannot be clicked look like a storyboard that failed to load.
 */

/** The badge palette, from `tokens.css`. One colour per scene kind. */
const HUE = {
  hook: 'var(--ss-purple)',
  cta: 'var(--ss-scene-cta)',
  talking: 'var(--ss-scene-talking)',
  broll: 'var(--ss-scene-broll)',
  override: 'var(--ss-scene-override)',
  silent: 'var(--ss-orange-500)',
  neutral: 'var(--ss-fg-muted)',
} as const;

type Hue = keyof typeof HUE;

/**
 * The kind pill's words.
 *
 * `label` is the author's badge and `kind` is what the beat actually is, so
 * both are shown — a scene labelled "Hook" can be a talking head or b-roll, and
 * the design draws that pair side by side.
 */
function kindBadge(beat: ResolvedBeat): { text: string; hue: Hue } | null {
  switch (beat.kind) {
    case 'generated_video':
      return { text: 'Talking head', hue: 'talking' };
    case 'generated_broll':
      return { text: 'B-roll + text overlay', hue: 'broll' };
    case 'generated_image':
      return { text: 'Generated image', hue: 'broll' };
    case 'generated_audio':
      return { text: 'Voiceover', hue: 'talking' };
    case 'dubbed_media':
      return { text: `Dubbed · ${beat.targetLanguage}`, hue: 'broll' };
    case 'asset':
      return { text: 'Brand asset', hue: 'neutral' };
    case 'text':
      return { text: 'Text card', hue: 'neutral' };
    default:
      return null;
  }
}

/** A label's hue — the two the design colours specially, grey otherwise. */
function labelHue(label: string): Hue {
  const l = label.toLowerCase();
  if (l.includes('hook')) return 'hook';
  if (l.includes('cta') || l.includes('call to action')) return 'cta';
  return 'neutral';
}

/** The words a scene shows as its description — whatever the beat carries. */
function describe(beat: ResolvedBeat): string {
  switch (beat.kind) {
    case 'text':
      return beat.text;
    case 'asset':
      return beat.caption ?? 'Brand asset';
    case 'generated_image':
    case 'generated_broll':
      return beat.prompt;
    case 'generated_video':
    case 'generated_audio':
      return beat.script;
    case 'dubbed_media':
      return `Re-voiced into ${beat.targetLanguage}`;
    default:
      return '';
  }
}

/** The spoken line, where there is one. Only these two kinds carry a script. */
function scriptOf(beat: ResolvedBeat): string | null {
  return beat.kind === 'generated_video' || beat.kind === 'generated_audio' ? beat.script : null;
}

export interface StoryboardProps {
  beats: ResolvedBeat[];
  /** The post's default voice, shown on each scene that has not overridden it. */
  voiceName?: string;
  /** Add a scene to the end. Absent hides the strip rather than showing a dead control. */
  onAddScene?: () => void;
  /** Rewrite one scene's script. */
  onRewrite?: (beatId: string) => void;
  /** Give one scene its own audio instead of the post's default. */
  onAudioOverride?: (beatId: string) => void;
  busy?: boolean;
  /**
   * The controls for one scene, revealed by its "Edit scene" button.
   *
   * This is how the editor phase keeps its capability while wearing the
   * design's clothes: the card is `DP video`'s presentation and this is
   * `BeatRow` — retime, reorder, remove, set the voice, regenerate the footage
   * — opening inside it. A storyboard with no `renderDetail` is read-only and
   * shows no edit affordance, which is what the trigger phase wants.
   */
  renderDetail?: (beat: ResolvedBeat, index: number) => ReactNode;
  /**
   * What the "Add scene" strip reveals.
   *
   * The strip is the design's control and this is the form behind it. Passing
   * the form rather than re-implementing it keeps one "add a scene" in the
   * panel: the existing one, which knows that a new scene is a written slot and
   * not a generate call.
   */
  addSlot?: ReactNode;
}

export function VideoStoryboard({
  beats,
  voiceName,
  onAddScene,
  onRewrite,
  onAudioOverride,
  busy,
  renderDetail,
  addSlot,
}: StoryboardProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (beats.length === 0) return <EmptyStoryboard what="The storyboard appears here once this post is generated." />;

  let elapsed = 0;
  return (
    <div className="mt-[16px] rounded-[20px] bg-white p-[19px]">
      <ul className="flex flex-col gap-[20px]">
        {beats.map((beat, i) => {
          const from = elapsed;
          const dur = beat.durationSec ?? 0;
          elapsed += dur;
          return (
            <li key={beat.beatId}>
              <SceneCard
                beat={beat}
                index={i}
                from={from}
                to={elapsed}
                hasDuration={beat.durationSec !== undefined}
                voiceName={voiceName}
                onRewrite={onRewrite}
                onAudioOverride={onAudioOverride}
                busy={busy}
                detail={renderDetail}
                open={openId === beat.beatId}
                onToggle={renderDetail ? () => setOpenId((id) => (id === beat.beatId ? null : beat.beatId)) : undefined}
              />
            </li>
          );
        })}
      </ul>

      {onAddScene ? <AddStrip label="Add scene" onClick={onAddScene} busy={busy} /> : null}
      {addSlot}
    </div>
  );
}

function SceneCard({
  beat,
  index,
  from,
  to,
  hasDuration,
  voiceName,
  onRewrite,
  onAudioOverride,
  busy,
  detail,
  open,
  onToggle,
}: {
  beat: ResolvedBeat;
  index: number;
  from: number;
  to: number;
  hasDuration: boolean;
  voiceName?: string;
  onRewrite?: (beatId: string) => void;
  onAudioOverride?: (beatId: string) => void;
  busy?: boolean;
  detail?: (beat: ResolvedBeat, index: number) => ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const kind = kindBadge(beat);
  const script = scriptOf(beat);
  const overridden = beat.voice !== undefined;

  return (
    <div className="relative overflow-hidden rounded-[15px] py-[17px] pl-[55px] pr-[15px]" style={{ background: 'rgba(131,131,131,0.05)' }}>
      {/* The 7px bar down the left edge, warm when the scene departs from the
          post's default audio — the design's own signal for that. */}
      <span
        aria-hidden
        className="absolute left-0 top-[6px] bottom-[6px] w-[7px] rounded-[15px]"
        style={{ background: overridden ? 'var(--ss-scene-bar-warm)' : 'var(--ss-cyan)' }}
      />

      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[6px]">
        <span className="text-15 font-medium text-ink-muted">Scene {index + 1}</span>
        {/* A legacy beat carries no duration, so it shows none rather than 0:00. */}
        {hasDuration ? (
          <span className="text-15 font-medium text-ink-muted">
            {clock(from)}–{clock(to)}
          </span>
        ) : null}
        {beat.label ? <Badge text={beat.label} hue={labelHue(beat.label)} /> : null}
        {kind ? <Badge text={kind.text} hue={kind.hue} /> : null}
        {overridden ? <Badge text="Audio override" hue="override" /> : null}
        {script === null ? <Badge text="No voiceover" hue="silent" /> : null}

        {/*
          The way into the scene's controls. Pushed right so the badges keep
          the design's reading order, and absent entirely when nothing can be
          edited — the trigger phase's storyboard is a preview.
        */}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="ml-auto text-15 font-medium text-brand-purple hover:underline"
          >
            {open ? 'Done' : 'Edit scene'}
          </button>
        ) : null}
      </div>

      <p className="mt-[17px] text-18 font-medium leading-[1.28] text-ink">{describe(beat)}</p>

      {/*
        The footage behind this scene's words.

        A row of thumbnails rather than one, because a long beat is covered by
        several clips in sequence — the renderer divides the scene between them,
        so showing only the first would misreport what the scene contains.
      */}
      <BackdropStrip beat={beat} />
      {beat.kind === 'generated_video' || beat.kind === 'generated_broll' ? (
        <video src={beat.url} controls className="mt-[14px] max-h-[220px] rounded-[10px]" />
      ) : beat.kind === 'generated_image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={beat.url} alt="" className="mt-[14px] max-h-[220px] rounded-[10px] object-contain" />
      ) : null}

      {script === null ? (
        <div className="mt-[19px] rounded-[14.058px] bg-white px-[19px] py-[16px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-16 font-medium text-ink">This scene runs without a voiceover.</p>
          </div>
        </div>
      ) : (
        <div className="mt-[19px] rounded-[14.058px] bg-white px-[19px] py-[9px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-15 font-medium text-ink-muted">Voiceover script</span>
            {/* The scene's own voice when it has one, otherwise the post's. */}
            <span className="text-12 font-medium text-ink-muted">
              {overridden ? (beat.voice === 'brand' ? 'Brand voice' : 'Stock voice') : (voiceName ?? '')}
            </span>
          </div>

          <div className="mt-[14px] rounded-[10.158px] bg-white px-[17px] py-[12px] shadow-[0_0_0_1px_rgba(131,131,131,0.18)]">
            <p className="text-16 font-medium leading-[1.3] text-ink">{script}</p>
          </div>

          <div className="mt-[13px] flex flex-wrap items-center justify-between gap-3">
            <span className="text-15 font-medium text-ink-muted">{fitNote(script, beat.durationSec)}</span>
            <div className="flex items-center gap-[37px]">
              {onRewrite ? (
                <button
                  type="button"
                  onClick={() => onRewrite(beat.beatId)}
                  disabled={busy}
                  className="text-15 font-medium text-ink-muted hover:text-ink hover:underline disabled:opacity-50"
                >
                  Rewrite
                </button>
              ) : null}
              {onAudioOverride ? (
                <button
                  type="button"
                  onClick={() => onAudioOverride(beat.beatId)}
                  disabled={busy}
                  className={cn('text-15 font-medium hover:underline disabled:opacity-50')}
                  style={overridden ? { color: HUE.override } : undefined}
                >
                  Audio override
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/*
        The scene's controls, below the card's own summary. Mounted only while
        open: `BeatRow` seeds its textarea from the beat once, on mount, so a
        row kept mounted and hidden would show stale words the next time the
        card was opened after a regenerate.
      */}
      {open && detail ? (
        <div className="mt-[16px] rounded-[14.058px] bg-white px-[19px] py-[16px]">{detail(beat, index)}</div>
      ) : null}
    </div>
  );
}

/**
 * A scene's backdrop clips, in the order the renderer plays them.
 *
 * Videos get a `<video>` with controls rather than a poster frame: a still of a
 * generated clip is indistinguishable from a generated image, and the question
 * this row answers is "what will this scene look like", which needs playing.
 */
function BackdropStrip({ beat }: { beat: ResolvedBeat }) {
  const back = backdropOf(beat);
  if (!back) return null;
  return (
    <div className="mt-[14px] flex flex-wrap gap-[10px]">
      {back.urls.map((u, i) =>
        back.kind === 'video' ? (
          <video key={u + i} src={u} controls className="h-[120px] rounded-[10px] bg-black/5" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={u + i} src={u} alt="" className="h-[120px] rounded-[10px] object-cover" />
        ),
      )}
    </div>
  );
}

/**
 * "~3.2s · fits scene length".
 *
 * Read aloud at roughly 2.6 words a second, which is the middle of a
 * conversational range and close enough to tell a script that overruns its
 * scene from one that does not. It says "over by" rather than "fits" when it
 * does not fit — the design only drew the happy case, and a note that always
 * says "fits" is worth nothing.
 */
function fitNote(script: string, durationSec?: number): string {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const secs = words / 2.6;
  const rounded = `~${secs.toFixed(1)}s`;
  if (durationSec === undefined) return rounded;
  if (secs <= durationSec) return `${rounded} · fits scene length`;
  return `${rounded} · over by ${(secs - durationSec).toFixed(1)}s`;
}

export interface CarouselStoryboardProps {
  beats: ResolvedBeat[];
  onAddScene?: () => void;
  busy?: boolean;
  /** One slide's controls — see `renderDetail` on the video storyboard. */
  renderDetail?: (beat: ResolvedBeat, index: number) => ReactNode;
  addSlot?: ReactNode;
}

export function CarouselStoryboard({ beats, onAddScene, busy, renderDetail, addSlot }: CarouselStoryboardProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (beats.length === 0) return <EmptyStoryboard what="The slides appear here once this post is generated." />;

  return (
    <div className="mt-[14px]">
      <ul className="flex flex-col gap-[17px]">
        {beats.map((beat, i) => (
          <li key={beat.beatId}>
            <SlideCard
              beat={beat}
              index={i}
              detail={renderDetail}
              open={openId === beat.beatId}
              onToggle={renderDetail ? () => setOpenId((id) => (id === beat.beatId ? null : beat.beatId)) : undefined}
            />
          </li>
        ))}
      </ul>

      {onAddScene ? <AddStrip label="Add slide" onClick={onAddScene} busy={busy} /> : null}
      {addSlot}
    </div>
  );
}

function SlideCard({
  beat,
  index,
  detail,
  open,
  onToggle,
}: {
  beat: ResolvedBeat;
  index: number;
  detail?: (beat: ResolvedBeat, index: number) => ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const hue = beat.label ? labelHue(beat.label) : 'neutral';
  /*
   * The thumbnail is the slide's own picture where one exists.
   *
   * The design tints it by role — cyan on the hook, green on the CTA, grey in
   * between — which is what a slide with no rendered image gets here. A slide
   * that *has* an image shows the image, because a tinted rectangle standing in
   * for a picture the post already has is a worse thumbnail than the picture.
   */
  const url =
    beat.kind === 'generated_image' || beat.kind === 'generated_broll' || beat.kind === 'dubbed_media'
      ? beat.url
      : // A slide whose words kept their place and gained a picture behind them.
        // The commonest case by far, and the one nothing used to draw.
        (backdropOf(beat)?.urls[0] ?? null);
  const tint =
    hue === 'hook' ? 'rgba(108,232,255,0.3)' : hue === 'cta' ? 'rgba(31,175,19,0.2)' : 'rgba(131,131,131,0.2)';

  return (
    <div className="rounded-[15px] px-[55px] py-[17px]" style={{ background: 'rgba(131,131,131,0.05)' }}>
      <div className="flex gap-[20px]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-[147px] w-[124px] shrink-0 rounded-[10px] object-cover" />
      ) : (
        <span aria-hidden className="h-[147px] w-[124px] shrink-0 rounded-[10px]" style={{ background: tint }} />
      )}

      <div className="min-w-0 flex-1 pt-[8px]">
        <div className="flex flex-wrap items-center gap-x-[11px] gap-y-[6px]">
          <span className="text-15 font-medium text-ink-muted">Slide {index + 1}</span>
          {beat.label ? <Badge text={beat.label} hue={hue} /> : null}
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="ml-auto text-15 font-medium text-brand-purple hover:underline"
            >
              {open ? 'Done' : 'Edit slide'}
            </button>
          ) : null}
        </div>

        {/*
          The design's slide has a headline and a layout note beneath it. A beat
          carries one string, so the headline is its first sentence — and when
          that is the whole string, the note is dropped rather than repeating
          it. Observed live: every one-sentence slide printed its own text
          twice, once in ink and once in grey.
        */}
        <p className="mt-[22px] text-18 font-medium leading-[1.28] text-ink">{title(beat)}</p>
        {note(beat) ? (
          <p className="mt-[11px] text-16 font-medium leading-[1.25] text-ink-muted">{note(beat)}</p>
        ) : null}
      </div>
      </div>

      {open && detail ? (
        <div className="mt-[16px] rounded-[14.058px] bg-white px-[19px] py-[16px]">{detail(beat, index)}</div>
      ) : null}
    </div>
  );
}

/**
 * A slide's headline.
 *
 * The design gives each slide a title and a layout note. A beat has one string,
 * so its first line is the title and the whole of it is the note — which is how
 * the copy is actually written, rather than a second field invented to fill the
 * row.
 */
function title(beat: ResolvedBeat): string {
  const first = describe(beat).split(/[.\n]/)[0]?.trim() ?? '';
  return first.length > 0 ? first : `Slide ${beat.beatId.slice(0, 6)}`;
}

/** Whatever the slide says after its headline, or nothing when that is all of it. */
function note(beat: ResolvedBeat): string {
  const whole = describe(beat).trim();
  const rest = whole.slice(title(beat).length).replace(/^[.\s]+/, '').trim();
  return rest;
}

function Badge({ text, hue }: { text: string; hue: Hue }) {
  const colour = HUE[hue];
  return (
    <span
      className="flex h-[26px] items-center rounded-[12.381px] px-[12px] text-12 font-medium"
      /*
        Inline, because `bg-[rgba(...)]` and `color-mix` in an arbitrary class
        both failed silently here once already — see the note on the rail tiles
        in `DraftDrawer`. `color-mix` in a style attribute is evaluated by the
        browser, not by a class-name escaper.
      */
      style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, transparent)` }}
    >
      {text}
    </span>
  );
}

function AddStrip({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-[16px] flex h-[65px] w-full items-center justify-center gap-[10px] rounded-[10px] text-18 font-medium text-ink disabled:opacity-50"
      style={{ background: 'rgba(131,131,131,0.1)' }}
    >
      <span aria-hidden className="text-20 leading-none">+</span>
      {label}
    </button>
  );
}

/**
 * No beats yet.
 *
 * The trigger phase reaches this every time: the storyboard is what
 * `content.draft` produces, so before that there is nothing to draw. One line
 * beats five grey cards that look like a storyboard which failed to load.
 */
function EmptyStoryboard({ what }: { what: string }) {
  return (
    <div className="mt-[14px] rounded-[15px] px-[24px] py-[22px]" style={{ background: 'rgba(131,131,131,0.05)' }}>
      <p className="text-16 font-medium text-ink-muted">{what}</p>
    </div>
  );
}
