import type { Genome } from '@sparksocial/shared/genome';
import { assessSafety, type SafetyVerdict } from './safety.js';
import type { Trend } from './trend.js';

/**
 * TREND RANKING — PRD §8.9, plan §3.2 `trend.rank`
 * ("volume/velocity/saturation/relevance").
 *
 *   *"Low velocity on trends: by the time trends are noticed and repurposed,
 *   they're saturated."* — PRD §3
 *
 * ── The three decisions that make this a product rather than a sort ────────
 *
 * **1. Relevance is a multiplier, so it scales the whole score.** Not because
 * multiplying always favours relevance — it does not, and an earlier version of
 * this comment claimed otherwise. Compare `r=0.9, w=0.20` against
 * `r=0.3, w=0.75`: multiplying picks the second (0.225 vs 0.180), averaging
 * picks the first (0.550 vs 0.525). What multiplying actually buys is
 * *proportionality and a veto*: halving relevance halves the score, and zero
 * relevance is zero however hot the topic. An average can never veto — a
 * completely off-brand trend still inherits half of a high opportunity score.
 *
 * **2. Irrelevance is excluded outright, by `RELEVANCE_FLOOR`.** That, not the
 * multiplication, is what keeps off-brand trends out of the feed. The two work
 * together: the floor removes what the brand cannot speak to at all, the
 * multiplier ranks what is left in proportion to how well it fits.
 *
 * **3. Saturation is subtracted from opportunity, not from the total.** A trend
 * at 0.9 saturation is not "a good trend with a penalty"; it is a trend whose
 * window has closed. Modelling opportunity as `velocity × (1 − saturation)`
 * makes that structural rather than a matter of tuning weights — a fast trend
 * that everyone has already done scores near zero, which is correct and is not
 * something a weighted sum of velocity and saturation would produce.
 *
 * Volume is deliberately weak. It is the most visible number and the least
 * useful one: it describes how big a thing already is, which is the same as
 * saying how late you are.
 */

export interface RankedTrend {
  trend: Trend;
  score: number;
  /** 0–1. How much this brand can credibly say about it. */
  relevance: number;
  /** 0–1. Velocity discounted by how done the trend already is. */
  opportunity: number;
  safety: SafetyVerdict;
  factors: Array<{ label: string; detail: string; weight?: number }>;
}

/**
 * Below this, a trend is excluded rather than shown weakly.
 *
 * Must sit **above** `RELEVANCE_BASELINE`, or it is dead code: a trend matching
 * nothing about the brand still scores the baseline, so a floor underneath that
 * can never fire and every irrelevant trend reaches the feed. The first version
 * had 0.15 against a 0.2 baseline and filtered nothing.
 *
 * The product's claim is that it *removes* what a brand cannot credibly join,
 * so a trend with no matching signal at all has to fall out.
 */
const RELEVANCE_FLOOR = 0.25;

/** What any trend scores before a single signal matches — "slightly joinable". */
const RELEVANCE_BASELINE = 0.2;

/** Volume's contribution, capped hard — see the note above. */
const VOLUME_WEIGHT = 0.15;

/**
 * Ranks trends for one genome, safest-and-most-actionable first.
 *
 * Unsafe trends are removed, not ranked low. See `safety.ts` for why that
 * asymmetry is deliberate.
 */
export function rankTrends(genome: Genome, trends: Trend[]): { ranked: RankedTrend[]; excluded: RankedTrend[] } {
  const scored = trends.map((trend) => scoreTrend(genome, trend));

  const excluded = scored.filter((r) => !r.safety.safe || r.relevance < RELEVANCE_FLOOR);
  const ranked = scored
    .filter((r) => r.safety.safe && r.relevance >= RELEVANCE_FLOOR)
    .sort((a, b) => b.score - a.score);

  return { ranked, excluded };
}

/** Per-trend scoring, exported for `trend.detail`/`trend.explain` — a single-trend breakdown without re-ranking a whole fetched batch. */
export function scoreTrend(genome: Genome, trend: Trend): RankedTrend {
  const safety = assessSafety(genome, trend);
  const relevance = relevanceFor(genome, trend);

  // Opportunity: how much of this trend is left. A dying trend (negative
  // growth) is discounted further — velocity says it moved, growth says which
  // direction, and a fast-shrinking trend is not an opportunity.
  const decay = trend.metrics.growth < 0 ? 0.4 : 1;
  const opportunity = clamp01(trend.metrics.velocity * (1 - trend.metrics.saturation) * decay);

  // Volume is log-scaled: the difference between 10k and 100k matters, the
  // difference between 5M and 9M does not.
  const volumeSignal = Math.min(1, Math.log10(Math.max(10, trend.metrics.volume)) / 7);

  const raw = opportunity * (1 - VOLUME_WEIGHT) + volumeSignal * VOLUME_WEIGHT;
  const finalScore = relevance * raw;

  return {
    trend,
    score: round(finalScore),
    relevance: round(relevance),
    opportunity: round(opportunity),
    safety,
    factors: [
      { label: 'opportunity', detail: describeOpportunity(trend), weight: round(opportunity) },
      { label: 'relevance', detail: describeRelevance(relevance), weight: round(relevance) },
      { label: 'reach', detail: `${formatVolume(trend.metrics.volume)} posts`, weight: round(volumeSignal) },
      ...(trend.metrics.growth < 0 ? [{ label: 'declining', detail: 'already past its peak' }] : []),
    ],
  };
}

/**
 * How much this brand can credibly say about a trend.
 *
 * Derived from genome *dimensions* and the brand's own tags — never from
 * category (invariant 5). A barbershop and a joinery both score high on a
 * craft-capture trend because both have `physical_craft` as a proof asset, not
 * because anything in here knows what either of them is.
 */
export function relevanceFor(genome: Genome, trend: Trend): number {
  const tags = new Set(trend.tags.map((t) => t.toLowerCase()));
  const topic = trend.topic.toLowerCase();
  const has = (t: string) => tags.has(t) || topic.includes(t);

  let signal = RELEVANCE_BASELINE;

  // Proof asset — what this brand can actually show.
  const proof = genome.dimensions.proof_asset;
  if (proof.includes('physical_craft') && (has('craft') || has('before_after') || has('transformation'))) signal += 0.35;
  if (proof.includes('product_ui') && (has('workflow') || has('software') || has('demo'))) signal += 0.35;
  if (proof.includes('person') && (has('personality') || has('talking_head') || has('opinion'))) signal += 0.3;
  if (proof.includes('finished_work') && (has('portfolio') || has('before_after') || has('result'))) signal += 0.3;
  if (proof.includes('physical_product') && (has('product') || has('unboxing') || has('haul'))) signal += 0.3;
  if (proof.includes('data_outcomes') && (has('data') || has('result') || has('insight'))) signal += 0.3;

  // Geography — a local business gains disproportionately from local trends,
  // which is exactly the surface a global brand should not chase.
  if (genome.identity.geography.scope === 'local' && (has('local') || has('seasonal') || has('community'))) {
    signal += 0.25;
  }

  // Capture capability — a trend the brand has no way to film is less relevant
  // however well it matches on subject.
  if (has('space') && !genome.dimensions.capture_capability.includes('space')) signal -= 0.15;
  if (has('screen') && !genome.dimensions.capture_capability.includes('screen')) signal -= 0.15;

  return clamp01(signal);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

function describeOpportunity(trend: Trend): string {
  const { velocity, saturation } = trend.metrics;
  if (saturation > 0.75) return 'already saturated — the window has closed';
  if (velocity > 0.6 && saturation < 0.35) return 'climbing fast and not yet crowded';
  if (velocity < 0.25) return 'moving slowly';
  return 'growing, partly crowded';
}

function describeRelevance(relevance: number): string {
  if (relevance >= 0.6) return 'this brand has something real to say here';
  if (relevance >= 0.35) return 'joinable, but not an obvious fit';
  return 'little natural connection to what this brand does';
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${Math.round(volume / 1_000)}k`;
  return String(volume);
}
