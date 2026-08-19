'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DUBBABLE_BEAT_KINDS, type DraftView, type ResolvedBeat } from './types';

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
  onGenerateImage,
  onGenerateAvatarVideo,
  onGenerateVoiceover,
  onGenerateBroll,
  onDub,
  onSaveText,
}: {
  beat: ResolvedBeat;
  mediaType: DraftView['mediaType'];
  busy: boolean;
  error?: string;
  onGenerateImage: (beatId: string, prompt: string) => void;
  onGenerateAvatarVideo: (beatId: string, script: string) => void;
  onGenerateVoiceover: (beatId: string, script: string) => void;
  onGenerateBroll: (beatId: string, prompt: string) => void;
  onDub: (beatId: string, sourceUrl: string, mediaType: 'video' | 'audio', targetLanguage: string) => void;
  onSaveText: (beatId: string, text: string) => void;
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
  const dirty = beat.kind === 'text' && text !== beat.text;
  const dubbable = (DUBBABLE_BEAT_KINDS as readonly string[]).includes(beat.kind);

  return (
    <li className="rounded-lg border border-border p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{beat.beatId}</p>

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

      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </li>
  );
}
