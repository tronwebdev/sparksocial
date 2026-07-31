import { z } from 'zod';
import {
  AssetRole,
  CaptureCapability,
  ContentPillar,
  GenerationMode,
  Objective,
  ProofAsset,
} from '@sparksocial/shared';

/**
 * PLAYBOOK SCHEMA — engine spec §5.1.
 *
 * A playbook is a composable content recipe. The whole architecture turns on one
 * property of this schema: **preconditions are expressed in genome dimensions and
 * required asset roles, never in niche names** (CLAUDE.md invariant 5). That is
 * what lets a mobile welder, an exam-prep tutor and a Nigerian tailor resolve
 * correctly without anyone authoring a rule for them.
 *
 * Records are *data*. Adding a playbook must never require a deploy — which is why
 * `beats` reference prompts and assets by id rather than embedding logic.
 */

export const SaturationRisk = z.enum(['low', 'medium', 'high']);

/**
 * Every field is a *filter over dimensions*. An empty/absent field means "no
 * constraint on this axis", so a playbook that works for anyone declares nothing.
 */
export const Preconditions = z.object({
  /** Satisfied if the genome has ANY of these capture capabilities. */
  capture_capability_any: z.array(CaptureCapability).optional(),
  /** Satisfied if the genome has ANY of these proof assets. */
  proof_asset_any: z.array(ProofAsset).optional(),
  /** Asset roles that must exist in the Asset Graph for this to be producible. */
  required_asset_roles: z.array(AssetRole).default([]),
  min_assets: z.number().int().min(0).default(0),
  /**
   * True when a human must be filmable or cloneable. Checked against
   * `talent_availability`, and — for cloning specifically — against
   * `constraints.avatar_enabled`, which defaults false off-person (§10).
   */
  talent_required: z.boolean().default(false),
  /** True when the playbook needs a *licensed* likeness, i.e. avatar/voice cloning. */
  requires_likeness_license: z.boolean().default(false),
});
export type Preconditions = z.infer<typeof Preconditions>;

export const Beat = z.object({
  id: z.string(),
  duration_sec: z.number().min(0),
  /** Reference into the prompt library, for generated beats. */
  prompt_ref: z.string().optional(),
  /** Reference into the Asset Graph or genome, e.g. "asset:product_screen". */
  source: z.string().optional(),
});

export const Playbook = z.object({
  playbook_id: z.string(),
  name: z.string(),
  description: z.string(),
  mode: GenerationMode,

  preconditions: Preconditions,

  output: z.object({
    media_type: z.enum(['video', 'image', 'carousel', 'text']),
    aspect_ratios: z.array(z.string()).min(1),
    duration_sec: z.tuple([z.number(), z.number()]).optional(),
    platforms: z.array(z.string()).min(1),
  }),

  /** Beats map 1:1 onto Remotion composition props. */
  structure: z.object({ beats: z.array(Beat).min(1) }),

  /**
   * How well this format serves each objective, 0–1. This is the primary ranking
   * signal, and it is what keeps a quote card from being selected for a SaaS
   * chasing trials even though nothing structurally forbids it.
   */
  objective_fit: z.record(Objective, z.number().min(0).max(1)),

  content_pillar: ContentPillar,
  saturation_risk: SaturationRisk,
  compliance_flags: z.array(z.string()).default([]),
  /** Platform-required disclosure, e.g. AI-generated UGC. */
  requires_disclosure: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type Playbook = z.infer<typeof Playbook>;

/** Authoring helper: validates at module load, so a bad record fails the build. */
export const definePlaybook = (p: z.input<typeof Playbook>): Playbook => Playbook.parse(p);
