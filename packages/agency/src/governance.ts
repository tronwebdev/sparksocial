import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { DEFAULT_POSTING_WINDOWS, Explanation, ToolError } from '@sparksocial/shared';

/**
 * `brand.governance.get` / `.set` — PRD §8.2 (`ONB-03`), §8.12 (`SET-WS-01`), §9.
 *
 * ── What was missing ───────────────────────────────────────────────────────
 *
 * The PRD names "restricted topics", "claims to avoid", "voice sliders",
 * "strict mode", the brand kit and the timezone across five sections and makes
 * the timezone a *required* onboarding field. None of it existed anywhere:
 * `brand.settings.patch` renamed a brand and that was the entirety of brand
 * configuration. Consequences, all of them stated requirements:
 *
 *   - §9's "guardrails enforcement" had nothing to enforce. Compliance was a
 *     phrase list hardcoded per vertical, with no per-brand input at all.
 *   - §8.6's "Apply Brand Kit" toggle had no kit to apply.
 *   - The mitigation the PRD's own §10 gives for its first-listed risk
 *     ("wrong or off-brand autoposting") was unimplementable, not merely
 *     unimplemented.
 *   - Every post fired at whatever instant its campaign was created, in UTC,
 *     because nothing in the system knew what time it was where the brand is.
 *
 * ── Why this is separate from `approval.policy.set` ────────────────────────
 *
 * That tool answers "who has to sign this off" and belongs to an operator.
 * This answers "what may we say, and when do we say it", is captured during
 * onboarding, and is the brand's own statement about itself. One tool owning
 * both would mean one screen owning both, and a partial patch from either able
 * to clear the other's fields. See `BrandGovernanceStore.setGovernance`.
 *
 * ── Why `write` and not `destructive` ──────────────────────────────────────
 *
 * Tightening these is always safe and loosening them is the reviewable act —
 * but `effect: 'destructive'` would route *every* edit to approval, including
 * the onboarding write that first sets the timezone, which would leave a new
 * brand unable to finish setup without a second person. The audit row records
 * every change with its `before`, which is the control that actually matters
 * here: `agent.explain` can answer "who turned strict mode off, and when".
 */

/** Same message shape `approval.policy.*` gives, for the same situation. */
function requireBrand(brandId: string | undefined): string {
  if (!brandId) {
    throw new ToolError('INVALID_INPUT', 'A brand must be selected to read or change its governance.');
  }
  return brandId;
}

const ToneVector = z.object({
  formal: z.number().min(0).max(1),
  playful: z.number().min(0).max(1),
  technical: z.number().min(0).max(1),
  bold: z.number().min(0).max(1),
});

/**
 * A `null` clears a field; an absent key leaves it untouched. The distinction is
 * the whole reason this is a patch rather than a replace — onboarding sets the
 * timezone, the settings screen sets the restricted topics, and neither may
 * silently wipe the other's work.
 */
export const BrandGovernanceSetInput = z.object({
  /**
   * Optional, defaulting to the brand on the session — the same contract
   * `approval.policy.set` uses. A settings screen already has a brand selected
   * and should not have to say so twice; an agency operator scripting across
   * clients can still name one explicitly.
   */
  brandId: z.string().min(1).optional(),
  restrictedTopics: z.array(z.string().min(1).max(120)).max(100).nullable().optional(),
  claimsToAvoid: z.array(z.string().min(1).max(120)).max(100).nullable().optional(),
  strictMode: z.boolean().optional(),
  toneVector: ToneVector.nullable().optional(),
  bannedPhrases: z.array(z.string().min(1).max(120)).max(200).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  brandColors: z.array(z.string().min(3).max(32)).max(12).nullable().optional(),
  /**
   * An IANA zone name, validated against the runtime's own zone database rather
   * than a hand-maintained list — a rejected zone here would silently push
   * every post back to UTC, so the check has to be the real one.
   */
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isKnownTimeZone, { message: 'Not a recognised IANA timezone, e.g. "Europe/London".' })
    .optional(),
  postingWindows: z.array(z.number().int().min(0).max(23)).max(12).nullable().optional(),
  /**
   * PRD §8.8's engagement autonomy level. `off` means SPARK drafts a reply and a
   * person sends it; `suggest` and `auto` both count as *configured*, which is
   * what `policy.ts` rule 6 asks about — the difference between them is how far
   * `engage.autohandle` gets, not whether the family is gated.
   */
  engagementAutonomy: z.enum(['off', 'suggest', 'auto']).optional(),
  /** comment | dm | story_reply. Null clears back to "all of them". */
  engagementTypes: z.array(z.enum(['comment', 'dm', 'story_reply'])).max(3).nullable().optional(),
});

export const BrandGovernanceOutput = z.object({
  brandId: z.string(),
  restrictedTopics: z.array(z.string()),
  claimsToAvoid: z.array(z.string()),
  strictMode: z.boolean(),
  toneVector: ToneVector.optional(),
  bannedPhrases: z.array(z.string()),
  logoUrl: z.string().optional(),
  brandColors: z.array(z.string()),
  timezone: z.string(),
  /** Always populated — the effective windows, including the default when none are set. */
  postingWindows: z.array(z.number()),
  /** True when `postingWindows` is the system default rather than this brand's own choice. */
  usingDefaultWindows: z.boolean(),
  engagementAutonomy: z.enum(['off', 'suggest', 'auto']),
  engagementTypes: z.array(z.string()),
  why: Explanation,
});

export const brandGovernanceGet = defineTool({
  name: 'brand.governance.get',
  version: 1,

  summary:
    "This brand's own rules: restricted topics, claims to avoid, strict mode, voice sliders, brand kit, " +
    'timezone and posting windows. Free, read-only.',

  input: z.object({ brandId: z.string().min(1).optional() }),
  output: BrandGovernanceOutput,

  effect: 'read',
  autonomy: 'auto',
  // Every role may read the rules they are working under. Editors in particular
  // need to: a draft rejected for a restricted topic is unfixable by someone who
  // cannot see the list.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['ONB-03', 'SET-WS-01'],

  async handler(input, ctx) {
    const gov = await ctx.db.brands.get(requireBrand(input.brandId ?? ctx.brandId), ctx.orgId);
    return toOutput(gov);
  },
});

export const brandGovernanceSet = defineTool({
  name: 'brand.governance.set',
  version: 1,

  summary:
    "Set this brand's own rules — restricted topics, claims to avoid, strict compliance mode, voice " +
    'sliders, banned phrases, logo/colours, timezone and posting windows. A partial patch: omitted ' +
    'fields are left alone, null clears one. Free.',

  input: BrandGovernanceSetInput,
  output: BrandGovernanceOutput,

  effect: 'write',
  /**
   * `human_only`. SPARK may read every one of these fields and must never write
   * one: an agent that can edit its own restricted-topic list is not restricted,
   * and an agent that can widen its own posting windows is not on a cadence. The
   * asymmetry is the point — this is the one place in the registry where the
   * *owner* constrains the agent, so the agent is not a party to it.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['ONB-03', 'SET-WS-01'],

  async handler(input, ctx) {
    const { brandId: named, ...patch } = input;
    const brandId = requireBrand(named ?? ctx.brandId);
    const before = await ctx.db.brands.get(brandId, ctx.orgId);
    const after = await ctx.db.brands.setGovernance({ brandId, orgId: ctx.orgId, patch });

    const changed = Object.keys(patch).filter((k) => k in patch);
    ctx.logger.info('brand governance set', { brandId, changed, by: ctx.userId ?? 'unknown' });

    const out = toOutput(after);
    return {
      ...out,
      why: {
        summary: changed.length
          ? `Updated ${changed.join(', ')} for this brand.`
          : 'Nothing was changed — the patch was empty.',
        factors: [
          { label: 'strict mode', detail: after.strictMode ? 'on — restricted topics block' : 'off — restricted topics flag' },
          { label: 'timezone', detail: after.timezone },
          {
            label: 'engagement',
            detail:
              after.engagementAutonomy === 'off'
                ? 'off — SPARK drafts, a person sends'
                : `${after.engagementAutonomy} — replies are gated by eligibility as well`,
          },
          {
            label: 'restricted topics',
            detail: `${after.restrictedTopics?.length ?? 0} topic(s), ${after.claimsToAvoid?.length ?? 0} claim(s)`,
          },
        ],
        // The prior values, so the audit row answers "what did this change
        // from" without a second read. `agent.explain` renders it.
        evidence: [
          {
            kind: 'rule' as const,
            id: 'previous',
            note: `strictMode=${before.strictMode}, timezone=${before.timezone}, topics=${before.restrictedTopics?.length ?? 0}`,
          },
        ],
        alternatives: [],
      },
    };
  },
});

function toOutput(gov: {
  brandId: string;
  restrictedTopics?: string[];
  claimsToAvoid?: string[];
  strictMode: boolean;
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  bannedPhrases?: string[];
  logoUrl?: string;
  brandColors?: string[];
  timezone: string;
  postingWindows?: number[];
  engagementAutonomy: 'off' | 'suggest' | 'auto';
  engagementTypes?: string[];
}) {
  const own = gov.postingWindows?.length ? gov.postingWindows : undefined;
  return {
    brandId: gov.brandId,
    restrictedTopics: gov.restrictedTopics ?? [],
    claimsToAvoid: gov.claimsToAvoid ?? [],
    strictMode: gov.strictMode,
    ...(gov.toneVector ? { toneVector: gov.toneVector } : {}),
    bannedPhrases: gov.bannedPhrases ?? [],
    ...(gov.logoUrl ? { logoUrl: gov.logoUrl } : {}),
    brandColors: gov.brandColors ?? [],
    timezone: gov.timezone,
    // Resolved, not raw: a caller rendering "posts go out at…" must show the
    // times that will actually be used, and a brand that has set nothing still
    // has effective windows.
    postingWindows: own ?? [...DEFAULT_POSTING_WINDOWS],
    usingDefaultWindows: own === undefined,
    engagementAutonomy: gov.engagementAutonomy,
    engagementTypes: gov.engagementTypes ?? [],
    why: {
      summary: 'The rules this brand publishes under.',
      factors: [],
      evidence: [],
      alternatives: [],
    },
  };
}

/** Asks the runtime's own IANA database, so the check cannot drift from reality. */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
