import { ROLE_RANK, type Role, type Effect, type Autonomy } from '@sparksocial/shared/types';
import { toolFamily } from './defineTool.js';

/**
 * THE AUTONOMY POLICY ENGINE.
 *
 * Pure function. No I/O, no globals, no clock reads (time is passed in).
 * Every autonomy decision in the product resolves here and nowhere else.
 * Unit-tested to 100% branch coverage — see policy.test.ts.
 *
 * PRD §7.1: autopublish is ON by default for active campaigns.
 * PRD §9:   approvals are an optional control layer, enableable globally, per campaign,
 *           per content type/platform, or triggered by guardrail flags.
 */

export type Decision =
  | { kind: 'allow' }
  | { kind: 'confirm'; reason: string; ruleId: string }
  | { kind: 'approval'; reason: string; ruleId: string }
  | { kind: 'deny'; reason: string; ruleId: string };

export interface PolicyInput {
  tool: { name: string; effect: Effect; autonomy: Autonomy; scopes: Role[] };
  caller: 'user' | 'agent';
  role: Role;
  now: Date;

  brand: {
    createdAt: Date;
    approvalMode: 'autopublish' | 'review_first_week' | 'review_everything';
    /** Per-family overrides set in workspace settings. */
    familyOverrides?: Partial<Record<string, Autonomy>>;
    /** PRD §9: restrict autopublish by content type / platform. */
    restrictedPlatforms?: string[];
    restrictedContentTypes?: string[];
    /** Publishing freeze windows — crisis pause, holiday, etc. */
    quietWindows?: Array<{ from: Date; to: Date; reason: string }>;
    agentPaused?: boolean;
    /** Permission toggles (PRD §6). */
    permissions?: { spendCredits?: boolean; automationAutoPublish?: boolean };
  };

  /** Populated for publish-effect calls. */
  subject?: {
    platform?: string;
    contentType?: string;
    guardrailFlags?: string[];
    isAutomationOutput?: boolean;
    reviewBeforePublish?: boolean;
  };

  budget: { remainingCents: number; estimatedCents: number };

  /** Engagement replies are gated until the campaign clears the eligibility rule. */
  engagement?: { eligible: boolean; autonomyConfigured: boolean };

  /**
   * A human approval already granted for this exact call, replayed by
   * `approval.decide`.
   *
   * It is applied at the very end of `evaluate`, as a post-filter that can only
   * turn `approval` into `allow`. It is deliberately not consulted anywhere
   * earlier: `deny` outcomes — a paused agent, a role that lacks the scope, an
   * exhausted budget, a quiet window — are not things a reviewer is being asked
   * to override, and a grant that could reach them would turn "approve this
   * post" into "approve this post and also bypass every other rule".
   */
  approval?: { grantedBy: string; grantedAt: Date };
}

const REVIEW_FIRST_WEEK_DAYS = 7;

const daysBetween = (a: Date, b: Date) =>
  Math.floor((a.getTime() - b.getTime()) / 86_400_000);

const inWindow = (now: Date, w: { from: Date; to: Date }) =>
  now >= w.from && now <= w.to;

/**
 * The policy engine's entry point (CLAUDE.md invariant 3).
 *
 * Deliberately a thin wrapper over {@link evaluateRules} rather than a check
 * spliced into the rule body. The rules stay exactly as they were, and the one
 * thing an approval grant is allowed to do — turn `approval` into `allow` — is
 * visible in three lines instead of being distributed across eight rules that
 * each have to remember it.
 *
 * The narrowing is the point. `deny` and `confirm` fall through untouched, so a
 * reviewer approving a post cannot also be approving a paused agent, a missing
 * role scope, or an exhausted budget.
 */
export function evaluate(input: PolicyInput): Decision {
  const decision = evaluateRules(input);

  if (decision.kind === 'approval' && input.approval) {
    return { kind: 'allow' };
  }
  return decision;
}

function evaluateRules(input: PolicyInput): Decision {
  const { tool, caller, role, now, brand, subject, budget, engagement } = input;
  const family = toolFamily(tool.name);

  /* 1 ── Kill switch. Beats everything except reads. */
  if (brand.agentPaused && caller === 'agent' && tool.effect !== 'read') {
    return { kind: 'deny', reason: 'The agent is paused for this brand.', ruleId: 'agent.paused' };
  }

  /* 2 ── Role scope. */
  if (!tool.scopes.includes(role)) {
    const needed = tool.scopes.reduce((a, r) => (ROLE_RANK[r] < ROLE_RANK[a] ? r : a), tool.scopes[0]);
    return {
      kind: 'deny',
      reason: `Requires ${needed} or above; caller is ${role}.`,
      ruleId: 'role.scope',
    };
  }

  /* 3 ── Tools SPARK may never call. */
  if (tool.autonomy === 'human_only' && caller === 'agent') {
    return { kind: 'deny', reason: 'This action must be taken by a person.', ruleId: 'autonomy.human_only' };
  }

  /* 4 ── Budget. Checked before side effects, for both callers.
   *
   * Keyed on **cost, not category**. This read `tool.effect === 'spend'` and no
   * tool in the registry has ever declared that effect — every one that spends
   * money (`genome.bootstrap_from_url`, `direct.media.ingest`,
   * `whatsapp.send`, the brief writers) is `external`, because it is. So the
   * rule was unreachable: correct, tested to 100% branches, and unable to fire.
   *
   * Found by draining a 2¢ cap with 1¢ calls and watching all of them succeed.
   * The unit tests could not have found it — they build this input directly and
   * pass `effect: 'spend'`, which nothing else in the codebase does.
   *
   * `estimatedCents > 0` is the honest signal, and it is a fact about the call
   * rather than a label someone has to remember to attach. `effect === 'spend'`
   * is kept so a tool declaring it is still permission-checked at a zero
   * estimate. */
  if (tool.effect === 'spend' || budget.estimatedCents > 0) {
    if (brand.permissions?.spendCredits === false) {
      return { kind: 'deny', reason: 'Credit spending is disabled for this workspace.', ruleId: 'permission.spend' };
    }
    if (budget.estimatedCents > budget.remainingCents) {
      return {
        kind: 'deny',
        reason: `Estimated ${budget.estimatedCents}¢ exceeds the ${budget.remainingCents}¢ remaining this month.`,
        ruleId: 'budget.exceeded',
      };
    }
  }

  /* 5 ── Destructive work always routes to an owner/admin approval. */
  if (tool.effect === 'destructive') {
    return { kind: 'approval', reason: 'Irreversible action.', ruleId: 'effect.destructive' };
  }

  /* 6 ── Engagement replies: gated until eligible AND configured. */
  if (family === 'engage' && tool.effect === 'publish') {
    if (!engagement?.eligible) {
      return { kind: 'deny', reason: 'Engagement intelligence is not yet eligible for this campaign.', ruleId: 'engage.ineligible' };
    }
    if (!engagement.autonomyConfigured) {
      return { kind: 'approval', reason: 'Engagement autonomy has not been configured.', ruleId: 'engage.unconfigured' };
    }
  }

  /* 7 ── Publishing. The heart of the PRD governance model. */
  if (tool.effect === 'publish') {
    if (subject?.guardrailFlags?.length) {
      return {
        kind: 'approval',
        reason: `Guardrail flagged: ${subject.guardrailFlags.join(', ')}.`,
        ruleId: 'guardrail.flagged',
      };
    }

    const quiet = brand.quietWindows?.find((w) => inWindow(now, w));
    if (quiet) {
      return { kind: 'deny', reason: `Publishing is frozen: ${quiet.reason}.`, ruleId: 'brand.quiet_window' };
    }

    if (subject?.platform && brand.restrictedPlatforms?.includes(subject.platform)) {
      return { kind: 'approval', reason: `${subject.platform} requires review.`, ruleId: 'brand.restricted_platform' };
    }

    if (subject?.contentType && brand.restrictedContentTypes?.includes(subject.contentType)) {
      return { kind: 'approval', reason: `${subject.contentType} content requires review.`, ruleId: 'brand.restricted_content_type' };
    }

    if (subject?.isAutomationOutput) {
      if (subject.reviewBeforePublish) {
        return { kind: 'approval', reason: 'Recipe is set to review before publish.', ruleId: 'recipe.review_before_publish' };
      }
      if (brand.permissions?.automationAutoPublish === false) {
        return { kind: 'approval', reason: 'Automation auto-publish is disabled.', ruleId: 'permission.automation_autopublish' };
      }
    }

    switch (brand.approvalMode) {
      case 'review_everything':
        return { kind: 'approval', reason: 'Workspace reviews all content before publishing.', ruleId: 'approval_mode.review_everything' };
      case 'review_first_week': {
        const age = daysBetween(now, brand.createdAt);
        if (age < REVIEW_FIRST_WEEK_DAYS) {
          return {
            kind: 'approval',
            reason: `Reviewing everything for the first week (day ${age + 1} of ${REVIEW_FIRST_WEEK_DAYS}).`,
            ruleId: 'approval_mode.review_first_week',
          };
        }
        break; // graduated — fall through to autopublish
      }
      case 'autopublish':
        break;
    }
    // PRD §7.1 — autopublish is the default once nothing above intervened.
  }

  /* 8 ── Workspace override for the family, then the tool's own default. */
  const effective: Autonomy = brand.familyOverrides?.[family] ?? tool.autonomy;

  if (effective === 'approval') {
    return { kind: 'approval', reason: 'This action requires approval in this workspace.', ruleId: 'autonomy.approval' };
  }
  if (effective === 'confirm') {
    // A human clicking the button IS the confirmation; only SPARK needs to ask.
    return caller === 'agent'
      ? { kind: 'confirm', reason: 'SPARK needs confirmation before this action.', ruleId: 'autonomy.confirm' }
      : { kind: 'allow' };
  }

  return { kind: 'allow' };
}
