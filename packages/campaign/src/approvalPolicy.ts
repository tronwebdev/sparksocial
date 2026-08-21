import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError, Autonomy, Role } from '@sparksocial/shared';

/**
 * `approval.policy.*` — the fine-grained escalation rules `policy.ts` (§9)
 * has read since P1 and nothing ever wrote.
 *
 * `agent.approval_mode.*` (`approval.ts`) controls the fixed three-rung ladder
 * (autopublish / review_first_week / review_everything) — a whole-brand
 * setting. `evaluate()` reads five narrower fields on top of that ladder:
 * `familyOverrides` (per tool-family autonomy), `restrictedPlatforms` /
 * `restrictedContentTypes` (force approval for specific publish targets),
 * `quietWindows` (freeze publishing entirely for a span), and `permissions`
 * (spend/automation toggles). Every branch reading them has existed since P1,
 * unit-tested by building a `PolicyInput` directly — but `makeBrandGovernance`
 * only ever forwarded `approvalMode`/`agentPaused`, so in production these
 * fields were permanently `undefined` and the branches were dead code. This
 * pair is the write side, plus the loader fix in `dev-auth.ts` that makes the
 * policy engine actually see what gets set here.
 */

const FamilyOverrides = z.record(z.string(), Autonomy);
const QuietWindow = z
  .object({ from: z.string().datetime(), to: z.string().datetime(), reason: z.string().min(1).max(280) })
  .refine((w) => new Date(w.to).getTime() > new Date(w.from).getTime(), {
    message: '"to" must be after "from".',
    path: ['to'],
  });
const Permissions = z.object({
  spendCredits: z.boolean().optional(),
  automationAutoPublish: z.boolean().optional(),
  /**
   * PRD §6's "Approval required for media generation (optional)" — the one of
   * the five permission controls that had no representation anywhere, and the
   * one guarding the expensive calls (`content.generate_avatar_video` is 50¢,
   * `content.generate_dub` 60¢).
   */
  requireApprovalForMedia: z.boolean().optional(),
});

const PolicyOutput = z.object({
  brandId: z.string(),
  familyOverrides: FamilyOverrides.nullable(),
  restrictedPlatforms: z.array(z.string()).nullable(),
  restrictedContentTypes: z.array(z.string()).nullable(),
  quietWindows: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })).nullable(),
  permissions: Permissions.nullable(),
  publishRoles: z.array(Role).nullable(),
  maxPendingReview: z.number().int().nullable(),
});

function shape(brandId: string, g: {
  familyOverrides?: Partial<Record<string, Autonomy>>;
  restrictedPlatforms?: string[];
  restrictedContentTypes?: string[];
  quietWindows?: Array<{ from: Date; to: Date; reason: string }>;
  permissions?: { spendCredits?: boolean; automationAutoPublish?: boolean; requireApprovalForMedia?: boolean };
  publishRoles?: Role[];
  maxPendingReview?: number;
}): z.infer<typeof PolicyOutput> {
  return {
    brandId,
    // `Partial<Record<...>>` (the domain type — a map that may omit keys) vs.
    // `Record<...>` (`z.record`'s inferred type, which cannot express a
    // partial map) is a TS-only mismatch: every value actually present is a
    // real `Autonomy`, never `undefined`, so this is a safe narrowing.
    familyOverrides: (g.familyOverrides as Record<string, Autonomy> | undefined) ?? null,
    restrictedPlatforms: g.restrictedPlatforms ?? null,
    restrictedContentTypes: g.restrictedContentTypes ?? null,
    quietWindows: g.quietWindows ? g.quietWindows.map((w) => ({ from: w.from.toISOString(), to: w.to.toISOString(), reason: w.reason })) : null,
    permissions: g.permissions ?? null,
    publishRoles: g.publishRoles ?? null,
    maxPendingReview: g.maxPendingReview ?? null,
  };
}

function requireBrand(brandId: string | undefined): string {
  if (!brandId) throw new ToolError('INVALID_INPUT', 'A brand must be selected to read or change approval policy.');
  return brandId;
}

/* ── approval.policy.get ─────────────────────────────────────────────── */

export const approvalPolicyGet = defineTool({
  name: 'approval.policy.get',
  version: 1,

  summary: 'Read this brand’s escalation policy — family autonomy overrides, restricted platforms/content types, quiet windows, permission toggles. Free.',

  input: z.object({}),
  output: PolicyOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(_input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const g = await ctx.db.brands.get(brandId, ctx.orgId);
    return shape(brandId, g);
  },
});

/* ── approval.policy.set ─────────────────────────────────────────────── */

export const ApprovalPolicySetInput = z
  .object({
    familyOverrides: FamilyOverrides.nullable().optional(),
    restrictedPlatforms: z.array(z.string()).nullable().optional(),
    restrictedContentTypes: z.array(z.string()).nullable().optional(),
    /** §6's "Publish permission (per role)". Narrows a publish tool's scopes; never widens them. */
    publishRoles: z.array(Role).max(6).nullable().optional(),
    /** §10's queue cap — how much unreviewed work may pile up before SPARK stops adding. */
    maxPendingReview: z.number().int().min(1).max(500).nullable().optional(),
    quietWindows: z.array(QuietWindow).nullable().optional(),
    permissions: Permissions.nullable().optional(),
  })
  .refine(
    (v) =>
      v.familyOverrides !== undefined ||
      v.restrictedPlatforms !== undefined ||
      v.restrictedContentTypes !== undefined ||
      v.publishRoles !== undefined ||
      v.maxPendingReview !== undefined ||
      v.quietWindows !== undefined ||
      v.permissions !== undefined,
    { message: 'Provide at least one field to change.' },
  );

export const approvalPolicySet = defineTool({
  name: 'approval.policy.set',
  version: 1,

  summary:
    'Configure this brand’s finer-grained escalation policy on top of the three-rung approval mode — per-family ' +
    'autonomy overrides, platforms/content types that always require review, publishing freeze windows, and ' +
    'spend/automation permission toggles. Pass null to clear a field back to "no override"; omit a field to leave it untouched.',

  input: ApprovalPolicySetInput,
  output: z.object({ brandId: z.string(), policy: PolicyOutput, why: Explanation }),

  effect: 'write',
  // Same rung as `agent.approval_mode.set`: lowering or raising what stands
  // between the agent and a public feed is an owner/admin call, not an
  // editor's — and never SPARK's own, since a caller-agent that could widen
  // its own restrictions would be proposing its own leash.
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['CMP-01.5'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);

    const patch = {
      ...(input.familyOverrides !== undefined ? { familyOverrides: input.familyOverrides } : {}),
      ...(input.restrictedPlatforms !== undefined ? { restrictedPlatforms: input.restrictedPlatforms } : {}),
      ...(input.restrictedContentTypes !== undefined ? { restrictedContentTypes: input.restrictedContentTypes } : {}),
      ...(input.publishRoles !== undefined ? { publishRoles: input.publishRoles } : {}),
      ...(input.maxPendingReview !== undefined ? { maxPendingReview: input.maxPendingReview } : {}),
      ...(input.quietWindows !== undefined
        ? { quietWindows: input.quietWindows ? input.quietWindows.map((w) => ({ from: new Date(w.from), to: new Date(w.to), reason: w.reason })) : null }
        : {}),
      ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
    };

    const g = await ctx.db.brands.setPolicy({ brandId, orgId: ctx.orgId, patch });

    ctx.logger.info('approval policy set', { brandId, changed: Object.keys(patch) });

    const policy = shape(brandId, g);
    return {
      brandId,
      policy,
      why: {
        summary: `Updated ${Object.keys(patch).join(', ')} for this brand's escalation policy.`,
        factors: Object.keys(patch).map((k) => ({ label: k, detail: 'applies to every call from now on, not ones already in flight' })),
        evidence: [{ kind: 'rule' as const, id: 'policy.ts §9', note: 'enforced in the policy engine, not in the UI' }],
        alternatives: [],
      },
    };
  },
});
