import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { avatarDefault } from '@sparksocial/shared/genome';

/**
 * `genome.avatar_override.set` — GAPS.md open decision #1 / `docs/STATUS.md`'s
 * "known reconciliation" #1: engine spec §10 defaults `avatar_enabled` false
 * for any genome whose proof asset is not a person, but the outcomes doc's own
 * Rule 1 says SaaS and agency genomes get avatar "for founder POV only" — a
 * deliberate exception to the default, not a different default. Until this
 * tool existed there was no way to reach that exception: `genome.dimensions.set`
 * hard-derives `avatarEnabled` from `proof_asset`/`talent_availability` and
 * nothing else has ever written `constraints.avatar_enabled` away from it.
 *
 * ── An override, not a second default ───────────────────────────────────
 *
 * This does not add a SaaS/agency branch to the derivation — `avatarDefault()`
 * (`packages/shared/src/genome.ts`) stays the one function both onboarding and
 * this tool agree on, and CLAUDE.md invariant 5 still holds: nothing here
 * reads `identity.category`. `enabled: true` is a person's explicit, reasoned
 * call for *this* genome, recorded as `constraints.avatar_override` so the Why
 * panel can say "explicitly turned on by X, because Y" rather than show a bare
 * `avatar_enabled: true` that looks like a bug next to a non-person proof
 * asset. `enabled: false` clears that override and reverts to whatever
 * `avatarDefault()` computes right now — it does not force avatar off
 * unconditionally, so un-overriding a genome whose dimensions later change to
 * a licensed person on camera does not leave it stuck off.
 *
 * ── Same gates `content.generate_avatar_video` checks before spending ────
 *
 * An override is still a claim that cloned video is safe to generate. It is
 * refused, not silently narrowed, when either underlying fact is missing:
 * nobody licensed to be filmed/cloned (`talent_availability !== 'yes_licensed'`),
 * or no active `avatar_clone` consent record. Both are exactly what
 * `content.generate_avatar_video` itself re-checks at spend time — this tool
 * front-loads the same refusal to the moment someone flips the switch, not
 * two steps later when a render fails.
 */

export const GenomeAvatarOverrideSetInput = z
  .object({
    genomeId: z.string().min(1),
    enabled: z.boolean(),
    /** Required when turning it on — the person's stated justification, shown back in `why`. */
    reason: z.string().min(10).max(500).optional(),
  })
  .refine((v) => !v.enabled || v.reason !== undefined, {
    message: 'reason is required when enabling the override.',
    path: ['reason'],
  });

export const GenomeAvatarOverrideSetOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  avatarEnabled: z.boolean(),
  override: z.object({ reason: z.string(), setBy: z.string(), setAt: z.string() }).nullable(),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export const genomeAvatarOverrideSet = defineTool({
  name: 'genome.avatar_override.set',
  version: 1,

  summary:
    'Explicitly turn avatar formats on for a genome whose proof asset is not a person (founder-POV for a ' +
    'SaaS or agency), or clear a prior override back to the plain default. Turning it on requires a licensed, ' +
    'available person and an active avatar_clone consent record — the same gates content.generate_avatar_video checks.',

  input: GenomeAvatarOverrideSetInput,
  output: GenomeAvatarOverrideSetOutput,

  effect: 'write',
  // Same reasoning as `genome.avatar_config.set`/`genome.consent.grant`: this
  // is a likeness-risk decision, never SPARK's to make unattended.
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
    }

    if (input.enabled) {
      if (genome.dimensions.talent_availability !== 'yes_licensed') {
        throw new ToolError(
          'INVALID_INPUT',
          'No licensed person is available for this genome (talent_availability is not yes_licensed) — ' +
            'there is nobody to film or clone for a founder-POV avatar.',
          { genomeId: input.genomeId, talentAvailability: genome.dimensions.talent_availability },
        );
      }

      const consented = await ctx.db.consent.hasActive(input.genomeId, ctx.orgId, 'avatar_clone');
      if (!consented) {
        throw new ToolError(
          'FORBIDDEN',
          'No active likeness-consent record for this genome. Grant one via genome.consent.grant before ' +
            'overriding avatar on.',
          { genomeId: input.genomeId },
        );
      }
    }

    const by = ctx.userId;
    if (!by) throw new ToolError('FORBIDDEN', 'An avatar override must be attributable to a person.');

    const setAt = new Date().toISOString();
    const override = input.enabled ? { reason: input.reason!, setBy: by, setAt } : null;
    const avatarEnabled = input.enabled ? true : avatarDefault(genome.dimensions);

    const saved = await ctx.db.genomes.patchConstraints({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      patch: { avatarEnabled, avatarOverride: override },
    });

    ctx.logger.info('avatar override set', { genomeId: input.genomeId, enabled: input.enabled, avatarEnabled, by });

    return {
      genomeId: saved.id,
      version: saved.version,
      avatarEnabled,
      override,
      why: {
        summary: input.enabled
          ? `Avatar explicitly turned on by ${by}: ${input.reason}`
          : `Override cleared by ${by} — avatar reverts to the derived default (${avatarEnabled ? 'on' : 'off'}).`,
        factors: [
          ...(input.enabled
            ? [
                { label: 'talent availability', detail: 'yes_licensed — a licensed person is available.' },
                { label: 'consent', detail: 'Active avatar_clone consent record on file.' },
              ]
            : [{ label: 'derived default', detail: avatarEnabled ? 'proof asset is a licensed person' : 'proof asset is not a person' }]),
        ],
        evidence: [
          { kind: 'rule' as const, id: 'outcomes.rule_1', note: 'Founder-POV avatar is opt-in for SaaS/agency, never a default.' },
        ],
        alternatives: [],
      },
    };
  },
});
