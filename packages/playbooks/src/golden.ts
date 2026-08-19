import type { AssetRole, Genome } from '@sparksocial/shared';

/**
 * THE GOLDEN SET — engine spec §13, outcomes doc Part 4, master plan §11.
 *
 * The spec's own definition of done:
 *
 *   *"A Lagos barbershop, a Toronto B2B SaaS, and a solo web designer in Manila
 *   each connect an account, answer five questions, and receive a month of content
 *   that a competent human marketer would recognise as correct for that business —
 *   without anyone at Tronweb having authored a rule for barbershops,
 *   sales-enablement software, or freelance web design."*
 *
 * These fixtures are the executable form of that sentence. The three named cases
 * come from the spec; the long-tail four (mobile welder, exam-prep tutor, B2B
 * logistics broker, Nigerian tailor) come from plan §11's instruction to include
 * *deliberately awkward* cases — "if those four resolve correctly, the architecture
 * works."
 *
 * `category` is filled in for realism and is **never read by anything**. If a test
 * here passes only because a category string was consulted, the architecture has
 * already failed.
 */

/** What the Asset Graph currently holds, by role. Drives producible vs unlockable. */
export type AssetInventory = Partial<Record<AssetRole, number>>;

export interface GoldenCase {
  id: string;
  label: string;
  genome: Genome;
  assets: AssetInventory;
  /** Playbooks that must NEVER appear in the top selections (plan §11). */
  antiPatterns: string[];
  /** Playbooks a competent marketer would expect near the top. */
  expectTop: string[];
}

function genome(over: {
  id: string;
  name: string;
  category: string;
  locale: string;
  scope: 'global' | 'national' | 'local';
  dimensions: Genome['dimensions'];
  avatar?: boolean;
}): Genome {
  return {
    genome_id: over.id,
    workspace_id: `ws_${over.id}`,
    version: 1,
    identity: {
      business_name: over.name,
      category: over.category, // display only — never routed on
      one_liner: over.name,
      geography: { scope: over.scope, locale: over.locale, radius_km: over.scope === 'local' ? 10 : null },
      languages: [over.locale.split('-')[0] ?? 'en'],
      price_tier: 'mid',
    },
    dimensions: over.dimensions,
    voice: {
      tone_vector: { formal: 0.4, playful: 0.5, technical: 0.4, bold: 0.5 },
      pov_statements: [],
      banned_phrases: [],
      required_disclaimers: [],
      reading_level: 8,
    },
    audience: { segments: [] },
    offer: { products: [], primary_cta: 'Book now' },
    constraints: {
      compliance_profile: 'none',
      avatar_enabled: over.avatar ?? false,
      max_posts_per_week: 12,
      approval_mode: 'review_first_week',
      avatar_override: null,
    },
    learned: { top_formats: [], best_post_times: [], mix_weights_override: null, confidence: 0, frozen: false },
  };
}

/* ── The three named cases ─────────────────────────────────────────── */

export const lagosBarbershop: GoldenCase = {
  id: 'lagos_barbershop',
  label: 'Lagos barbershop',
  genome: genome({
    id: 'gen_barber',
    name: 'Emeka Cuts',
    category: 'barbershop',
    locale: 'en-NG',
    scope: 'local',
    dimensions: {
      proof_asset: ['physical_craft'],
      capture_capability: ['space', 'work_artifacts'],
      objective: 'bookings',
      secondary_objectives: [],
      talent_availability: 'yes_unlicensed', // staff will be filmed, not cloned
    },
  }),
  // Nothing digital yet — the whole month has to come out of the capture loop.
  assets: { brand_kit: 1 },
  // "An avatar will not save a barbershop." (engine spec §8)
  antiPatterns: ['pb_avatar_pov', 'pb_avatar_explainer', 'pb_talking_head_hot_take', 'pb_ai_ugc_testimonial'],
  expectTop: ['pb_craft_capture'],
};

export const torontoSaas: GoldenCase = {
  id: 'toronto_saas',
  label: 'Toronto B2B SaaS',
  genome: genome({
    id: 'gen_saas',
    name: 'Relay',
    category: 'b2b_saas',
    locale: 'en-CA',
    scope: 'global',
    dimensions: {
      proof_asset: ['product_ui', 'data_outcomes'],
      capture_capability: ['screen'],
      objective: 'trials',
      secondary_objectives: ['audience'],
      talent_availability: 'yes_licensed',
    },
  }),
  assets: { product_screen: 6, knowledge: 12, social_proof: 3, brand_kit: 1 },
  // "A B2B SaaS receives a motivational quote card [and cancels]." (§0)
  antiPatterns: ['pb_generated_quote_card'],
  expectTop: ['pb_workflow_clip'],
};

export const manilaFreelancer: GoldenCase = {
  id: 'manila_freelancer',
  label: 'Manila freelance web designer',
  genome: genome({
    id: 'gen_freelancer',
    name: 'Ramos Studio',
    category: 'freelance_web_design',
    locale: 'en-PH',
    scope: 'global',
    dimensions: {
      proof_asset: ['finished_work', 'person'],
      capture_capability: ['screen', 'work_artifacts'],
      objective: 'leads',
      secondary_objectives: ['audience'],
      talent_availability: 'yes_licensed',
    },
    avatar: true, // proof asset IS a person, so cloning proves something
  }),
  assets: { work_artifact: 14, talent_likeness: 1, knowledge: 4, brand_kit: 1 },
  antiPatterns: [],
  expectTop: ['pb_portfolio_in_motion'],
};

/* ── The long tail — plan §11's "deliberately awkward" four ────────── */

export const mobileWelder: GoldenCase = {
  id: 'mobile_welder',
  label: 'Mobile welder (no fixed premises)',
  genome: genome({
    id: 'gen_welder',
    name: 'Ade Mobile Welding',
    category: 'mobile_welding',
    locale: 'en-NG',
    scope: 'local',
    dimensions: {
      proof_asset: ['physical_craft', 'finished_work'],
      capture_capability: ['work_artifacts'], // no "space" — the van is the shop
      objective: 'bookings',
      secondary_objectives: [],
      talent_availability: 'no',
    },
  }),
  assets: { brand_kit: 1 },
  antiPatterns: ['pb_avatar_pov', 'pb_avatar_explainer', 'pb_talking_head_hot_take'],
  expectTop: ['pb_craft_capture'],
};

export const examPrepTutor: GoldenCase = {
  id: 'exam_prep_tutor',
  label: 'Exam-prep tutor',
  genome: genome({
    id: 'gen_tutor',
    name: 'JAMB Ready',
    category: 'exam_prep_tutoring',
    locale: 'en-NG',
    scope: 'national',
    dimensions: {
      proof_asset: ['person', 'data_outcomes'],
      capture_capability: ['screen'],
      objective: 'leads',
      secondary_objectives: ['audience'],
      talent_availability: 'yes_licensed',
    },
    avatar: true,
  }),
  assets: { talent_likeness: 1, knowledge: 20, social_proof: 8, brand_kit: 1 },
  antiPatterns: [],
  expectTop: [],
};

export const logisticsBroker: GoldenCase = {
  id: 'logistics_broker',
  label: 'B2B logistics broker',
  genome: genome({
    id: 'gen_broker',
    name: 'Harbour Freight Partners',
    category: 'b2b_logistics',
    locale: 'en-GB',
    scope: 'national',
    dimensions: {
      proof_asset: ['data_outcomes'],
      capture_capability: ['nothing'], // the hardest case in the whole taxonomy
      objective: 'leads',
      secondary_objectives: [],
      talent_availability: 'no',
    },
  }),
  assets: { knowledge: 9, social_proof: 5, brand_kit: 1 },
  antiPatterns: ['pb_avatar_pov', 'pb_avatar_explainer', 'pb_talking_head_hot_take'],
  expectTop: [],
};

export const nigerianTailor: GoldenCase = {
  id: 'nigerian_tailor',
  label: 'Nigerian tailor',
  genome: genome({
    id: 'gen_tailor',
    name: 'Bisi Bespoke',
    category: 'tailoring',
    locale: 'en-NG',
    scope: 'local',
    dimensions: {
      proof_asset: ['physical_craft', 'finished_work'],
      capture_capability: ['space', 'work_artifacts'],
      objective: 'sales',
      secondary_objectives: ['bookings'],
      talent_availability: 'yes_unlicensed',
    },
  }),
  assets: { work_artifact: 5, brand_kit: 1 },
  antiPatterns: ['pb_avatar_pov', 'pb_avatar_explainer'],
  expectTop: ['pb_craft_capture'],
};

export const GOLDEN_SET: readonly GoldenCase[] = [
  lagosBarbershop,
  torontoSaas,
  manilaFreelancer,
  mobileWelder,
  examPrepTutor,
  logisticsBroker,
  nigerianTailor,
];
