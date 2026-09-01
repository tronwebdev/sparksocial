import { z } from 'zod';
import { ToolError, Explanation as ExplanationSchema } from '@sparksocial/shared';
import { defineTool } from '@sparksocial/tools/defineTool';

/**
 * `approval.rule.*` — the "Approval flows" section of `SET-WS-TEAM-GROUPS`.
 *
 * ── Why these are not team-group capabilities ─────────────────────────────
 *
 * A group's four capabilities all **widen**: `policy.ts` consults each at the
 * one decision point it belongs to, and rule 2 refuses any tool whose own
 * `scopes` exclude the caller before a capability is ever read. That asymmetry
 * is the entire safety argument for team groups — a mistake in group
 * configuration cannot lock a workspace out of its own account.
 *
 * The design's approval flows do the opposite. *"Publishing requires Approver
 * review"* takes something away. Adding it to the capability list would have
 * been the smaller diff and would have quietly destroyed that property; the
 * first symptom would have been an owner unable to publish, and the cause would
 * have been three screens away. So a rule is its own object, in its own table,
 * read into its own policy field.
 *
 * ── What a rule can and cannot do ─────────────────────────────────────────
 *
 * It can only ask a human. `policy.ts` places these after every `deny`, so the
 * worst a misconfigured flow produces is a queue entry — never a permission
 * somebody did not have. And it is placed *before* the tool's own default, so an
 * autopublishing campaign does not skip it: a rule a campaign could switch off
 * by declaring itself autopublish would stop applying exactly when somebody
 * wanted it not to.
 */

const Trigger = z.enum(['publish', 'spend_over']);

/**
 * Who may release a hold.
 *
 * Not the full role list: `viewer` and `client` cannot approve anything —
 * offering them would create a rule that can never be satisfied, which reads as
 * a broken product rather than as a strict one. `editor` is offered because a
 * workspace may genuinely want peer review rather than seniority.
 */
const ReviewerRole = z.enum(['owner', 'admin', 'editor', 'approver']);

const RuleOut = z.object({
  id: z.string(),
  trigger: Trigger,
  thresholdCents: z.number().int().optional(),
  requiresRole: ReviewerRole,
  groupIds: z.array(z.string()),
  /** Empty when the rule applies to everyone — see `label`. */
  groupNames: z.array(z.string()),
  enabled: z.boolean(),
  /**
   * The rule as a sentence, built server-side.
   *
   * Built here rather than in the component because the same sentence has to
   * appear in the review queue's "why is this waiting" and in this list, and two
   * copies of a rule's description drift until they contradict each other about
   * what the workspace configured.
   */
  label: z.string(),
  appliesTo: z.string(),
});

/* ── approval.rule.list ─────────────────────────────────────────────────── */

export const approvalRuleList = defineTool({
  name: 'approval.rule.list',
  version: 1,

  summary:
    "This workspace's approval flows — which actions need a person to sign off, who may sign them off, " +
    'and which teams each rule applies to. Includes switched-off rules. Free, read-only.',

  input: z.object({}),
  output: z.object({ rules: z.array(RuleOut) }),

  effect: 'read',
  autonomy: 'auto',
  /**
   * Every role may read them, for the reason `brand.governance.get` gives:
   * somebody whose publish just went to a queue needs to be able to see the rule
   * that put it there, and "this needs approval" is unactionable if the rules are
   * invisible.
   */
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(_input, ctx) {
    const [rules, groups] = await Promise.all([
      ctx.db.approvalRules.list(ctx.orgId),
      ctx.db.teamGroups.list(ctx.orgId),
    ]);
    const nameOf = new Map(groups.map((g) => [g.id, g.name]));

    return {
      rules: rules.map((r) => {
        const groupNames = r.groupIds.map((id) => nameOf.get(id) ?? 'a deleted team');
        return {
          id: r.id,
          trigger: r.trigger === 'spend_over' ? ('spend_over' as const) : ('publish' as const),
          ...(r.thresholdCents === undefined ? {} : { thresholdCents: r.thresholdCents }),
          requiresRole: r.requiresRole as z.infer<typeof ReviewerRole>,
          groupIds: r.groupIds,
          groupNames,
          enabled: r.enabled,
          label: describe(r.trigger, r.thresholdCents, r.requiresRole),
          appliesTo: groupNames.length === 0 ? 'Everyone, including SPARK' : groupNames.join(', '),
        };
      }),
    };
  },
});

/* ── approval.rule.set ──────────────────────────────────────────────────── */

export const approvalRuleSet = defineTool({
  name: 'approval.rule.set',
  version: 1,

  summary:
    'Create or change an approval flow: what triggers it, who must sign off, which teams it applies to, ' +
    'and whether it is switched on. Owners and admins only.',

  input: z
    .object({
      /** Omitted creates a rule; supplied changes that one. */
      id: z.string().optional(),
      trigger: Trigger,
      /**
       * Required by `spend_over` and refused on `publish` — see the handler. In
       * cents, because the ledger is in cents and a threshold that disagreed with
       * the ledger's unit would be off by a factor of two the first time somebody
       * typed credits into it.
       */
      thresholdCents: z.number().int().min(0).optional(),
      requiresRole: ReviewerRole,
      /**
       * Empty means everyone, SPARK included. That is the design's "Applies to:
       * All Teams" and it is the case a spend rule usually wants, since
       * unattended agent spend is the spend worth holding.
       */
      groupIds: z.array(z.string()).default([]),
      enabled: z.boolean().default(true),
    }),

  output: z.object({ rule: RuleOut, why: ExplanationSchema }),

  effect: 'write',
  autonomy: 'human_only',
  /**
   * `human_only`, and owner/admin only, for the same reason `brand.governance.set`
   * is: an agent that can switch off the rule requiring its own work to be
   * reviewed is not reviewed. SPARK may read these (`approval.rule.list`) and
   * must never write one — and it gains nothing by reading them either, since a
   * rule naming groups never matches an agent turn.
   */
  scopes: ['owner', 'admin'],
  idempotent: false,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(input, ctx) {
    if (input.trigger === 'spend_over' && input.thresholdCents === undefined) {
      throw new ToolError(
        'INVALID_INPUT',
        'A spending rule needs an amount to trigger above.',
        { trigger: input.trigger },
      );
    }
    if (input.trigger === 'publish' && input.thresholdCents !== undefined) {
      /**
       * Refused rather than ignored. A threshold stored against a `publish` rule
       * would sit in the row looking like it did something, and the next person
       * to read the table would reasonably conclude that publishing under $1 is
       * exempt.
       */
      throw new ToolError(
        'INVALID_INPUT',
        'A publishing rule applies to every publish, so it takes no amount.',
        { trigger: input.trigger },
      );
    }

    if (input.groupIds.length) {
      // Checked, because a rule pointing at a deleted group silently applies to
      // nobody — which looks identical on the screen to a rule that is working.
      const groups = await ctx.db.teamGroups.list(ctx.orgId);
      const known = new Set(groups.map((g) => g.id));
      const missing = input.groupIds.filter((id) => !known.has(id));
      if (missing.length) {
        throw new ToolError('NOT_FOUND', 'One of those teams no longer exists.', { missing });
      }
    }

    const saved = await ctx.db.approvalRules.upsert({
      orgId: ctx.orgId,
      ...(input.id ? { id: input.id } : {}),
      trigger: input.trigger,
      ...(input.thresholdCents === undefined ? {} : { thresholdCents: input.thresholdCents }),
      requiresRole: input.requiresRole,
      groupIds: input.groupIds,
      enabled: input.enabled,
      ...(ctx.userId ? { createdBy: ctx.userId } : {}),
    });

    const groups = await ctx.db.teamGroups.list(ctx.orgId);
    const nameOf = new Map(groups.map((g) => [g.id, g.name]));
    const groupNames = saved.groupIds.map((id) => nameOf.get(id) ?? 'a deleted team');
    const label = describe(saved.trigger, saved.thresholdCents, saved.requiresRole);

    ctx.logger.info('approval rule set', {
      orgId: ctx.orgId,
      ruleId: saved.id,
      trigger: saved.trigger,
      enabled: saved.enabled,
    });

    return {
      rule: {
        id: saved.id,
        trigger: saved.trigger === 'spend_over' ? ('spend_over' as const) : ('publish' as const),
        ...(saved.thresholdCents === undefined ? {} : { thresholdCents: saved.thresholdCents }),
        requiresRole: saved.requiresRole as z.infer<typeof ReviewerRole>,
        groupIds: saved.groupIds,
        groupNames,
        enabled: saved.enabled,
        label,
        appliesTo: groupNames.length === 0 ? 'Everyone, including SPARK' : groupNames.join(', '),
      },
      why: {
        summary: saved.enabled
          ? `${label} ${groupNames.length === 0 ? 'for everyone, SPARK included' : `for ${groupNames.join(', ')}`}.`
          : `${label} — saved but switched off, so nothing is being held yet.`,
        factors: [
          {
            label: 'What it holds',
            detail:
              saved.trigger === 'publish'
                ? 'Every publish, whatever the campaign is set to.'
                : `Any action estimated above ${money(saved.thresholdCents ?? 0)}.`,
          },
          {
            label: 'What it cannot do',
            detail:
              'Only ask a human. A rule is checked after every refusal, so it can never permit something ' +
              'a role or a spend limit already forbids.',
          },
        ],
        evidence: [
          {
            kind: 'rule' as const,
            id: saved.trigger === 'publish' ? 'approval_rule.publish' : 'approval_rule.spend_over',
            note: 'The policy rule this configures.',
          },
        ],
        alternatives: [],
      },
    };
  },
});

/* ── approval.rule.delete ───────────────────────────────────────────────── */

export const approvalRuleDelete = defineTool({
  name: 'approval.rule.delete',
  version: 1,

  summary:
    'Remove an approval flow entirely. To stop it holding things without losing the record, switch it ' +
    'off instead. Owners and admins only.',

  input: z.object({ id: z.string() }),
  output: z.object({ deleted: z.boolean() }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: false,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(input, ctx) {
    const deleted = await ctx.db.approvalRules.remove({ orgId: ctx.orgId, id: input.id });
    if (!deleted) throw new ToolError('NOT_FOUND', 'That approval flow no longer exists.', { id: input.id });
    ctx.logger.info('approval rule deleted', { orgId: ctx.orgId, ruleId: input.id });
    return { deleted };
  },
});

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "an admin" / "a client" — the sentence reads or it does not get read. */
const article = (role: string) => ('aeiou'.includes(role[0] ?? '') ? 'an' : 'a');

/**
 * One rule as one sentence, shared by both tools and by the review queue.
 *
 * Mirrors the wording `policy.ts` puts on the decision. They are two strings and
 * they will drift if nobody says so — so: if the phrasing changes here, change
 * rule 7b's `reason` with it, because a person reading "waiting for an admin" in
 * the queue and "requires Admin approval" in settings has to be able to tell
 * they are the same rule.
 */
function describe(trigger: string, thresholdCents: number | undefined, requiresRole: string): string {
  const who = `${article(requiresRole)} ${requiresRole}`;
  return trigger === 'spend_over'
    ? `Spending over ${money(thresholdCents ?? 0)} needs ${who} to approve it`
    : `Publishing needs ${who} to review it`;
}

/** The reviewer roles, for the settings form's dropdown. */
export const APPROVAL_REVIEWER_ROLES = ReviewerRole.options;
