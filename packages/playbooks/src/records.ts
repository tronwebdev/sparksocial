import { definePlaybook, type Playbook } from './schema.js';

/**
 * THE V1 PLAYBOOK LIBRARY — engine spec §5.3.
 *
 * Records, not code. Each declares preconditions over genome dimensions only; no
 * record anywhere names a niche, a category, or an industry. If you find yourself
 * wanting to add one, the dimension you actually need is missing.
 *
 * `objective_fit` is the primary ranking signal and carries most of the judgment in
 * this file. It is where "a workflow clip is the highest intent-to-trial format a
 * SaaS company can post" (§1.1 of the outcomes doc) becomes a number the resolver
 * can act on — and equally where a quote card is marked as near-useless for trials,
 * which is what stops the anti-pattern the eval suite checks for.
 *
 * Objectives omitted from `objective_fit` score 0.
 */

const SHORT_VIDEO = ['instagram', 'tiktok', 'youtube_shorts'] as const;
const ALL_PLATFORMS = ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const;

/* ════════════════════════════════════════════════════════════════════
 * SYNTHESIZE — SPARK makes it from nothing.
 * Gated on a person being the proof asset. Avatar is never a default (§10).
 * ══════════════════════════════════════════════════════════════════ */

export const avatarPov = definePlaybook({
  playbook_id: 'pb_avatar_pov',
  name: 'Avatar POV',
  description: 'A strong opinion delivered to camera by the cloned likeness. Not about the product.',
  mode: 'synthesize',
  preconditions: {
    proof_asset_any: ['person'],
    required_asset_roles: ['talent_likeness'],
    min_assets: 1,
    talent_required: true,
    requires_likeness_license: true,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '1:1'], duration_sec: [20, 45], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.contrarian' },
      { id: 'argument', duration_sec: 25, prompt_ref: 'pov.thesis' },
      { id: 'cta', duration_sec: 4, source: 'genome:offer.primary_cta' },
    ],
  },
  // People follow founders, not logos — this is a distribution format, not a
  // conversion one, so audience scores far above sales.
  objective_fit: { audience: 0.9, leads: 0.6, hiring: 0.5, trials: 0.4, bookings: 0.3, sales: 0.25 },
  content_pillar: 'personality',
  saturation_risk: 'high',
  compliance_flags: [],
});

export const avatarExplainer = definePlaybook({
  playbook_id: 'pb_avatar_explainer',
  name: 'Avatar Explainer',
  description: 'Cloned likeness teaching one idea end to end.',
  mode: 'synthesize',
  preconditions: {
    proof_asset_any: ['person'],
    required_asset_roles: ['talent_likeness'],
    min_assets: 1,
    talent_required: true,
    requires_likeness_license: true,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [30, 60], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.question' },
      { id: 'teach', duration_sec: 40, prompt_ref: 'teach.one_idea' },
      { id: 'cta', duration_sec: 4, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { audience: 0.8, leads: 0.7, trials: 0.5, bookings: 0.5, sales: 0.3 },
  content_pillar: 'educational',
  saturation_risk: 'high',
  compliance_flags: [],
});

export const talkingHeadHotTake = definePlaybook({
  playbook_id: 'pb_talking_head_hot_take',
  name: 'Talking Head Hot Take',
  description: 'Short, blunt opinion filmed or synthesized to camera.',
  mode: 'synthesize',
  preconditions: {
    proof_asset_any: ['person'],
    required_asset_roles: ['talent_likeness'],
    min_assets: 1,
    talent_required: true,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [15, 30], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'take', duration_sec: 20, prompt_ref: 'pov.hot_take' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { audience: 0.85, leads: 0.55, hiring: 0.3, trials: 0.35, bookings: 0.35, sales: 0.2 },
  content_pillar: 'personality',
  saturation_risk: 'high',
  compliance_flags: [],
});

export const generatedQuoteCard = definePlaybook({
  playbook_id: 'pb_generated_quote_card',
  name: 'Generated Quote Card',
  description: 'A text-legible graphic carrying one line of point of view.',
  mode: 'synthesize',
  preconditions: { required_asset_roles: ['brand_kit'], min_assets: 0, talent_required: false },
  output: { media_type: 'image', aspect_ratios: ['1:1', '4:5'], platforms: [...ALL_PLATFORMS] },
  structure: { beats: [{ id: 'card', duration_sec: 0, prompt_ref: 'quote.pov' }] },
  // Deliberately weak almost everywhere. Nothing structurally forbids a quote card
  // for a B2B SaaS chasing trials — the reason it never gets selected is that it
  // does not convert, and that judgment belongs here as a number rather than as a
  // special case in the resolver. See the anti-pattern assertions in golden.test.ts.
  objective_fit: { audience: 0.45, leads: 0.2, hiring: 0.15, trials: 0.1, bookings: 0.1, sales: 0.1 },
  content_pillar: 'personality',
  saturation_risk: 'high',
  compliance_flags: [],
});

export const voiceOverBroll = definePlaybook({
  playbook_id: 'pb_voice_over_broll',
  name: 'Voice-over B-roll',
  description: 'Narrated stock or owned b-roll. No face required.',
  mode: 'synthesize',
  preconditions: { required_asset_roles: ['brand_kit'], min_assets: 0, talent_required: false },
  output: { media_type: 'video', aspect_ratios: ['9:16', '16:9'], duration_sec: [20, 45], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.problem' },
      { id: 'body', duration_sec: 30, prompt_ref: 'teach.one_idea' },
      { id: 'cta', duration_sec: 4, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { audience: 0.6, leads: 0.5, trials: 0.4, bookings: 0.4, sales: 0.35 },
  content_pillar: 'educational',
  saturation_risk: 'medium',
  compliance_flags: [],
});

export const carouselTeaching = definePlaybook({
  playbook_id: 'pb_carousel_teaching',
  name: 'Teaching Carousel',
  description: 'A multi-slide walkthrough of one idea.',
  mode: 'synthesize',
  preconditions: { required_asset_roles: ['brand_kit'], min_assets: 0, talent_required: false },
  output: { media_type: 'carousel', aspect_ratios: ['4:5'], platforms: ['instagram', 'linkedin'] },
  structure: {
    beats: [
      { id: 'cover', duration_sec: 0, prompt_ref: 'hook.listicle' },
      { id: 'slides', duration_sec: 0, prompt_ref: 'teach.steps' },
      { id: 'cta', duration_sec: 0, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { audience: 0.7, leads: 0.65, trials: 0.45, bookings: 0.4, sales: 0.3 },
  content_pillar: 'educational',
  saturation_risk: 'medium',
  compliance_flags: [],
});

export const aiUgcTestimonial = definePlaybook({
  playbook_id: 'pb_ai_ugc_testimonial',
  name: 'AI-UGC Testimonial',
  description: 'A synthesized user-style review. Always discloses that it is AI-generated.',
  mode: 'synthesize',
  preconditions: {
    proof_asset_any: ['physical_product', 'product_ui'],
    required_asset_roles: ['social_proof'],
    min_assets: 1,
    talent_required: false,
    requires_likeness_license: true,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [15, 30], platforms: [...SHORT_VIDEO] },
  structure: {
    beats: [
      { id: 'reaction', duration_sec: 15, prompt_ref: 'ugc.review' },
      { id: 'disclosure', duration_sec: 2, prompt_ref: 'legal.ai_disclosure' },
    ],
  },
  objective_fit: { sales: 0.7, trials: 0.4, audience: 0.3, leads: 0.3 },
  content_pillar: 'proof',
  saturation_risk: 'high',
  compliance_flags: ['ai_disclosure', 'likeness_rights'],
  requires_disclosure: true,
});

/* ════════════════════════════════════════════════════════════════════
 * ASSEMBLE — SPARK builds from what the customer already owns.
 * The highest-value and most under-built path (§1.1 outcomes doc).
 * ══════════════════════════════════════════════════════════════════ */

export const workflowClip = definePlaybook({
  playbook_id: 'pb_workflow_clip',
  name: 'Workflow Clip',
  description: 'One product workflow, 15–30s, screen recorded, time-saving hook.',
  mode: 'assemble',
  preconditions: {
    capture_capability_any: ['screen'],
    proof_asset_any: ['product_ui'],
    required_asset_roles: ['product_screen'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '1:1'], duration_sec: [15, 30], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.time_cost' },
      { id: 'demo', duration_sec: 18, source: 'asset:product_screen' },
      { id: 'payoff', duration_sec: 5, prompt_ref: 'payoff.outcome' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  // "Highest intent-to-trial conversion of anything they can post." (outcomes §1.1)
  objective_fit: { trials: 0.95, leads: 0.75, sales: 0.55, audience: 0.4, bookings: 0.4 },
  content_pillar: 'product',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const problemFirstEducation = definePlaybook({
  playbook_id: 'pb_problem_first_education',
  name: 'Problem-first Education',
  description: 'The pain, in detail. Product mentioned in the last three seconds, or not at all.',
  mode: 'assemble',
  preconditions: { required_asset_roles: ['knowledge'], min_assets: 1, talent_required: false },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [30, 60], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.problem' },
      { id: 'body', duration_sec: 45, prompt_ref: 'teach.pain_before_product' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { trials: 0.8, leads: 0.85, audience: 0.75, bookings: 0.6, sales: 0.4 },
  content_pillar: 'educational',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const beforeAfterTransformation = definePlaybook({
  playbook_id: 'pb_before_after_transformation',
  name: 'Before / After Transformation',
  description: 'Old → new, hard cut or wipe. Needs no narration.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['finished_work', 'physical_craft', 'physical_product'],
    required_asset_roles: ['work_artifact'],
    min_assets: 2,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '1:1'], duration_sec: [10, 25], platforms: [...SHORT_VIDEO] },
  structure: {
    beats: [
      { id: 'before', duration_sec: 5, source: 'asset:work_artifact' },
      { id: 'after', duration_sec: 8, source: 'asset:work_artifact' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  // "Outperforms everything else available to an agency." (outcomes §1.2)
  objective_fit: { leads: 0.9, bookings: 0.85, sales: 0.7, audience: 0.6, trials: 0.35 },
  content_pillar: 'proof',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const resultCard = definePlaybook({
  playbook_id: 'pb_result_card',
  name: 'Client Result Card',
  description: 'One real number, one logo, one sentence of context.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['data_outcomes', 'finished_work'],
    required_asset_roles: ['social_proof'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'image', aspect_ratios: ['1:1', '4:5'], platforms: [...ALL_PLATFORMS] },
  structure: { beats: [{ id: 'card', duration_sec: 0, prompt_ref: 'proof.result_number' }] },
  objective_fit: { leads: 0.85, bookings: 0.8, trials: 0.7, sales: 0.6, audience: 0.35 },
  content_pillar: 'proof',
  saturation_risk: 'low',
  compliance_flags: ['claim_grounding'],
});

export const portfolioInMotion = definePlaybook({
  playbook_id: 'pb_portfolio_in_motion',
  name: 'Portfolio in Motion',
  description: 'Screen-recorded scroll-through of delivered work, with one line on the goal it served.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['finished_work'],
    required_asset_roles: ['work_artifact'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [15, 30], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.goal_served' },
      { id: 'scroll', duration_sec: 20, source: 'asset:work_artifact' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  // "Their portfolio is dead in a PDF. In motion it sells." (outcomes §1.4)
  objective_fit: { leads: 0.9, bookings: 0.85, sales: 0.5, audience: 0.5, trials: 0.25 },
  content_pillar: 'proof',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const changelogShipPost = definePlaybook({
  playbook_id: 'pb_changelog_ship_post',
  name: 'Ship / Changelog Post',
  description: '"New this week: X", with a screen recording of the new thing.',
  mode: 'assemble',
  preconditions: {
    capture_capability_any: ['screen'],
    proof_asset_any: ['product_ui'],
    required_asset_roles: ['product_screen'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '16:9'], duration_sec: [10, 25], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'announce', duration_sec: 3, prompt_ref: 'hook.shipped' },
      { id: 'demo', duration_sec: 15, source: 'asset:product_screen' },
    ],
  },
  objective_fit: { trials: 0.75, leads: 0.5, audience: 0.45, sales: 0.35 },
  content_pillar: 'product',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const comparisonVs = definePlaybook({
  playbook_id: 'pb_comparison_vs',
  name: 'Comparison (X vs Y)',
  description: 'Honest side-by-side against a known alternative, including where the alternative wins.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['product_ui', 'physical_product'],
    required_asset_roles: ['knowledge'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '16:9'], duration_sec: [30, 60], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.versus' },
      { id: 'compare', duration_sec: 40, prompt_ref: 'compare.honest' },
      { id: 'cta', duration_sec: 4, source: 'genome:offer.primary_cta' },
    ],
  },
  // "Captures the highest-intent audience there is: people actively shopping."
  objective_fit: { trials: 0.85, sales: 0.8, leads: 0.7, audience: 0.4, bookings: 0.4 },
  content_pillar: 'educational',
  saturation_risk: 'low',
  compliance_flags: ['claim_grounding'],
});

export const testimonialSnippet = definePlaybook({
  playbook_id: 'pb_testimonial_snippet',
  name: 'Testimonial Snippet',
  description: 'A real customer quote, set in brand type over relevant footage.',
  mode: 'assemble',
  preconditions: { required_asset_roles: ['social_proof'], min_assets: 1, talent_required: false },
  output: { media_type: 'video', aspect_ratios: ['9:16', '1:1'], duration_sec: [10, 20], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'quote', duration_sec: 12, source: 'asset:social_proof' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { bookings: 0.8, sales: 0.75, leads: 0.7, trials: 0.6, audience: 0.35 },
  content_pillar: 'proof',
  saturation_risk: 'low',
  compliance_flags: ['rights'],
});

export const dataInsightPost = definePlaybook({
  playbook_id: 'pb_data_insight_post',
  name: 'Data Insight',
  description: 'Aggregate anonymised platform data nobody else has.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['data_outcomes'],
    required_asset_roles: ['knowledge'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'image', aspect_ratios: ['1:1', '16:9'], platforms: [...ALL_PLATFORMS] },
  structure: { beats: [{ id: 'chart', duration_sec: 0, prompt_ref: 'data.insight' }] },
  objective_fit: { audience: 0.85, leads: 0.7, trials: 0.55, bookings: 0.4, sales: 0.3 },
  content_pillar: 'educational',
  saturation_risk: 'low',
  compliance_flags: ['claim_grounding'],
});

export const caseStudyBreakdown = definePlaybook({
  playbook_id: 'pb_case_study_breakdown',
  name: 'Case Study Breakdown',
  description: '60–90s: the problem, what we tried, what worked, the number.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['finished_work', 'data_outcomes'],
    required_asset_roles: ['social_proof', 'work_artifact'],
    min_assets: 2,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '16:9'], duration_sec: [60, 90], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'problem', duration_sec: 15, prompt_ref: 'case.problem' },
      { id: 'work', duration_sec: 45, source: 'asset:work_artifact' },
      { id: 'number', duration_sec: 10, source: 'asset:social_proof' },
    ],
  },
  objective_fit: { leads: 0.85, bookings: 0.8, trials: 0.5, sales: 0.5, audience: 0.4 },
  content_pillar: 'proof',
  saturation_risk: 'low',
  compliance_flags: ['claim_grounding'],
});

export const teardownOfOtherBrands = definePlaybook({
  playbook_id: 'pb_teardown_of_other_brands',
  name: 'Teardown',
  description: "Analyse another brand's page, ad or work — publicly and constructively.",
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['finished_work', 'product_ui'],
    required_asset_roles: ['knowledge'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '16:9'], duration_sec: [30, 90], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'hook', duration_sec: 3, prompt_ref: 'hook.teardown' },
      { id: 'analysis', duration_sec: 50, prompt_ref: 'teardown.constructive' },
    ],
  },
  // "Massive reach. Free positioning. The single most underused agency format."
  objective_fit: { audience: 0.9, leads: 0.75, bookings: 0.55, trials: 0.35, sales: 0.3 },
  content_pillar: 'personality',
  saturation_risk: 'medium',
  compliance_flags: [],
});

export const productInUseMontage = definePlaybook({
  playbook_id: 'pb_product_in_use_montage',
  name: 'Product-in-use Montage',
  description: 'Same product, several contexts, cut to a beat.',
  mode: 'assemble',
  preconditions: {
    proof_asset_any: ['physical_product'],
    required_asset_roles: ['product_shot'],
    min_assets: 3,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '1:1'], duration_sec: [10, 20], platforms: [...SHORT_VIDEO] },
  structure: {
    beats: [
      { id: 'montage', duration_sec: 14, source: 'asset:product_shot' },
      { id: 'cta', duration_sec: 3, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { sales: 0.9, audience: 0.5, leads: 0.4, trials: 0.2 },
  content_pillar: 'product',
  saturation_risk: 'medium',
  compliance_flags: [],
});

export const offerAnnouncement = definePlaybook({
  playbook_id: 'pb_offer_announcement',
  name: 'Offer / Availability',
  description: '"Two slots open in September" or "Tuesday 2–5pm, 20% off." Scheduled deliberately, never spammed.',
  mode: 'assemble',
  preconditions: { required_asset_roles: ['brand_kit'], min_assets: 0, talent_required: false },
  output: { media_type: 'image', aspect_ratios: ['1:1', '9:16'], platforms: [...ALL_PLATFORMS] },
  structure: {
    beats: [
      { id: 'offer', duration_sec: 0, prompt_ref: 'offer.scarcity' },
      { id: 'cta', duration_sec: 0, source: 'genome:offer.primary_cta' },
    ],
  },
  objective_fit: { bookings: 0.85, sales: 0.8, leads: 0.6, trials: 0.5, hiring: 0.3, audience: 0.15 },
  content_pillar: 'product',
  saturation_risk: 'medium',
  compliance_flags: [],
});

/* ════════════════════════════════════════════════════════════════════
 * DIRECT + FINISH — SPARK tells a human exactly what to film, then finishes it.
 *
 * The moat (§1.3). These stay resolvable as UNLOCKABLE even when the assets do
 * not exist yet — that gap is precisely what drives the capture loop.
 * ══════════════════════════════════════════════════════════════════ */

export const craftCapture = definePlaybook({
  playbook_id: 'pb_craft_capture',
  name: 'Craft Capture',
  description: '15–25s of the work itself. The fade finishing, the dough stretching, the seam sewn. No talking.',
  mode: 'direct_finish',
  preconditions: {
    capture_capability_any: ['space', 'work_artifacts', 'product'],
    proof_asset_any: ['physical_craft', 'finished_work', 'physical_product'],
    required_asset_roles: ['physical_capture'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16', '1:1'], duration_sec: [15, 25], platforms: [...SHORT_VIDEO] },
  structure: {
    beats: [
      { id: 'craft', duration_sec: 20, source: 'asset:physical_capture' },
      { id: 'hook_overlay', duration_sec: 3, prompt_ref: 'hook.craft' },
    ],
  },
  // "The entire game. Hypnotic, endlessly repeatable, algorithm-friendly, proves
  // skill without a single claim." (outcomes §1.3)
  objective_fit: { bookings: 0.95, sales: 0.7, audience: 0.8, leads: 0.6, hiring: 0.3 },
  content_pillar: 'community',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const staffPersonality = definePlaybook({
  playbook_id: 'pb_staff_personality',
  name: 'Staff Personality',
  description: '20s of a team member being themselves, name on screen.',
  mode: 'direct_finish',
  preconditions: {
    capture_capability_any: ['space'],
    required_asset_roles: ['physical_capture'],
    min_assets: 1,
    talent_required: true,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [15, 30], platforms: [...SHORT_VIDEO] },
  structure: { beats: [{ id: 'person', duration_sec: 20, source: 'asset:physical_capture' }] },
  // "People buy from people locally. Turns a shop into 'Emeka's place.'"
  objective_fit: { bookings: 0.8, hiring: 0.75, audience: 0.6, leads: 0.5, sales: 0.4 },
  content_pillar: 'personality',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const spaceAtmosphere = definePlaybook({
  playbook_id: 'pb_space_atmosphere',
  name: 'Space / Atmosphere',
  description: 'The room at opening. Morning light. Setup. Sound on.',
  mode: 'direct_finish',
  preconditions: {
    capture_capability_any: ['space'],
    required_asset_roles: ['physical_capture'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [10, 20], platforms: [...SHORT_VIDEO] },
  structure: { beats: [{ id: 'room', duration_sec: 15, source: 'asset:physical_capture' }] },
  // "Reduces the anxiety of walking into somewhere new."
  objective_fit: { bookings: 0.7, audience: 0.55, sales: 0.4, leads: 0.4 },
  content_pillar: 'community',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const customerReaction = definePlaybook({
  playbook_id: 'pb_customer_reaction',
  name: 'Customer Reaction',
  description: 'The moment someone sees the result. Consent required.',
  mode: 'direct_finish',
  preconditions: {
    capture_capability_any: ['space', 'work_artifacts'],
    required_asset_roles: ['physical_capture'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [10, 20], platforms: [...SHORT_VIDEO] },
  structure: { beats: [{ id: 'reaction', duration_sec: 15, source: 'asset:physical_capture' }] },
  // "Social proof that cannot be faked or bought."
  objective_fit: { bookings: 0.85, sales: 0.7, audience: 0.6, leads: 0.55 },
  content_pillar: 'proof',
  saturation_risk: 'low',
  compliance_flags: ['rights'],
});

export const behindTheBuild = definePlaybook({
  playbook_id: 'pb_behind_the_build',
  name: 'Behind the Build / Prep',
  description: 'Opening routine, tools laid out, restock, the work before the work.',
  mode: 'direct_finish',
  preconditions: {
    capture_capability_any: ['space', 'work_artifacts'],
    required_asset_roles: ['physical_capture'],
    min_assets: 1,
    talent_required: false,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [15, 30], platforms: [...SHORT_VIDEO] },
  structure: { beats: [{ id: 'prep', duration_sec: 20, source: 'asset:physical_capture' }] },
  objective_fit: { bookings: 0.65, audience: 0.6, hiring: 0.4, sales: 0.35, leads: 0.35 },
  content_pillar: 'community',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const dayInTheLife = definePlaybook({
  playbook_id: 'pb_day_in_the_life',
  name: 'Day in the Life',
  description: 'A shift or a build, compressed. Filmed in pieces across one day.',
  mode: 'direct_finish',
  preconditions: {
    capture_capability_any: ['space', 'work_artifacts'],
    required_asset_roles: ['physical_capture'],
    min_assets: 3,
    talent_required: true,
  },
  output: { media_type: 'video', aspect_ratios: ['9:16'], duration_sec: [30, 60], platforms: [...SHORT_VIDEO] },
  structure: { beats: [{ id: 'montage', duration_sec: 45, source: 'asset:physical_capture' }] },
  objective_fit: { hiring: 0.8, audience: 0.7, bookings: 0.55, leads: 0.4 },
  content_pillar: 'personality',
  saturation_risk: 'low',
  compliance_flags: [],
});

export const seasonalLocalContext = definePlaybook({
  playbook_id: 'pb_seasonal_local_context',
  name: 'Seasonal / Local Context',
  description: 'Neighbourhood events, weather, holidays, local slang. Signals "we are actually here."',
  mode: 'assemble',
  preconditions: { required_asset_roles: ['brand_kit'], min_assets: 0, talent_required: false },
  output: { media_type: 'image', aspect_ratios: ['1:1', '9:16'], platforms: [...SHORT_VIDEO] },
  structure: { beats: [{ id: 'post', duration_sec: 0, prompt_ref: 'local.context' }] },
  objective_fit: { bookings: 0.6, audience: 0.6, sales: 0.4, leads: 0.35 },
  content_pillar: 'community',
  saturation_risk: 'low',
  compliance_flags: [],
});

/* ── The library ───────────────────────────────────────────────────── */

export const PLAYBOOKS: readonly Playbook[] = [
  // Synthesize
  avatarPov,
  avatarExplainer,
  talkingHeadHotTake,
  generatedQuoteCard,
  voiceOverBroll,
  carouselTeaching,
  aiUgcTestimonial,
  // Assemble
  workflowClip,
  problemFirstEducation,
  beforeAfterTransformation,
  resultCard,
  portfolioInMotion,
  changelogShipPost,
  comparisonVs,
  testimonialSnippet,
  dataInsightPost,
  caseStudyBreakdown,
  teardownOfOtherBrands,
  productInUseMontage,
  offerAnnouncement,
  seasonalLocalContext,
  // Direct + Finish
  craftCapture,
  staffPersonality,
  spaceAtmosphere,
  customerReaction,
  behindTheBuild,
  dayInTheLife,
];

export const byId = (id: string): Playbook | undefined => PLAYBOOKS.find((p) => p.playbook_id === id);
