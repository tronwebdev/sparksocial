import {
  LEARNED_CONFIDENCE_THRESHOLD,
  type ContentPillar,
  type Genome,
  type GenomeDimensions,
  type PillarWeights,
  type Objective,
} from '@sparksocial/shared';

/**
 * THE MIX ENGINE — engine spec §7.1, master plan §6.4.
 *
 * Choosing *what* to make is solved once playbooks resolve. Choosing the **ratio**
 * is where fit is won or lost:
 *
 *   *"The most common way an AI social tool fails is not bad writing. It's posting
 *   100% promotional content. Getting the mix right is worth more than getting the
 *   copy right."* — outcomes doc, Rule 2
 *
 * Two properties this file is responsible for:
 *
 *  1. **Profiles are derived from dimensions, never from a category label.** The
 *     §7.1 table reads as a list of segment names, but plan §6.4 is explicit that
 *     these are aliases for `(proof_asset, objective)` clusters. `classifyProfile`
 *     is the whole reason a mobile welder and a barbershop get the same treatment
 *     without anyone writing either word down.
 *
 *  2. **The promotional ceiling is not negotiable**, including by the learning
 *     loop. Left alone, a sampler optimising engagement will discover that offers
 *     convert and drive the account to 90% promo. §11 caps it at 35%.
 */

export const PROMOTIONAL_CEILING = 0.35;

export type GenomeProfile =
  | 'b2b_saas'
  | 'agency'
  | 'local_business'
  | 'freelancer'
  | 'ecommerce'
  | 'creator'
  | 'coach';

/**
 * Cold-start pillar weights. Rows 1–6 are engine spec §7.1 verbatim (reproduced in
 * plan §6.4); `coach` comes from outcomes doc §1.6, which the engine spec table
 * omits.
 *
 * These exist only to fill the first 30–60 days. After that the learning loop
 * replaces them with that account's own performance — which is the compounding
 * moat, because a competitor can clone this table in an afternoon but cannot clone
 * 90 days of a specific customer's history.
 */
const COLD_START: Record<GenomeProfile, Required<Pick<PillarWeights, ContentPillar>>> = {
  //                    educational  product  proof  personality  community
  b2b_saas: { educational: 0.5, product: 0.25, proof: 0.15, personality: 0.1, community: 0 },
  agency: { educational: 0.2, product: 0.1, proof: 0.4, personality: 0.3, community: 0 },
  local_business: { educational: 0.1, product: 0.2, proof: 0.1, personality: 0.2, community: 0.4 },
  freelancer: { educational: 0.35, product: 0.1, proof: 0.25, personality: 0.3, community: 0 },
  ecommerce: { educational: 0.2, product: 0.35, proof: 0.3, personality: 0.15, community: 0 },
  creator: { educational: 0.2, product: 0.1, proof: 0, personality: 0.7, community: 0 },
  coach: { educational: 0.45, product: 0.1, proof: 0.2, personality: 0.25, community: 0 },
};

const PILLARS: ContentPillar[] = ['educational', 'product', 'proof', 'personality', 'community'];

/**
 * How each objective tilts the pillar mix.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `deriveMix` took only the genome, so every campaign for a given brand got the
 * identical ratio — a bookings campaign and an audience campaign both came out
 * 50/25/15/10/0 for a SaaS. The campaign objective reached the *ordering* of
 * playbooks and never the shape of the plan, which made "What is this campaign
 * for?" a question with almost no consequence: the same Teach/Offer/Team split
 * whatever you picked.
 *
 * Multipliers rather than replacement ratios, so the profile still decides the
 * character of the account and the objective only leans on it. A local business
 * chasing sales is still a local business; it just posts more product and proof
 * than it would while growing an audience.
 *
 * Applied through `normalise` and `capPromotional`, which is what keeps this
 * safe: no tilt can push an account past the promotional ceiling, and a pillar
 * the profile has at zero stays at zero — `hiring` cannot invent community
 * content for a profile that does not do any.
 */
const OBJECTIVE_TILT: Record<Objective, Partial<Record<ContentPillar, number>>> = {
  // Somebody has to be convinced this specific business is the one to book.
  bookings: { product: 1.4, proof: 1.35, educational: 0.8, personality: 1.1 },
  // A lead gives you their details in exchange for something useful first.
  leads: { educational: 1.25, proof: 1.2, product: 0.9 },
  // A trial is self-serve: the product has to be legible before anyone starts one.
  trials: { product: 1.35, educational: 1.1, proof: 1.15, personality: 0.8 },
  // The shortest path, and the one the ceiling most needs to hold.
  sales: { product: 1.5, proof: 1.4, educational: 0.7, personality: 0.8 },
  // Reach comes from being worth following, not from being for sale.
  audience: { educational: 1.3, personality: 1.5, community: 1.4, product: 0.5, proof: 0.8 },
  // People apply to people. The product is the least interesting thing here.
  hiring: { personality: 1.8, community: 1.4, educational: 1.1, product: 0.4, proof: 0.7 },
};

/** Apply a tilt to a weight set. Absent multipliers mean "leave it alone". */
function tilt(
  w: Required<Pick<PillarWeights, ContentPillar>>,
  objective: Objective | undefined,
): Required<Pick<PillarWeights, ContentPillar>> {
  if (!objective) return w;
  const factors = OBJECTIVE_TILT[objective];
  if (!factors) return w;
  const out = { ...w };
  for (const pillar of PILLARS) out[pillar] = w[pillar] * (factors[pillar] ?? 1);
  return out;
}

export const coldStartWeights = (profile: GenomeProfile): Required<Pick<PillarWeights, ContentPillar>> => ({
  ...COLD_START[profile],
});

/**
 * Cluster the genome onto a profile using dimensions alone.
 *
 * Precedence matters and is not arbitrary — it runs most-specific first, because a
 * business can legitimately match several rows. A SaaS with a founder on camera has
 * both `product_ui` and `person`; it is a SaaS, so `product_ui` is checked first.
 */
export function classifyProfile(d: GenomeDimensions): GenomeProfile {
  const has = (p: GenomeDimensions['proof_asset'][number]) => d.proof_asset.includes(p);

  // Physical craft is unambiguous: a barbershop, a welder, a tailor, a kitchen.
  if (has('physical_craft')) return 'local_business';

  // A sellable physical catalogue.
  if (has('physical_product')) return 'ecommerce';

  // A product interface to demo. Beats `person` — SaaS founders are still SaaS.
  if (has('product_ui')) return 'b2b_saas';

  // Delivered work. Agencies prove with client numbers; freelancers prove with the
  // portfolio and their own judgment. That is the only signal separating them.
  if (has('finished_work')) return has('data_outcomes') && !has('person') ? 'agency' : 'freelancer';

  // Nothing but a person and their opinions. Growing an audience is a creator;
  // selling expertise is a coach.
  if (has('person')) return d.objective === 'audience' ? 'creator' : 'coach';

  // Data with nothing to show — a broker, an analyst. Their proof is knowledge, so
  // they behave like a SaaS minus the product footage.
  return 'b2b_saas';
}

export interface DerivedMix {
  profile: GenomeProfile;
  weights: Required<Pick<PillarWeights, ContentPillar>>;
  source: 'cold_start' | 'learned';
  why: string;
}

/**
 * The mix for a genome. Cold-start defaults until the learning loop's confidence
 * clears 0.4 (§3.2), then that account's own weights — always re-capped and
 * re-normalised, so no path can produce a 100%-promotional account.
 */
export function deriveMix(genome: Genome, objective?: Objective): DerivedMix {
  const profile = classifyProfile(genome.dimensions);
  const { learned } = genome;

  const useLearned = learned.confidence > LEARNED_CONFIDENCE_THRESHOLD && learned.mix_weights_override !== null;

  if (!useLearned) {
    return {
      profile,
      weights: capPromotional(normalise(tilt(coldStartWeights(profile), objective))),
      source: 'cold_start',
      why:
        `Cold-start ratio for a ${profile.replace('_', ' ')} profile — derived from ` +
        `proof asset (${genome.dimensions.proof_asset.join(', ')})` +
        (objective
          ? `, then tilted toward this campaign's objective (${objective})`
          : ` and objective (${genome.dimensions.objective})`) +
        `, not from any category label.`,
    };
  }

  const capped = capPromotional(
    normalise(tilt({ ...coldStartWeights(profile), ...learned.mix_weights_override }, objective)),
  );
  return {
    profile,
    weights: capped,
    source: 'learned',
    why:
      `Learned ratio from this account's own performance (confidence ` +
      `${learned.confidence.toFixed(2)}), re-capped at ${PROMOTIONAL_CEILING * 100}% promotional.`,
  };
}

/* ── Helpers ───────────────────────────────────────────────────────── */


function normalise(w: Partial<Record<ContentPillar, number>>): Required<Pick<PillarWeights, ContentPillar>> {
  const clamped = PILLARS.map((p) => [p, Math.max(0, w[p] ?? 0)] as const);
  const total = clamped.reduce((a, [, v]) => a + v, 0);
  if (total === 0) return coldStartWeights('b2b_saas');
  return Object.fromEntries(clamped.map(([p, v]) => [p, v / total])) as Required<Pick<PillarWeights, ContentPillar>>;
}

/**
 * Enforce the ceiling, then redistribute the excess across the other pillars in
 * proportion to what they already had — so trimming promo does not silently invent
 * a new emphasis.
 */
function capPromotional(w: Required<Pick<PillarWeights, ContentPillar>>): Required<Pick<PillarWeights, ContentPillar>> {
  if (w.product <= PROMOTIONAL_CEILING) return w;

  const excess = w.product - PROMOTIONAL_CEILING;
  const others = PILLARS.filter((p) => p !== 'product');
  const otherTotal = others.reduce((a, p) => a + w[p], 0);

  const out = { ...w, product: PROMOTIONAL_CEILING };
  if (otherTotal === 0) {
    // Degenerate: everything was promo. Fall back to an even spread.
    for (const p of others) out[p] = excess / others.length;
    return out;
  }
  for (const p of others) out[p] = w[p] + (excess * w[p]) / otherTotal;
  return out;
}
