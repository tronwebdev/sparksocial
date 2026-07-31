import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import {
  CaptureCapability,
  Objective,
  ProofAsset,
  TalentAvailability,
  GenerationMode,
} from '@sparksocial/shared/types';

/**
 * `genome.dimensions.set` — onboarding questions 2, 3 and 4.
 *
 * These four dimensions are **the routing key for the entire engine** (engine spec
 * §1.2, §3.2). Everything downstream — playbook resolution, mix ratios, which
 * production pipeline runs — reads them and nothing reads a niche label.
 *
 * Q3 ("What can you show me?") is, per the outcomes doc §3.1, *the most important
 * question in the entire flow*: it determines `capture_capability`, which
 * determines the production mode, which determines everything after it. So this
 * tool also returns which of the three modes the answers unlock, and says plainly
 * when a business has locked itself out of one — that is the conversation SPARK
 * needs to have during onboarding, not a silent downgrade later.
 *
 * Maps to PRD ONB-03. Pure: no I/O beyond persisting the genome patch.
 */

const AvailableModes = z.object({
  synthesize: z.boolean(),
  assemble: z.boolean(),
  direct_finish: z.boolean(),
});

export const DimensionsSetInput = z.object({
  genomeId: z.string(),
  proof_asset: z.array(ProofAsset).min(1),
  capture_capability: z.array(CaptureCapability).min(1),
  objective: Objective,
  secondary_objectives: z.array(Objective).default([]),
  talent_availability: TalentAvailability,
});

export const DimensionsSetOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  availableModes: AvailableModes,
  /**
   * Engine spec §10: avatar defaults OFF for any genome whose proof asset is not
   * a person. Returned here so onboarding never has to ask "do you want avatars?"
   * — the answer is derived.
   */
  avatarEnabled: z.boolean(),
  /** Modes the answers ruled out, with the reason, for SPARK to say out loud. */
  blockedModes: z.array(z.object({ mode: GenerationMode, because: z.string() })),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z
      .array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() }))
      .default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

type Dims = z.infer<typeof DimensionsSetInput>;

/**
 * Which production modes the dimensions unlock.
 *
 * - SYNTHESIZE needs a person willing to be cloned, or generative visuals being
 *   genuinely acceptable. Talent `no` closes the avatar path.
 * - ASSEMBLE needs proof that already exists in digital form.
 * - DIRECT + FINISH needs something physical to point a phone at. It is the mode
 *   that rescues `capture_capability: ['nothing']` businesses, and the reason a
 *   local business stays subscribed.
 */
function resolveModes(d: Dims) {
  const digitalProof = d.proof_asset.some((p) =>
    ['product_ui', 'finished_work', 'data_outcomes', 'physical_product'].includes(p),
  );
  const physicalToFilm = d.capture_capability.some((c) => ['space', 'work_artifacts', 'product'].includes(c));

  return {
    synthesize: d.talent_availability !== 'no' || d.proof_asset.includes('person'),
    assemble: digitalProof || d.capture_capability.includes('screen'),
    direct_finish: physicalToFilm || d.proof_asset.includes('physical_craft'),
  };
}

function explainBlocked(d: Dims, modes: ReturnType<typeof resolveModes>) {
  const blocked: Array<{ mode: 'synthesize' | 'assemble' | 'direct_finish'; because: string }> = [];
  if (!modes.synthesize) {
    blocked.push({
      mode: 'synthesize',
      because: 'Nobody is available to be on camera or cloned, so avatar and voice formats are off.',
    });
  }
  if (!modes.assemble) {
    blocked.push({
      mode: 'assemble',
      because: 'There is no proof asset that already exists digitally to build from.',
    });
  }
  if (!modes.direct_finish) {
    blocked.push({
      mode: 'direct_finish',
      because: 'There is nothing physical to film, so capture briefs would have no subject.',
    });
  }
  return blocked;
}

export const genomeDimensionsSet = defineTool({
  name: 'genome.dimensions.set',
  version: 1,

  summary:
    'Record the four genome dimensions from onboarding (proof asset, what they can show, ' +
    'their objective, and whether anyone will be on camera). Returns which of the three ' +
    'production modes those answers unlock. Free.',

  input: DimensionsSetInput,
  output: DimensionsSetOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['ONB-03'],

  async handler(input, ctx) {
    const modes = resolveModes(input);
    const blockedModes = explainBlocked(input, modes);

    // Engine spec §10 / outcomes doc Rule 1: avatar is opt-in by proof asset,
    // never a default. Enabling it for a barbershop is the failure this product
    // exists to avoid.
    const avatarEnabled = input.proof_asset.includes('person') && input.talent_availability === 'yes_licensed';

    const saved = await ctx.db.genomes.patchDimensions({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      dimensions: {
        proof_asset: input.proof_asset,
        capture_capability: input.capture_capability,
        objective: input.objective,
        secondary_objectives: input.secondary_objectives,
        talent_availability: input.talent_availability,
      },
      avatarEnabled,
    });

    ctx.logger.info('genome dimensions set', {
      genomeId: input.genomeId,
      modes,
      avatarEnabled,
    });

    return {
      genomeId: saved.id,
      version: saved.version,
      availableModes: modes,
      avatarEnabled,
      blockedModes,
      why: {
        summary:
          `Proof is ${input.proof_asset.join(' + ')}, they can show ${input.capture_capability.join(' + ')}, ` +
          `and they want ${input.objective}. That opens ${enabledList(modes)}.`,
        factors: [
          {
            label: 'capture capability',
            detail: `"${input.capture_capability.join(', ')}" is what decides the production mode.`,
          },
          {
            label: 'avatar default',
            detail: avatarEnabled
              ? 'Proof asset is a licensed person, so avatar formats are available.'
              : 'Avatar is off: the proof asset is not a licensed person, so cloned video would not prove anything.',
          },
          ...blockedModes.map((b) => ({ label: `${b.mode} unavailable`, detail: b.because })),
        ],
        evidence: [
          { kind: 'rule' as const, id: 'engine_spec.§1.2', note: 'Four dimensions route the engine.' },
          { kind: 'rule' as const, id: 'engine_spec.§10', note: 'Avatar defaults off unless proof asset is a person.' },
        ],
        alternatives: [],
      },
    };
  },
});

function enabledList(modes: ReturnType<typeof resolveModes>): string {
  const on = Object.entries(modes)
    .filter(([, v]) => v)
    .map(([k]) => k.replace('_', ' + '));
  return on.length ? on.join(', ') : 'no production modes yet';
}
