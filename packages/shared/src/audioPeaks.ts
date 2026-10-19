/**
 * Reduce raw audio samples to a handful of bar heights.
 *
 * Extracted from `VoiceWaveform` for the reason every other judgement in this
 * repo is extracted: the component needs an `AudioContext` and a canvas and so
 * cannot be unit-tested, while *which* number each bar gets is a decision with
 * at least three ways to be wrong — and all three produce a waveform that
 * looks plausible and misreports the take.
 *
 * `apps/web` may import `@sparksocial/shared` and nothing else from
 * `packages/`, which is what makes this the right home rather than a file
 * beside the component; `timezones.ts` moved here for the same reason.
 */

/**
 * Average absolute amplitude per bucket, normalised against the loudest.
 *
 * ── Average, not peak ────────────────────────────────────────────────────
 *
 * Peak-per-bucket is the obvious choice and it is wrong for a whole clip:
 * almost every bucket of real speech contains one loud sample, so the result
 * is a row of near-full bars that is identical for every recording ever made.
 * Averaging gives back the cadence a person recognises as their own.
 *
 * The live meter in `VoiceWaveform` does the opposite — peak over a ~23ms
 * window — because there the question is "is the microphone hearing anything
 * *right now*", and an average over a waveform that swings either side of
 * silence tends to zero. Same data, two questions.
 *
 * ── Normalised per clip ──────────────────────────────────────────────────
 *
 * Against the clip's own loudest bucket, so a quietly recorded take is legible
 * instead of a flat line. The cost is that loudness is not comparable between
 * clips, which nothing here asks of it: this answers "did I speak, and where",
 * not "how loud was I".
 */
export function reduceToPeaks(samples: ArrayLike<number>, buckets: number): number[] {
  if (buckets <= 0) return [];

  /*
   * `Math.floor` of a clip shorter than the bar count gives 0, and a bucket
   * size of zero divides by zero and fills the array with NaN — which paints
   * nothing and reports no error. A one-sample bucket is the honest floor.
   */
  const size = Math.max(1, Math.floor(samples.length / buckets));

  const out: number[] = [];
  let loudest = 0;

  for (let i = 0; i < buckets; i++) {
    let sum = 0;
    let counted = 0;
    const start = i * size;

    for (let j = 0; j < size; j++) {
      const sample = samples[start + j];
      // Past the end of a short clip. Counted as absent rather than as
      // silence, so the bars that do have samples are not dragged down by the
      // ones that never existed.
      if (sample === undefined) break;
      sum += Math.abs(sample);
      counted++;
    }

    const value = counted > 0 ? sum / counted : 0;
    if (value > loudest) loudest = value;
    out.push(value);
  }

  return loudest > 0 ? out.map((v) => Math.min(1, v / loudest)) : out;
}

/**
 * Seconds as `m:ss`, for a transport clock.
 *
 * Written properly rather than copied from the design, which does
 * `"0:" + String(Math.floor(playT)).padStart(2, "0")` — correct for the mock's
 * own 46-second clip and wrong as a format: at 65 seconds it renders `0:65`.
 * The voice preview is capped at 280 characters and so will not reach a
 * minute, which makes the design's shortcut *currently* true and a trap for
 * whoever reuses this clock on something longer.
 *
 * Non-finite input is `0:00`, because `audio.duration` is `NaN` until metadata
 * loads and `NaN:NaN` is not a time.
 */
export function clockMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
