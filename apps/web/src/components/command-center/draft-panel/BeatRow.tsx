'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clock, DUBBABLE_BEAT_KINDS, type DraftView, type KitTemplate, type ResolvedBeat } from './types';

/**
 * One beat, editor phase. What action(s) it offers depends on the draft's
 * `mediaType`, not on inspecting the playbook — the panel doesn't have (and
 * doesn't need) the playbook's full precondition data, just its declared
 * output format. A `text`-mode draft has nothing to *generate* — but a
 * `text`-kind beat's own words are the entire post there, which is exactly
 * why it gets its own Save action regardless of mediaType: for an
 * `image`/`video`/`carousel` draft, a text beat's textarea also feeds the
 * generate buttons below it (the prompt/script), but the text itself — a
 * hook, a CTA — has no media to regenerate and was previously lost the
 * moment you typed over it without clicking one of those buttons.
 */
export function BeatRow({
  beat,
  mediaType,
  busy,
  error,
  index,
  startSec,
  timed,
  isFirst,
  isLast,
  onGenerateImage,
  onGenerateAvatarVideo,
  onGenerateVoiceover,
  onGenerateBroll,
  onDub,
  onSaveText,
  onRetime,
  onRemove,
  onMove,
  onSetVoice,
  templates,
  onApplyTemplate,
}: {
  beat: ResolvedBeat;
  mediaType: DraftView['mediaType'];
  busy: boolean;
  error?: string;
  /** Zero-based position, for the "Scene N" caption the storyboard shows. */
  index: number;
  /** Where this scene starts in the finished cut, for the 0:00-0:04 range. */
  startSec: number;
  /**
   * Whether this format has a duration at all. False for text and carousels,
   * where a retime control would write a number no renderer reads.
   */
  timed: boolean;
  isFirst: boolean;
  isLast: boolean;
  onGenerateImage: (beatId: string, prompt: string) => void;
  onGenerateAvatarVideo: (beatId: string, script: string) => void;
  onGenerateVoiceover: (beatId: string, script: string) => void;
  onGenerateBroll: (beatId: string, prompt: string) => void;
  onDub: (beatId: string, sourceUrl: string, mediaType: 'video' | 'audio', targetLanguage: string) => void;
  onSaveText: (beatId: string, text: string) => void;
  onRetime: (beatId: string, durationSec: number) => void;
  onRemove: (beatId: string) => void;
  onMove: (beatId: string, toIndex: number) => void;
  onSetVoice: (beatId: string, voice: 'brand' | 'stock' | 'default') => void;
  /** The brand kit's caption and lower-third presets. Empty hides the control. */
  templates: KitTemplate[];
  onApplyTemplate: (template: KitTemplate, beatId: string) => void;
}) {
  const initialText =
    beat.kind === 'text'
      ? beat.text
      : beat.kind === 'generated_image' || beat.kind === 'generated_broll'
        ? beat.prompt
        : 'script' in beat
          ? beat.script
          : '';
  const [text, setText] = useState(initialText);
  const [dubLanguage, setDubLanguage] = useState('');
  /**
   * Seconds held as a *string*, not a number. A number-typed state cannot
   * represent the intermediate states of typing - a cleared field, or a lone
   * decimal point - without becoming NaN, which renders as an empty box that
   * then submits garbage. Parsed once, at submit.
   */
  const [duration, setDuration] = useState(beat.durationSec !== undefined ? String(beat.durationSec) : '');
  const dirty = beat.kind === 'text' && text !== beat.text;
  const dubbable = (DUBBABLE_BEAT_KINDS as readonly string[]).includes(beat.kind);

  const parsedDuration = Number(duration);
  const durationValid = duration.trim() !== '' && Number.isFinite(parsedDuration) && parsedDuration >= 0.5;
  const durationDirty = durationValid && parsedDuration !== beat.durationSec;

  return (
    <li className="rounded-lg border border-border p-4">
      {/*
        The storyboard header - M5. The badge is the label the design draws
        ("Hook", "Talking head", "B-roll + text overlay"), falling back to the
        beat id, which is exactly what this row showed before a beat carried a
        label - so a legacy draft degrades to the old display, not to a blank.
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink">
            {beat.label ?? beat.beatId}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-ink-muted">Scene {index + 1}</span>
        </div>
        {timed && beat.durationSec !== undefined ? (
          <span className="text-[11px] tabular-nums text-ink-muted">
            {clock(startSec)}&ndash;{clock(startSec + beat.durationSec)}
          </span>
        ) : null}
      </div>

      {beat.kind === 'asset' ? (
        <p className="mt-2 text-[14px] text-ink-muted">
          Your own {beat.role.replace(/_/g, ' ')} asset{beat.caption ? ` — ${beat.caption}` : ''}.
        </p>
      ) : beat.kind === 'generated_image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={beat.url} alt={beat.prompt} className="mt-2 max-h-64 rounded object-contain" />
      ) : beat.kind === 'generated_video' || beat.kind === 'generated_broll' ? (
        <video src={beat.url} controls className="mt-2 max-h-64 rounded" />
      ) : beat.kind === 'generated_audio' ? (
        <audio src={beat.url} controls className="mt-2 w-full" />
      ) : beat.kind === 'dubbed_media' ? (
        beat.mediaType === 'video' ? (
          <video src={beat.url} controls className="mt-2 max-h-64 rounded" />
        ) : (
          <audio src={beat.url} controls className="mt-2 w-full" />
        )
      ) : null}
      {beat.kind === 'dubbed_media' ? (
        <p className="mt-1 text-[12px] text-ink-muted">Dubbed into {beat.targetLanguage}.</p>
      ) : null}

      {beat.kind === 'text' ||
      beat.kind === 'generated_image' ||
      beat.kind === 'generated_video' ||
      beat.kind === 'generated_audio' ||
      beat.kind === 'generated_broll' ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={2}
          className="mt-2 w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-ink placeholder:text-ink-placeholder focus:outline-none focus:ring-[1.5px] focus:ring-ring"
        />
      ) : null}

      {beat.kind !== 'asset' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {beat.kind === 'text' ? (
            <Button
              size="sm"
              disabled={busy || !dirty}
              onClick={() => onSaveText(beat.beatId, text)}
              title={dirty ? undefined : 'No changes to save'}
            >
              {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
          ) : null}
          {mediaType !== 'text' && (mediaType === 'image' || mediaType === 'carousel') && beat.kind !== 'generated_image' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onGenerateImage(beat.beatId, text)}>
              {busy ? 'Generating…' : 'Generate image'}
            </Button>
          ) : null}
          {mediaType === 'video' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onGenerateAvatarVideo(beat.beatId, text)}
              >
                {busy ? 'Generating…' : 'Generate avatar video'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onGenerateVoiceover(beat.beatId, text)}
              >
                {busy ? 'Generating…' : 'Generate voiceover'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onGenerateBroll(beat.beatId, text)}
              >
                {busy ? 'Generating…' : 'Generate b-roll'}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {dubbable && 'url' in beat ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={dubLanguage}
            onChange={(e) => setDubLanguage(e.target.value)}
            disabled={busy}
            placeholder="Language code, e.g. es"
            className="h-8 w-40 rounded border border-border bg-input px-2 text-[13px] text-ink placeholder:text-ink-placeholder disabled:opacity-50"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !dubLanguage.trim()}
            onClick={() =>
              onDub(
                beat.beatId,
                beat.url,
                beat.kind === 'generated_audio' || (beat.kind === 'dubbed_media' && beat.mediaType === 'audio') ? 'audio' : 'video',
                dubLanguage.trim(),
              )
            }
          >
            {busy ? 'Dubbing…' : 'Dub'}
          </Button>
        </div>
      ) : null}

      {/*
        Scene operations - the write side of the storyboard. Reorder and remove
        apply to any format; retime and the voice override only mean something on
        a timed one, so they are gated rather than offered as controls that write
        a value nothing reads.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {timed ? (
          <>
            <label className="text-[11px] text-ink-muted" htmlFor={`dur-${beat.beatId}`}>
              Seconds
            </label>
            <input
              id={`dur-${beat.beatId}`}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              disabled={busy}
              inputMode="decimal"
              className="h-8 w-16 rounded border border-border bg-input px-2 text-[13px] tabular-nums text-ink disabled:opacity-50"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !durationDirty}
              onClick={() => onRetime(beat.beatId, parsedDuration)}
              title={durationDirty ? undefined : 'No change to apply'}
            >
              Retime
            </Button>
          </>
        ) : null}

        <Button size="sm" variant="outline" disabled={busy || isFirst} onClick={() => onMove(beat.beatId, index - 1)}>
          Move up
        </Button>
        <Button size="sm" variant="outline" disabled={busy || isLast} onClick={() => onMove(beat.beatId, index + 1)}>
          Move down
        </Button>

        {timed ? (
          <select
            value={beat.voice ?? 'default'}
            disabled={busy}
            onChange={(e) => onSetVoice(beat.beatId, e.target.value as 'brand' | 'stock' | 'default')}
            className="h-8 rounded border border-border bg-input px-2 text-[13px] text-ink disabled:opacity-50"
            aria-label="Voice for this scene"
          >
            <option value="default">Default voice</option>
            <option value="stock">Stock voice</option>
            <option value="brand">Your own voice</option>
          </select>
        ) : null}

        {/*
          `Use This Brand Preset`, for the two categories that act on a scene
          that already exists. Intros, outros and bumpers create a scene, so they
          live in the storyboard header instead — offering them per row would
          imply the new scene lands next to this one, which is not what the tool
          does.

          A select rather than a row of chips: a brand may keep eight of each,
          and sixteen buttons on every scene would bury the controls that change
          the cut.
        */}
        {templates.length > 0 ? (
          <select
            value=""
            disabled={busy}
            onChange={(e) => {
              const chosen = templates.find((t) => t.id === e.target.value);
              if (chosen) onApplyTemplate(chosen, beat.beatId);
              // Reset to the placeholder so the same preset can be applied twice.
              e.target.value = '';
            }}
            className="h-8 max-w-[13rem] rounded border border-border bg-input px-2 text-[13px] text-ink disabled:opacity-50"
            aria-label="Apply a brand preset to this scene"
          >
            <option value="">Use a brand preset…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.category === 'caption' ? 'Caption' : 'Lower-third'}: {t.name}
              </option>
            ))}
          </select>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onRemove(beat.beatId)}
          className="ml-auto text-destructive"
        >
          Remove scene
        </Button>
      </div>

      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </li>
  );
}
