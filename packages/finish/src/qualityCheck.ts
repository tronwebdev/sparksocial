/**
 * MEDIA QUALITY CHECK — engine spec §6.3:
 *
 *   *"quality-score (blur, exposure, shake, duration). Reject-and-reshoot with
 *   a specific reason if below threshold."*
 *
 * Same split as everywhere else in this repo: the *decision* is a pure
 * function tested here; *measuring* blur/exposure/shake from actual video
 * (Laplacian variance, histogram analysis, optical flow) is real signal
 * processing this module does not fake with a plausible-looking number —
 * `QualityMetrics` arrives already computed, from an injected analyzer (see
 * `ingest.ts`), the same seam `validateBrief` uses for the brief itself.
 */

export interface QualityMetrics {
  /** 0 = tack sharp, 1 = unusable. */
  blurScore: number;
  /** 0 = correctly exposed, 1 = blown out or crushed black. */
  exposureScore: number;
  /** 0 = tripod-steady, 1 = unwatchable shake. */
  shakeScore: number;
  durationSec: number;
}

export interface QualityThresholds {
  maxBlur: number;
  maxExposure: number;
  maxShake: number;
  minDurationSec: number;
  maxDurationSec: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  maxBlur: 0.5,
  maxExposure: 0.5,
  maxShake: 0.5,
  minDurationSec: 3,
  maxDurationSec: 90,
};

export interface QualityVerdict {
  verdict: 'accept' | 'reshoot';
  /** Every threshold missed, not just the first — one reshoot request should cover everything wrong. */
  reasons: string[];
}

export function checkMediaQuality(
  metrics: QualityMetrics,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): QualityVerdict {
  const reasons: string[] = [];

  if (metrics.blurScore > thresholds.maxBlur) {
    reasons.push(`too blurry (${metrics.blurScore.toFixed(2)} > ${thresholds.maxBlur}) — hold the phone steady and let it focus before filming`);
  }
  if (metrics.exposureScore > thresholds.maxExposure) {
    reasons.push(`poorly exposed (${metrics.exposureScore.toFixed(2)} > ${thresholds.maxExposure}) — face a window, avoid a single overhead light`);
  }
  if (metrics.shakeScore > thresholds.maxShake) {
    reasons.push(`too shaky (${metrics.shakeScore.toFixed(2)} > ${thresholds.maxShake}) — brace against something or set the phone down`);
  }
  if (metrics.durationSec < thresholds.minDurationSec) {
    reasons.push(`too short (${metrics.durationSec}s < ${thresholds.minDurationSec}s) — there isn't enough footage to cut a clip from`);
  }
  if (metrics.durationSec > thresholds.maxDurationSec) {
    reasons.push(`too long (${metrics.durationSec}s > ${thresholds.maxDurationSec}s) — trim before sending, or send the best few seconds`);
  }

  return reasons.length === 0 ? { verdict: 'accept', reasons: [] } : { verdict: 'reshoot', reasons };
}
