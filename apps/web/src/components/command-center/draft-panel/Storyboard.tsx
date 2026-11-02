'use client';

import { useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { backdropOf, clock, type ResolvedBeat } from './types';
import {
  AddPlusIcon,
  AudioOverrideIcon,
  DragHandleIcon,
  MicOffIcon,
  PersonSmallIcon,
  RewriteIcon,
  SceneCloseIcon,
  ScriptMicIcon,
  SlideImageIcon,
  SmallPlusIcon,
} from './icons';

/**
 * The storyboard — `DP video.dc.html`'s scene list and `DP carousel`'s slides.
 *
 * ── Measured off the rendered prototypes at 1728 ──────────────────────────
 *
 * Video, inside a white r20 container at x821 y948, 875 wide, ringed grey 20%:
 *
 *   scene card    x840 · 837 wide · r15 · rgba(131,131,131,0.05), ringed grey 30%
 *   accent bar    x840 · 7x280 · r15 — cyan by default, warm when overridden
 *   "Scene 1"     x895 (+55) · 15/500 grey
 *   "0:00–0:04"   x965 · 15/500 grey
 *   badges        h26 · r12.38 · tinted 10–20%, label 12.38/500 in the tint's hue
 *   description   x895 · +55 from the card top · 18/500 ink
 *   script card   x891 · 771 wide · r14.06 · white
 *     "Voiceover script" 15.51/500 grey, voice name right 12.57/500 grey
 *     script box  x910 · 729x87 · r10.158 · white on a violet glow, body 16/500 ink
 *     footer      "~3.2s · fits scene length" left; Rewrite; Audio override
 *   add scene     837x65 · r10 · rgba(131,131,131,0.1), ringed grey 30%, label centred 18/500
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
  /**
   * Remove one scene — the 26px close box at each card's top right.
   *
   * This is the panel's existing `content.scene.remove`, moved out of the
   * opened controls to where `DP video` draws it, not a second way to do it:
   * `BeatRow` stops offering "Remove scene" inside a storyboard card.
   */
  onRemoveScene?: (beatId: string) => void;
  /**
   * Move one scene to a new position — what the gutter's drag handle does.
   *
   * The same `content.scene.reorder` the opened controls' Move up / Move down
   * call, which stay there for anyone not using a pointer.
   */
  onMoveScene?: (beatId: string, toIndex: number) => void;
}

/** The id each video scene card carries, so the storyboard's numbered squares can scroll to it. */
export function sceneAnchor(beatId: string): string {
  return `dp-scene-${beatId}`;
}

/**
 * Drag-to-reorder for a storyboard list, through the panel's own reorder.
 *
 * Native drag and drop and nothing more: the handle starts the drag, a card
 * accepts the drop, and the drop is one `onMove` to the card's index. Without
 * `onMove` there is nothing to bind, and the handle is not drawn — a grip that
 * does not grip is the dead control this panel keeps refusing to ship.
 */
function useReorder(beats: ResolvedBeat[], onMove?: (beatId: string, toIndex: number) => void) {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const reset = () => {
    setFrom(null);
    setOver(null);
  };
  return {
    enabled: Boolean(onMove),
    handle: (i: number) => ({
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        setFrom(i);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', beats[i]?.beatId ?? '');
        // The whole card follows the pointer, not the 15px grip.
        const card = e.currentTarget.closest('li');
        if (card) e.dataTransfer.setDragImage(card, 24, 24);
      },
      onDragEnd: reset,
    }),
    item: (i: number) => ({
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (from === null) return;
        e.preventDefault();
        if (over !== i) setOver(i);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        const moving = from === null ? undefined : beats[from];
        if (onMove && moving && from !== i) onMove(moving.beatId, i);
        reset();
      },
    }),
    /** Where a drop would land, for the outline that says so. */
    target: (i: number) => from !== null && over === i && from !== i,
  };
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
  onRemoveScene,
  onMoveScene,
}: StoryboardProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const reorder = useReorder(beats, onMoveScene);

  if (beats.length === 0) return <EmptyStoryboard what="The storyboard appears here once this post is generated." />;

  let elapsed = 0;
  return (
    <div className="mt-[16px] rounded-[20px] bg-white p-[19px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.2)]">
      <ul className="flex flex-col gap-[20px]">
        {beats.map((beat, i) => {
          const from = elapsed;
          const dur = beat.durationSec ?? 0;
          elapsed += dur;
          return (
            <li
              key={beat.beatId}
              id={sceneAnchor(beat.beatId)}
              {...(reorder.enabled ? reorder.item(i) : {})}
              className={cn('rounded-[15px]', reorder.target(i) ? 'outline outline-2 outline-ring' : '')}
            >
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
                onRemove={onRemoveScene ? () => onRemoveScene(beat.beatId) : undefined}
                handle={reorder.enabled ? reorder.handle(i) : undefined}
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
  onRemove,
  handle,
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
  onRemove?: () => void;
  handle?: DragHandleProps;
}) {
  const kind = kindBadge(beat);
  const script = scriptOf(beat);
  const overridden = beat.voice !== undefined;

  return (
    <div
      className="relative overflow-hidden rounded-[15px] py-[17px] pl-[55px] pr-[15px]"
      style={{ background: 'rgba(131,131,131,0.05)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
    >
      {/* The 7px bar down the left edge, warm when the scene departs from the
          post's default audio — the design's own signal for that. */}
      <span
        aria-hidden
        className="absolute left-0 top-[6px] bottom-[6px] w-[7px] rounded-[15px]"
        style={{ background: overridden ? 'var(--ss-scene-bar-warm)' : 'var(--ss-cyan)' }}
      />
      <ColumnRule />
      {/* The gutter's grip at 12,13 and the close box at 23 from the right,
          15 down — `DP video`'s two corner controls. */}
      {handle ? <Grip handle={handle} label={`Drag to move scene ${index + 1}`} className="top-[13px]" /> : null}
      {onRemove ? (
        <CloseBox onClick={onRemove} disabled={busy} label={`Remove scene ${index + 1}`} className="right-[23px] top-[15px]" />
      ) : null}

      <div className={cn('flex flex-wrap items-center gap-x-[14px] gap-y-[6px]', onRemove ? 'pr-[46px]' : '')}>
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
        /*
          `DP video`'s silent scene: inside the white card, a 46-tall dashed
          box — a muted mic, the line, and "Add voiceover" at the right. The
          link opens this scene's controls, which is where its voiceover is
          generated; it is offered only while they are closed, since open they
          are already on screen beneath it.
        */
        <div className="mt-[19px] rounded-[14.058px] bg-white px-[19px] pb-[13px] pt-[16px]">
          <div
            className="flex min-h-[46px] flex-wrap items-center justify-between gap-3 rounded-[10.158px] bg-white pl-[10px] pr-[14px]"
            style={{ outline: '1.016px dashed rgba(131,131,131,0.2)' }}
          >
            <p className="flex items-center gap-[8px] text-16 font-medium text-ink">
              <MicOffIcon className="shrink-0 text-ink-muted" />
              This scene runs without a voiceover.
            </p>
            {onToggle && !open ? (
              <button
                type="button"
                onClick={onToggle}
                className="flex items-center gap-[3px] text-16 font-medium text-brand-purple hover:underline"
              >
                <SmallPlusIcon className="shrink-0" />
                Add voiceover
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-[19px] rounded-[14.058px] bg-white px-[19px] py-[9px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-[4.826px] text-15 font-medium text-ink-muted">
              <ScriptMicIcon className="shrink-0" />
              Voiceover script
            </span>
            {/* The scene's own voice when it has one, otherwise the post's. */}
            {overridden || voiceName ? (
              <span className="flex items-center gap-[5.127px] text-12 font-medium text-ink-muted">
                <PersonSmallIcon className="shrink-0" />
                {overridden ? (beat.voice === 'brand' ? 'Brand voice' : 'Stock voice') : voiceName}
              </span>
            ) : null}
          </div>

          <div className="mt-[14px] rounded-[10.158px] bg-white px-[17px] py-[12px] shadow-[0_4px_15px_0_rgba(163,65,255,0.2)]">
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
                  className="flex items-center gap-[5.206px] text-15 font-medium text-ink-muted hover:text-ink hover:underline disabled:opacity-50"
                >
                  <RewriteIcon className="shrink-0" />
                  Rewrite
                </button>
              ) : null}
              {onAudioOverride ? (
                <button
                  type="button"
                  onClick={() => onAudioOverride(beat.beatId)}
                  disabled={busy}
                  className={cn('flex items-center gap-[6.096px] text-15 font-medium text-ink-muted hover:underline disabled:opacity-50')}
                  style={overridden ? { color: HUE.override } : undefined}
                >
                  <AudioOverrideIcon className="shrink-0" />
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
  /** See `StoryboardProps.onRemoveScene` — the same close box, on a slide. */
  onRemoveScene?: (beatId: string) => void;
  /** See `StoryboardProps.onMoveScene`. */
  onMoveScene?: (beatId: string, toIndex: number) => void;
}

export function CarouselStoryboard({
  beats,
  onAddScene,
  busy,
  renderDetail,
  addSlot,
  onRemoveScene,
  onMoveScene,
}: CarouselStoryboardProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const reorder = useReorder(beats, onMoveScene);

  if (beats.length === 0) return <EmptyStoryboard what="The slides appear here once this post is generated." />;

  return (
    <div className="mt-[14px]">
      <ul className="flex flex-col gap-[17px]">
        {beats.map((beat, i) => (
          <li
            key={beat.beatId}
            {...(reorder.enabled ? reorder.item(i) : {})}
            className={cn('rounded-[15px]', reorder.target(i) ? 'outline outline-2 outline-ring' : '')}
          >
            <SlideCard
              beat={beat}
              index={i}
              detail={renderDetail}
              open={openId === beat.beatId}
              onToggle={renderDetail ? () => setOpenId((id) => (id === beat.beatId ? null : beat.beatId)) : undefined}
              onRemove={onRemoveScene ? () => onRemoveScene(beat.beatId) : undefined}
              handle={reorder.enabled ? reorder.handle(i) : undefined}
              busy={busy}
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
  onRemove,
  handle,
  busy,
}: {
  beat: ResolvedBeat;
  index: number;
  detail?: (beat: ResolvedBeat, index: number) => ReactNode;
  open?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  handle?: DragHandleProps;
  busy?: boolean;
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
  /* Each tint carries a 1.29px inset ring of its own hue: solid cyan on the
     hook, the tint's hue at 10% otherwise. */
  const tint =
    hue === 'hook'
      ? { background: 'rgba(108,232,255,0.3)', boxShadow: 'inset 0 0 0 1.29px rgb(108,232,255)' }
      : hue === 'cta'
        ? { background: 'rgba(31,175,19,0.2)', boxShadow: 'inset 0 0 0 1.29px rgba(31,175,19,0.1)' }
        : { background: 'rgba(131,131,131,0.2)', boxShadow: 'inset 0 0 0 1.29px rgba(131,131,131,0.1)' };
  /** The picture glyph in the empty thumbnail — a deeper cyan, the green, or grey. */
  const glyph = hue === 'hook' ? 'rgb(28,178,206)' : hue === 'cta' ? 'rgb(31,175,19)' : 'rgb(131,131,131)';

  return (
    <div
      className="relative rounded-[15px] px-[55px] py-[17px]"
      style={{ background: 'rgba(131,131,131,0.05)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
    >
      <ColumnRule />
      {/* The grip centred in the gutter, the close box 14 in from the top
          right — where `DP carousel` puts both. */}
      {handle ? <Grip handle={handle} label={`Drag to move slide ${index + 1}`} className="top-1/2 -translate-y-1/2" /> : null}
      {onRemove ? (
        <CloseBox onClick={onRemove} disabled={busy} label={`Remove slide ${index + 1}`} className="right-[14px] top-[14px]" />
      ) : null}
      <div className="flex gap-[20px]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-[147px] w-[124px] shrink-0 rounded-[10px] object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-[147px] w-[124px] shrink-0 items-center justify-center rounded-[10px]"
          style={{ ...tint, color: glyph }}
        >
          <SlideImageIcon />
        </span>
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
/**
 * The line under a slide's headline — the design's layout note.
 *
 * `DP carousel.dc.html` prints a *visual* description there: "Bold headline on
 * solid brand background. Small arrow indicating swipe." Nothing in the data
 * carries that sentence — a playbook `Beat` has an id, a duration, a prompt
 * reference and a source, and no field describing what the slide should look
 * like. So this used to print the rest of the copy instead, which is a
 * different fact wearing the same slot.
 *
 * There *is* an honest source, for any slide whose picture has actually been
 * made: the prompt it was generated from. That is a description of the visual,
 * written before the visual existed, which is exactly what the design's line
 * is. A slide with no picture yet falls back to the remaining copy, and a
 * one-sentence slide with no picture still gets nothing rather than repeating
 * its own headline.
 *
 * Inventing the sentence was the alternative, and it is the one thing this
 * must not do: a layout note nobody wrote, under a slide nobody laid out, is a
 * claim about the post that is not true of it.
 */
function note(beat: ResolvedBeat): string {
  if ((beat.kind === 'generated_image' || beat.kind === 'generated_broll') && beat.prompt.trim()) {
    return beat.prompt.trim();
  }
  const whole = describe(beat).trim();
  const rest = whole.slice(title(beat).length).replace(/^[.\s]+/, '').trim();
  return rest;
}

type DragHandleProps = ReturnType<ReturnType<typeof useReorder>['handle']>;

/**
 * The six-dot grip in a card's gutter — 15x24 at x12, grey.
 *
 * Hidden from assistive tech on purpose: dragging is a pointer affordance, and
 * the keyboard route to the same reorder is Move up / Move down in the card's
 * opened controls.
 */
function Grip({ handle, label, className }: { handle: DragHandleProps; label: string; className?: string }) {
  return (
    <span
      {...handle}
      aria-hidden
      title={label}
      className={cn('absolute left-[12px] z-[1] cursor-grab text-ink-muted active:cursor-grabbing', className)}
    >
      <DragHandleIcon />
    </span>
  );
}

/** The 26px close box — r6.19, a 1.39px grey ring, the grey cross centred. */
function CloseBox({
  onClick,
  disabled,
  label,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'absolute z-[1] flex h-[26px] w-[26px] items-center justify-center rounded-[6.19px] text-ink-muted hover:text-ink disabled:opacity-50',
        className,
      )}
      style={{ boxShadow: '0 0 0 1.393px rgb(131,131,131)' }}
    >
      <SceneCloseIcon />
    </button>
  );
}

/**
 * The 1px rule at x35 down a scene or slide card — the edge of the column the
 * design keeps for its drag handle. Grey at 25%, absolutely placed so it adds
 * nothing to the card's layout.
 */
function ColumnRule() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-[35px] top-0 w-px"
      style={{ background: 'rgba(131,131,131,0.25)' }}
    />
  );
}

/**
 * A badge's fill, as a share of its hue. Every badge in the prototypes is its
 * hue at 10% inside a 1px ring of the hue at 40% — except Hook, which fills at
 * 20%, and "No voiceover", which is the ring alone.
 */
const FILL: Partial<Record<Hue, number>> = { hook: 20, silent: 0 };

function Badge({ text, hue }: { text: string; hue: Hue }) {
  const colour = HUE[hue];
  const fill = FILL[hue] ?? 10;
  return (
    <span
      className="flex h-[26px] items-center rounded-[12.381px] px-[12px] text-12 font-medium"
      /*
        Inline, because `bg-[rgba(...)]` and `color-mix` in an arbitrary class
        both failed silently here once already — see the note on the rail tiles
        in `DraftDrawer`. `color-mix` in a style attribute is evaluated by the
        browser, not by a class-name escaper.
      */
      style={{
        color: colour,
        background: fill ? `color-mix(in srgb, ${colour} ${fill}%, transparent)` : 'transparent',
        boxShadow: `0 0 0 1px color-mix(in srgb, ${colour} 40%, transparent)`,
      }}
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
      className="mt-[16px] flex h-[65px] w-full items-center justify-center gap-[9px] rounded-[10px] text-18 font-medium text-ink disabled:opacity-50"
      style={{ background: 'rgba(131,131,131,0.1)', boxShadow: '0 0 0 1px rgba(131,131,131,0.3)' }}
    >
      <AddPlusIcon className="shrink-0" />
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
