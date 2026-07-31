import { z } from 'zod';
import { ContentPillar, GenomeDimensions } from './types.js';

/**
 * THE BRAND GENOME — engine spec §3.2.
 *
 * The structured representation of a customer that every downstream decision reads
 * from. Built once during Workspace Genesis from five questions (§3.1) and
 * continuously refined.
 *
 * `dimensions` is the routing key for the entire engine and is indexed as such.
 * Everything else here is context the pipelines read: `voice` shapes copy,
 * `constraints` gates guardrails, `offer` supplies the CTA, `learned` overrides the
 * cold-start mix once it has earned the right to.
 */

/* ── Identity ──────────────────────────────────────────────────────── */

export const Geography = z.object({
  scope: z.enum(['global', 'national', 'local']),
  /** BCP-47, e.g. "en-NG". */
  locale: z.string(),
  /** Null for anything not geographically bounded. */
  radius_km: z.number().nullable(),
});

export const GenomeIdentity = z.object({
  business_name: z.string(),
  /**
   * A human-readable label ONLY. Never branch on it — routing is by dimensions
   * (CLAUDE.md invariant 5). It exists for display and for playbook authors.
   */
  category: z.string(),
  sub_category: z.string().optional(),
  one_liner: z.string(),
  geography: Geography,
  languages: z.array(z.string()).min(1),
  price_tier: z.enum(['budget', 'mid', 'premium', 'enterprise']),
});
export type GenomeIdentity = z.infer<typeof GenomeIdentity>;

/* ── Voice ─────────────────────────────────────────────────────────── */

export const GenomeVoice = z.object({
  /** Each axis 0–1. Distance against approved samples is the brand-voice guardrail. */
  tone_vector: z.object({
    formal: z.number().min(0).max(1),
    playful: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    bold: z.number().min(0).max(1),
  }),
  pov_statements: z.array(z.string()).default([]),
  banned_phrases: z.array(z.string()).default([]),
  required_disclaimers: z.array(z.string()).default([]),
  reading_level: z.number().int().min(1).max(20).default(8),
});
export type GenomeVoice = z.infer<typeof GenomeVoice>;

/* ── Audience & offer ──────────────────────────────────────────────── */

export const GenomeAudience = z.object({
  segments: z
    .array(
      z.object({
        label: z.string(),
        pains: z.array(z.string()).default([]),
        platforms: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export const GenomeOffer = z.object({
  products: z
    .array(
      z.object({
        name: z.string(),
        price: z.string().optional(),
        cta_url: z.string().url().optional(),
      }),
    )
    .default([]),
  primary_cta: z.string().default(''),
});

/* ── Constraints ───────────────────────────────────────────────────── */

export const ComplianceProfile = z.enum(['none', 'health', 'finance', 'legal', 'regulated_other']);
export type ComplianceProfile = z.infer<typeof ComplianceProfile>;

export const GenomeConstraints = z.object({
  compliance_profile: ComplianceProfile.default('none'),
  /**
   * Engine spec §10 / outcomes Rule 1: defaults FALSE for any genome whose proof
   * asset is not a person. Derived by `genome.dimensions.set`, not asked. An
   * explicit override is what enables founder-POV avatar for a SaaS or agency —
   * see {@link avatarDefault}.
   */
  avatar_enabled: z.boolean().default(false),
  max_posts_per_week: z.number().int().min(1).max(50).default(12),
  approval_mode: z.enum(['autopublish', 'review_first_week', 'review_everything']).default('review_first_week'),
});
export type GenomeConstraints = z.infer<typeof GenomeConstraints>;

/**
 * The avatar default, expressed once so both onboarding and the guardrail layer
 * agree. Cloned video only proves something when the person *is* the proof asset;
 * an avatar telling you to book a haircut proves nothing, which is the specific
 * failure the product exists to avoid.
 */
export const avatarDefault = (dimensions: Pick<GenomeDimensions, 'proof_asset' | 'talent_availability'>): boolean =>
  dimensions.proof_asset.includes('person') && dimensions.talent_availability === 'yes_licensed';

/* ── Learned (populated by the learning loop, §7.2) ────────────────── */

/** Pillar weights summing to 1. The output of the mix engine. */
export const PillarWeights = z.record(ContentPillar, z.number().min(0).max(1));
export type PillarWeights = Partial<Record<z.infer<typeof ContentPillar>, number>>;

export const GenomeLearned = z.object({
  top_formats: z.array(z.string()).default([]),
  best_post_times: z.array(z.string()).default([]),
  /** Null until the sampler has earned the right to override cold-start defaults. */
  mix_weights_override: PillarWeights.nullable().default(null),
  /**
   * Engine spec §3.2: defer to template defaults until confidence > 0.4. The
   * resolver's `learned_performance_multiplier` is 1.0 below that threshold.
   */
  confidence: z.number().min(0).max(1).default(0),
});
export type GenomeLearned = z.infer<typeof GenomeLearned>;

export const LEARNED_CONFIDENCE_THRESHOLD = 0.4;

/* ── The whole thing ───────────────────────────────────────────────── */

export const Genome = z.object({
  genome_id: z.string(),
  workspace_id: z.string(),
  /** Increments on every material change; cached playbook resolutions invalidate on bump. */
  version: z.number().int().min(1),

  identity: GenomeIdentity,
  dimensions: GenomeDimensions,
  voice: GenomeVoice,
  audience: GenomeAudience.default({ segments: [] }),
  offer: GenomeOffer.default({ products: [], primary_cta: '' }),
  constraints: GenomeConstraints.default({}),
  learned: GenomeLearned.default({}),
});
export type Genome = z.infer<typeof Genome>;
