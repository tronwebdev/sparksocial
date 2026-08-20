import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import type { OrgSettingsRecord } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `org.*` — organisation-level governance, billing, and audit (plan §6.9,
 * §12 P6). Org *identity* is Clerk's: a workspace is created through Clerk's
 * own UI/API, and `ctx.orgId` always names the org the caller's session is
 * actually in — no tool here can create a session's organisation for it, or
 * touch a different one than the caller's own. What these tools own is this
 * app's *own* tenant record for that org: plan tier, default governance,
 * SSO policy, spend cap, and the audit trail.
 */

export const Plan = z.enum(['starter', 'growth', 'agency']);
export type Plan = z.infer<typeof Plan>;

/** Real, defensible starting caps per tier — not a placeholder. Changeable later without a schema change; this is the only place the mapping lives. */
const PLAN_CAPS_CENTS: Record<Plan, number> = {
  starter: 500_00,
  growth: 2_000_00,
  agency: 10_000_00,
};

const OrgSettingsOut = z.object({
  plan: Plan,
  defaultApprovalMode: z.string(),
  ssoRequired: z.boolean(),
  twoFactorRequired: z.boolean(),
  dataResidency: z.string(),
  /** Null rather than absent on the wire — "keep indefinitely" is a state the
   *  UI has to render, and an omitted key is indistinguishable from a field the
   *  client is too old to know about. */
  retentionDays: z.number().nullable(),
  monthlyCapCents: z.number(),
  updatedAt: z.string(),
});

function shape(s: OrgSettingsRecord) {
  return {
    plan: s.plan as Plan,
    defaultApprovalMode: s.defaultApprovalMode,
    ssoRequired: s.ssoRequired,
    twoFactorRequired: s.twoFactorRequired,
    dataResidency: s.dataResidency,
    retentionDays: s.retentionDays ?? null,
    monthlyCapCents: s.monthlyCapCents,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/* ── org.create ──────────────────────────────────────────────────────── */

export const orgCreate = defineTool({
  name: 'org.create',
  version: 1,

  summary:
    "Provision this app's own settings/billing record for the caller's org — first-run setup for a " +
    "workspace that already exists in Clerk. Idempotent: safe to call again — an omitted plan reads the " +
    'current settings (creating the row on first touch, same upsert-on-read shape as brands.get) rather ' +
    "than resetting an already-configured org back to Starter. This also makes it the Agency Portal's own " +
    "read for \"what plan is this org on\", since no separate org.settings.get exists.",

  input: z.object({ plan: Plan.optional() }),
  output: OrgSettingsOut,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    // Only a caller-supplied plan writes anything. Omitting it is a pure
    // read (`orgSettings.get`'s own upsert-on-first-touch), which is what
    // makes a *second* call with no plan safe — the bug this replaced always
    // wrote `plan: 'starter'` by default, silently demoting an org that had
    // already chosen Growth or Agency.
    const settings = input.plan
      ? await ctx.db.orgSettings.setPlan({ orgId: ctx.orgId, plan: input.plan, monthlyCapCents: PLAN_CAPS_CENTS[input.plan] })
      : await ctx.db.orgSettings.get(ctx.orgId);
    ctx.logger.info('org provisioned', { orgId: ctx.orgId, plan: settings.plan });
    return shape(settings);
  },
});

/* ── org.governance.set ──────────────────────────────────────────────── */

export const orgGovernanceSet = defineTool({
  name: 'org.governance.set',
  version: 1,
  summary:
    "Org-wide governance: the approval mode new brands start on, whether 2FA is required, where data " +
    'must live, and how long it is kept. A partial patch — omitted fields are left alone.',
  input: z
    .object({
      /** Existing brands keep whatever they already have; this is the default new ones start on. */
      defaultApprovalMode: z.enum(['autopublish', 'review_first_week', 'review_everything']).optional(),
      /** §8.12's "security (SSO/2FA)" — the half SSO did not cover. */
      twoFactorRequired: z.boolean().optional(),
      /**
       * §8.12's data residency. Records the *commitment*, and deliberately does
       * not claim to enforce it: enforcement means provisioning storage in the
       * region, which is an infrastructure decision (CLAUDE.md's Azure section)
       * rather than a column. A tool that silently implied otherwise would be
       * worse than no tool.
       */
      dataResidency: z.enum(['any', 'eu', 'us', 'uk']).optional(),
      /**
       * §8.12's retention policy, in days. `null` clears it back to keeping data
       * indefinitely, which is the default and the current behaviour of every
       * existing org — nothing here deletes anything on its own, and the job
       * that eventually does must be a separate, explicit tool.
       */
      retentionDays: z.number().int().min(30).max(3650).nullable().optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      message: 'Set at least one governance field.',
    }),
  output: OrgSettingsOut,
  effect: 'write',
  /**
   * Human-only, where it used to be `auto`. When this tool only carried the
   * default approval mode that was arguable; now that it carries 2FA,
   * residency and retention, an agent that could call it could lower the org's
   * own security posture or set a retention floor that deletes a brand's
   * history — the class of change a person has to make deliberately.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  async handler(input, ctx) {
    const settings = await ctx.db.orgSettings.setGovernance({
      orgId: ctx.orgId,
      ...(input.defaultApprovalMode !== undefined ? { defaultApprovalMode: input.defaultApprovalMode } : {}),
      ...(input.twoFactorRequired !== undefined ? { twoFactorRequired: input.twoFactorRequired } : {}),
      ...(input.dataResidency !== undefined ? { dataResidency: input.dataResidency } : {}),
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
    });
    ctx.logger.info('org governance set', {
      orgId: ctx.orgId,
      changed: Object.keys(input),
      by: ctx.userId ?? 'unknown',
    });
    return shape(settings);
  },
});

/* ── org.billing.plan.set ────────────────────────────────────────────── */

export const orgBillingPlanSet = defineTool({
  name: 'org.billing.plan.set',
  version: 1,
  summary: "Change the org's plan tier. Moves the monthly spend cap policy.ts rule 4 enforces to match the new tier — not just a label.",
  input: z.object({ plan: Plan }),
  output: OrgSettingsOut,
  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner'],
  idempotent: true,
  async handler(input, ctx) {
    const settings = await ctx.db.orgSettings.setPlan({ orgId: ctx.orgId, plan: input.plan, monthlyCapCents: PLAN_CAPS_CENTS[input.plan] });
    ctx.logger.info('org plan changed', { orgId: ctx.orgId, plan: input.plan, monthlyCapCents: PLAN_CAPS_CENTS[input.plan] });
    return shape(settings);
  },
});

/* ── org.security.sso.configure ──────────────────────────────────────── */

export const orgSecuritySsoConfigure = defineTool({
  name: 'org.security.sso.configure',
  version: 1,

  summary:
    'Declare whether this org requires SSO. This is a policy flag this app can read and surface — it ' +
    "does not, and cannot, provision a SAML/OIDC connection itself: that's a Clerk dashboard action " +
    '(Clerk → SSO Connections), the same as the org\'s custom roles and social providers.',

  input: z.object({ required: z.boolean() }),
  output: OrgSettingsOut,
  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner'],
  idempotent: true,
  async handler(input, ctx) {
    const settings = await ctx.db.orgSettings.setSso({ orgId: ctx.orgId, required: input.required });
    return shape(settings);
  },
});

/* ── org.credits.grant ───────────────────────────────────────────────── */

export interface OrgCreditsDeps {
  grant(entry: { orgId: string; brandId?: string; amountCents: number; reason: string }): Promise<void>;
  budget(orgId: string, now: Date): Promise<{ monthlyCapCents: number; spentCents: number }>;
}

export function makeOrgCreditsGrant(deps: OrgCreditsDeps) {
  return defineTool({
    name: 'org.credits.grant',
    version: 1,

    summary:
      'Grant a one-off credit (goodwill, a plan adjustment) to the org\'s spend ledger. Deliberately not ' +
      'reachable through ctx.db — CreditStore is kept off the handler surface everywhere else in the ' +
      'registry, and this tool is the one narrow, explicitly-injected exception, gated to owner only.',

    input: z.object({ amountCents: z.number().int().positive().max(1_000_000), reason: z.string().min(1).max(280), brandId: z.string().optional() }),
    output: z.object({ granted: z.literal(true), balance: z.object({ monthlyCapCents: z.number(), spentCents: z.number() }) }),

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner'],
    // A retried grant must not double the credit — this is money.
    idempotent: false,

    async handler(input, ctx) {
      await deps.grant({ orgId: ctx.orgId, amountCents: input.amountCents, reason: input.reason, ...(input.brandId ? { brandId: input.brandId } : {}) });
      const balance = await deps.budget(ctx.orgId, new Date());
      ctx.logger.info('credits granted', { orgId: ctx.orgId, amountCents: input.amountCents, reason: input.reason });
      return { granted: true as const, balance };
    },
  });
}

/* ── org.audit.query ─────────────────────────────────────────────────── */

export const orgAuditQuery = defineTool({
  name: 'org.audit.query',
  version: 1,

  summary:
    'Every tool call across the whole org, newest first — the compliance sweep. Same "projection, never ' +
    'the row" rule as agent.explain: tool inputs/outputs are never returned, only what happened and why ' +
    'it was allowed or refused.',

  input: z.object({
    tool: z.string().optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: z.object({
    calls: z.array(
      z.object({
        id: z.string(),
        tool: z.string(),
        caller: z.enum(['user', 'agent']),
        decision: z.string(),
        status: z.string(),
        costCents: z.number(),
        at: z.string(),
        ruleId: z.string().optional(),
        reason: z.string().optional(),
      }),
    ),
  }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    if (!input.tool && input.limit > 200) {
      // An unbounded org-wide sweep is the one shape worth a soft guard —
      // everything else about this tool is a normal scoped read.
      throw new ToolError('INVALID_INPUT', 'Narrow with a tool name or a smaller limit for a sweep this wide.', { limit: input.limit });
    }
    const rows = await ctx.db.toolCalls.list(ctx.orgId, {
      ...(input.tool ? { tool: input.tool } : {}),
      ...(input.since ? { since: new Date(input.since) } : {}),
      ...(input.until ? { until: new Date(input.until) } : {}),
      limit: input.limit,
    });
    return {
      calls: rows.map((r) => ({
        id: r.id,
        tool: r.tool,
        caller: r.caller,
        decision: r.decision,
        status: r.status,
        costCents: r.costCents,
        at: r.at.toISOString(),
        ...(r.ruleId ? { ruleId: r.ruleId } : {}),
        ...(r.reason ? { reason: r.reason } : {}),
      })),
    };
  },
});
