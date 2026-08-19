import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { ComplianceProfile } from '@sparksocial/shared/genome';

/**
 * `genome.compliance.classify` — engine spec §10's own line is blunt about
 * why this exists: *"Do not ship these verticals without this in place — we
 * would be generating liability for customers at scale."* `guard.compliance_profile`
 * (`packages/guardrails/src/compliance.ts`) has enforced forbidden phrases and
 * required disclaimers for `health`/`finance`/`legal`/`regulated_other` genomes
 * since P2 — but nothing ever set `constraints.compliance_profile` away from
 * its `'none'` default, so the guardrail has been evaluating every genome,
 * including a real clinic or law firm, as fully unregulated.
 *
 * Classification is a real, deterministic keyword match against the genome's
 * own category and one-liner — the same "real approximation, not a stub, and
 * swappable for something semantic later" posture `claimGrounding.ts` takes,
 * not a guess dressed up as certainty. Keyword lists are conservative on
 * purpose: a false negative (missing a real health business) is the
 * dangerous failure mode per the spec's own words, so terms tied specifically
 * to regulated activity are favored over broad category words a false
 * positive would come from (a gym isn't "health" in this sense; a clinic is).
 *
 * Which vertical a genome belongs to is a human's call to confirm, not
 * SPARK's to decide unreviewed — the same reasoning `genome.avatar_config.set`
 * gives for `human_only`. `overrideProfile` is the same tool's second mode:
 * once a person has actually looked, they set the final answer through this
 * one call rather than a second, near-duplicate tool.
 *
 * ── Why this reads `identity.category`, when CLAUDE.md invariant 5 says never ──
 *
 * `GenomeIdentity.category`'s own comment says "never branch on it — routing
 * is by dimensions." That rule guards *engine* routing — which playbook
 * resolves, what the mix engine weights — against being hardcoded per niche,
 * an open-ended, ever-growing list where a missed case silently breaks for
 * one specific business (`if (category === 'barbershop')`). This tool does
 * neither: it is `human_only` (a person explicitly runs it, SPARK never
 * decides this unreviewed), it writes a constraint a guardrail reads, not a
 * playbook or mix decision, and `ComplianceProfile` is a small, closed,
 * externally-defined regulatory taxonomy (four values, set by law, not by
 * how many niches this product supports) — not a niche list. `dimensions`
 * has no axis for regulatory vertical at all, so category is the only signal
 * available; the `why` output exists so a person can see and correct a wrong
 * match rather than trust it silently, which is the actual protection
 * invariant 5 is after.
 */

// Order matters: checked in sequence, first match wins. `regulated_other`
// goes first because its own vocabulary ("medical cannabis", "medical
// marijuana") legitimately contains `health`'s "medical" as a qualifier —
// putting `health` first would misclassify a dispensary as a clinic. The
// remaining three don't meaningfully overlap with each other.
const KEYWORD_PROFILES: Array<{ profile: Exclude<ComplianceProfile, 'none'>; pattern: RegExp }> = [
  {
    profile: 'regulated_other',
    pattern: /\b(cannabis|dispensary|\bcbd\b|tobacco|vape|vaping|alcohol|distillery|brewery|gambling|casino|sportsbook|firearms?|gun (?:shop|store|dealer))\b/i,
  },
  {
    profile: 'health',
    pattern: /\b(clinic|medical|medicine|physician|doctor|dentist|dental|pharma|pharmacy|therapist|therapy|diagnos|treatment|healthcare|telehealth|nurse|surgeon)\b/i,
  },
  {
    profile: 'finance',
    pattern: /\b(financial advis|investment|invest(?:ing|ment)?|lending|loan|mortgage|bank(?:ing)?|insurance|wealth management|crypto(?:currency)?|trading platform|broker(?:age)?|credit union)\b/i,
  },
  {
    profile: 'legal',
    pattern: /\b(law firm|attorney|lawyer|legal (?:advice|services|counsel)|paralegal|litigation)\b/i,
  },
];

export const GenomeComplianceClassifyInput = z.object({
  genomeId: z.string().min(1),
  /** A person's final call, once they've actually looked — skips classification and writes this directly. */
  overrideProfile: ComplianceProfile.optional(),
});

export const GenomeComplianceClassifyOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  complianceProfile: ComplianceProfile,
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export const genomeComplianceClassify = defineTool({
  name: 'genome.compliance.classify',
  version: 1,

  summary:
    'Classify a genome into a compliance profile (health/finance/legal/regulated_other/none) from its category and one-liner, ' +
    'so guard.compliance_profile actually enforces forbidden phrases and required disclaimers for regulated verticals instead of ' +
    "treating every genome as unregulated. Pass overrideProfile once a person has confirmed the vertical themselves.",

  input: GenomeComplianceClassifyInput,
  output: GenomeComplianceClassifyOutput,

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
    }

    let profile: ComplianceProfile;
    let why: z.infer<typeof GenomeComplianceClassifyOutput>['why'];

    if (input.overrideProfile) {
      profile = input.overrideProfile;
      why = {
        summary: `Set to "${profile}" by explicit override, not classified.`,
        factors: [{ label: 'override', detail: 'A person set this directly rather than accepting the keyword match.' }],
        evidence: [],
        alternatives: [],
      };
    } else {
      const haystack = `${genome.identity.category} ${genome.identity.one_liner}`;
      const match = KEYWORD_PROFILES.find((k) => k.pattern.test(haystack));
      profile = match?.profile ?? 'none';
      why = {
        summary: match
          ? `"${genome.identity.category}" matches ${match.profile} — forbidden phrases and required disclaimers now apply.`
          : `No regulated-vertical keyword matched "${genome.identity.category}" — left at "none". A person should confirm this is right, not just accept the default.`,
        factors: [
          { label: 'category', detail: genome.identity.category },
          { label: 'one_liner', detail: genome.identity.one_liner },
          ...(match ? [{ label: 'matched_pattern', detail: match.pattern.source }] : []),
        ],
        evidence: [
          {
            kind: 'rule' as const,
            id: 'engine_spec.§10',
            note: 'Regulated verticals must not ship without forbidden-phrase/disclaimer enforcement.',
          },
        ],
        alternatives: [],
      };
    }

    const saved = await ctx.db.genomes.patchConstraints({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      patch: { complianceProfile: profile },
    });

    ctx.logger.info('genome compliance classified', { genomeId: input.genomeId, complianceProfile: profile, override: !!input.overrideProfile });

    return { genomeId: saved.id, version: saved.version, complianceProfile: profile, why };
  },
});
