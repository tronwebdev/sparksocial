'use client';

import { useEffect, useRef, useState } from 'react';
import { reduceToPeaks } from '@sparksocial/shared';

/**
 * THE WAVEFORM — what a voice sample looks like, live and after the fact.
 *
 * ── Why a silent control was the problem ─────────────────────────────────
 *
 * The recorder gave no feedback at all beyond the button turning red. No
 * level, no elapsed time, and no way to hear what had been captured before it
 * was sent off to be cloned — so the first evidence that a recording had
 * picked up anything at all was whether ElevenLabs accepted it, minutes later
 * and one screen away. A muted microphone and a good take looked identical.
 *
 * Two modes, because there are two moments worth seeing:
 *
 *   **live**   — drawn from the `MediaStream` while recording, so a dead mic
 *                is visible as a flat line *at the time it matters*.
 *   **clip**   — drawn from the captured or uploaded bytes, so the take can be
 *                looked at and listened to before anybody clones it.
 *
 * ── No library ───────────────────────────────────────────────────────────
 *
 * `wavesurfer.js` and friends are the obvious reach, and they are a dependency
 * plus a bundle for something the Web Audio API does in about eighty lines:
 * an `AnalyserNode` for the live case, `decodeAudioData` plus a peak reduction
 * for the clip. Neither is approximated — both read the real samples.
 *
 * ── Degrading ────────────────────────────────────────────────────────────
 *
 * Every path here can fail for reasons that are nobody's fault: `AudioContext`
 * may be unavailable, and `decodeAudioData` genuinely refuses some codecs
 * (Safari and WebM/Opus being the live example). None of that is allowed to
 * break recording, which works perfectly well unvisualised — a failure leaves
 * a flat baseline and the controls beside it keep working.
 */

/** Bars across the full width. Enough to read a cadence, few enough to stay crisp. */
const BAR_COUNT = 56;
const BAR_GAP = 2;

type Props = {
  width: number;
  height: number;
  /** Drawn in the brand's accent; the unplayed remainder is drawn muted. */
  color?: string;
  mutedColor?: string;
} & (
  | { mode: 'live'; stream: MediaStream | null }
  | { mode: 'clip'; blob: Blob | null; progress?: number }
);

export function VoiceWaveform(props: Props) {
  const { width, height, color = '#A341FF', mutedColor = 'rgba(12,12,12,0.18)' } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /** Peaks for the clip mode, 0–1, one per bar. Null until decoded. */
  const [peaks, setPeaks] = useState<number[] | null>(null);

  /* ── live: an analyser on the recording stream ───────────────────────── */
  const stream = props.mode === 'live' ? props.stream : null;
  useEffect(() => {
    if (props.mode !== 'live') return;

    /*
     * No stream yet: draw the baseline rather than nothing.
     *
     * `recording` is true from the moment the button is pressed, but the
     * stream only exists once `getUserMedia` resolves — which is after the
     * permission prompt, i.e. for as long as the person takes to answer it.
     * Returning early left a blank white rectangle for exactly that window,
     * which is the moment it most looks broken. A flat line says "listening,
     * nothing yet", which is true.
     */
    if (!stream) {
      draw(canvasRef.current, [], width, height, color, mutedColor, 0);
      return;
    }

    let context: AudioContext | undefined;
    let frame = 0;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      /*
       * 1024 samples is about 23ms at 44.1kHz — short enough that the bars
       * track speech rhythm rather than smearing it into a block, long enough
       * not to flicker.
       */
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      const history: number[] = [];

      const tick = () => {
        analyser.getByteTimeDomainData(samples);

        /*
         * Peak deviation from the 128 midpoint, not an average: an average
         * over a waveform that swings either side of silence tends to 128 and
         * reports loud speech as nothing.
         */
        let peak = 0;
        for (const sample of samples) {
          const deviation = Math.abs(sample - 128) / 128;
          if (deviation > peak) peak = deviation;
        }

        history.push(Math.min(1, peak * 1.6));
        if (history.length > BAR_COUNT) history.shift();

        draw(canvasRef.current, history, width, height, color, mutedColor, 1);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      // No AudioContext. The recorder still works; it is simply not drawn.
      return;
    }

    return () => {
      cancelAnimationFrame(frame);
      // `close()` releases the hardware tap. Without it a second recording in
      // the same session opens another context against the same device.
      void context?.close().catch(() => {});
    };
  }, [props.mode, stream, width, height, color, mutedColor]);

  /* ── clip: decode the bytes once, then draw on every progress change ──── */
  const blob = props.mode === 'clip' ? props.blob : null;
  useEffect(() => {
    if (props.mode !== 'clip' || !blob) {
      setPeaks(null);
      return;
    }

    let live = true;
    void (async () => {
      let context: AudioContext | undefined;
      try {
        context = new AudioContext();
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        if (!live) return;
        setPeaks(reduceToPeaks(audio.getChannelData(0), BAR_COUNT));
      } catch {
        /*
         * `decodeAudioData` refuses codecs the browser can record but not
         * decode — Safari with WebM/Opus is the live case. A flat baseline is
         * the honest drawing of "we cannot show you this", and the clip is
         * still perfectly uploadable, so nothing else changes.
         */
        if (live) setPeaks(new Array(BAR_COUNT).fill(0.04));
      } finally {
        void context?.close().catch(() => {});
      }
    })();

    return () => {
      live = false;
    };
  }, [props.mode, blob]);

  const progress = props.mode === 'clip' ? (props.progress ?? 0) : 1;
  useEffect(() => {
    if (props.mode !== 'clip') return;
    draw(canvasRef.current, peaks ?? [], width, height, color, mutedColor, progress);
  }, [props.mode, peaks, progress, width, height, color, mutedColor]);

  return (
    <canvas
      ref={canvasRef}
      // Drawn at device resolution and laid out at CSS pixels, or the bars are
      // soft on every retina screen.
      width={width * 2}
      height={height * 2}
      aria-hidden
      style={{ width, height, display: 'block' }}
    />
  );
}

function draw(
  canvas: HTMLCanvasElement | null,
  values: number[],
  width: number,
  height: number,
  color: string,
  mutedColor: string,
  progress: number,
) {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  ctx.setTransform(2, 0, 0, 2, 0, 0); // device pixels
  ctx.clearRect(0, 0, width, height);

  const barWidth = (width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
  const middle = height / 2;
  const playedBars = Math.round(progress * BAR_COUNT);

  for (let i = 0; i < BAR_COUNT; i++) {
    /*
     * A minimum height, so silence reads as a baseline rather than as a gap.
     * An empty track and a broken canvas should not look the same.
     */
    const value = values[i] ?? 0;
    const barHeight = Math.max(2, value * (height - 4));

    ctx.fillStyle = i < playedBars ? color : mutedColor;
    ctx.beginPath();
    const x = i * (barWidth + BAR_GAP);
    const radius = Math.min(barWidth / 2, 2);
    ctx.roundRect(x, middle - barHeight / 2, barWidth, barHeight, radius);
    ctx.fill();
  }
}
