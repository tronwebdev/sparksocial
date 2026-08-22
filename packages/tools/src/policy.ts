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
  tool: {
    name: string;
    effect: Effect;
    autonomy: Autonomy;
    scopes: Role[];
    /** True for the tools that spend a vendor's money making a file — rule 4b. */
    producesMedia?: boolean;
  };
  caller: 'user' | 'agent';
  role: Role;
  now: Date;
  /**
   * Capabilities this caller holds through team-group membership
   * (`SET-WS-TEAM-GROUPS`), resolved by `invokeTool` and passed in — never read
   * here, because this function does no I/O (CLAUDE.md invariant 3).
   *
   * Absent and empty mean the same thing: exactly the caller's own role. Every
   * capability widens and none narrows, so omitting the field can only ever be
   * the more restrictive answer, which is the right default for a field somebody
   * might forget to populate.
   */
  capabilities?: TeamCapability[];

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
    /**
     * Permission toggles (PRD §6's "Permission Controls (workspace-configurable)").
     *
     * `requireApprovalForMedia` was the one of the five with no representation
     * anywhere, and it is the one guarding the money: `content.generate_avatar_video`
     * is 50¢ a call and `content.generate_dub` 60¢. The spend ceiling and
     * `spendCredits` both apply, and neither can express "a person signs off
     * before we render video" — which is a different question from "can we
     * afford it".
     */
    permissions?: {
      spendCredits?: boolean;
      automationAutoPublish?: boolean;
      requireApprovalForMedia?: boolean;
    };
    /**
     * §6's first permission control: "Publish permission (per role)".
     *
     * Roles already gate publishing — `publish.now` declares
     * `['owner','admin','editor']` — but that list is compiled into the tool, so
     * a workspace wanting editors to draft and only admins to publish had no way
     * to say it. This narrows the tool's own scopes for `publish`-effect calls
     * and can only ever narrow: a role absent from the tool's `scopes` is still
     * refused by rule 2 first, so this cannot be used to grant anything.
     */
    publishRoles?: Role[];
    /**
     * §10's "queue caps" — the mitigation for "automation floods
     * feeds/calendars". How much unreviewed work may sit waiting before SPARK
     * stops adding to it.
     *
     * Passed in rather than counted here, because `evaluate` performs no I/O
     * (CLAUDE.md invariant 3). Undefined means no cap, which is the behaviour
     * every brand had before this existed.
     */
    maxPendingReview?: number;
  };

  /** Populated for publish-effect calls. */
  subject?: {
    platform?: string;
    contentType?: string;
    guardrailFlags?: string[];
    isAutomationOutput?: boolean;
    reviewBeforePublish?: boolean;
    /**
     * PRD §7.2 lists four scopes at which approvals may be switched on:
     * globally, **per campaign**, per content type/platform, and by guardrail
     * trigger. Three were real. This is the fourth.
     *
     * A campaign's own mode *overrides* the brand's for its own posts, in either
     * direction — a cautious launch campaign can require review inside an
     * otherwise autopublishing brand, and a routine one can autopublish inside a
     * brand that reviews everything. Overriding downward is the case that makes
     * this a real control rather than a second lock: without it, a brand had to
     * pick one posture for every campaign it runs at once.
     *
     * Undefined falls through to `brand.approvalMode`, which is every campaign
     * created before this existed.
     */
    campaignApprovalMode?: 'autopublish' | 'review_first_week' | 'review_everything';
    /**
     * How many items are already waiting on a human for this brand — §10's queue
     * cap reads it against `brand.maxPendingReview`.
     */
    pendingReviewCount?: number;
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

/**
 * The four capabilities a team group can carry (`SET-WS-TEAM-GROUPS`).
 *
 * Every one of them **widens** and none narrows. That asymmetry is the whole
 * safety argument for the feature: a group cannot be used to take access away
 * from somebody, so a mistake in group configuration cannot lock a workspace
 * out of its own account, and rule 2 still refuses any tool whose own `scopes`
 * exclude the caller before a capability is ever consulted.
 */
export type TeamCapability = 'publish' | 'spend_credits' | 'manage_brand' | 'approve';

/**
 * Which role a capability lets its holder *act as*, for rule 2's scope check
 * only.
 *
 * Only two of the four appear here, because only two are about reaching a tool
 * at all — `publish` and `spend_credits` are about permission toggles further
 * down and are checked there instead.
 *
 * `manage_brand` confers `admin`, and confers it **only inside the `brand` and
 * `genome` families**. Granting `admin` outright would hand a group `team.invite`
 * and `org.security.sso.configure`, which is not what "Manage brand" says on the
 * screen and not what an owner ticking that box is agreeing to. Keying the grant
 * to a tool family is not a special case bolted on here: CLAUDE.md invariant 1
 * makes the dotted family grouping part of the architecture, which is exactly
 * what makes it a sound thing to scope a grant by.
 */
/**
 * A narrowing guard over the stored strings.
 *
 * `team_groups.capabilities` is jsonb, so a value written by an older build (or
 * by hand) can be anything. Filtering rather than trusting means an unrecognised
 * capability grants nothing, which is the safe direction — and is why the store
 * type is `string[]` while the policy input is the union.
 */
export function isTeamCapability(value: string): value is TeamCapability {
  return value === 'publish' || value === 'spend_credits' || value === 'manage_brand' || value === 'approve';
}

const CAPABILITY_ACTS_AS: Partial<Record<TeamCapability, { role: Role; families?: readonly string[] }>> = {
  approve: { role: 'approver' },
  manage_brand: { role: 'admin', families: ['brand', 'genome'] },
};

/**
 * Whether a capability lets this caller through rule 2 for this tool.
 *
 * Pure, like everything else here — the capability list is resolved by
 * `invokeTool` and handed in, never read from a database at this depth
 * (CLAUDE.md invariant 3).
 */
function scopeGrantedByCapability(
  tool: { name: string; scopes: readonly Role[] },
  capabilities: readonly TeamCapability[],
  family: string,
): TeamCapability | undefined {
  for (const capability of capabilities) {
    const grant = CAPABILITY_ACTS_AS[capability];
    if (!grant) continue;
    if (grant.families && !grant.families.includes(family)) continue;
    // Still only what the tool itself allows: acting as `approver` is worth
    // nothing on a tool that does not list `approver`.
    if (tool.scopes.includes(grant.role)) return capability;
  }
  return undefined;
}

function evaluateRules(input: PolicyInput): Decision {
  const { tool, caller, role, now, brand, subject, budget, engagement } = input;
  const family = toolFamily(tool.name);
  /**
   * Group capabilities apply to a *person*, so an agent turn never carries
   * them. SPARK acting "as" a member of the publishing group would let a
   * workspace widen the agent's reach by editing a team screen, which is the
   * opposite of what that screen is for.
   */
  const capabilities = caller === 'user' ? (input.capabilities ?? []) : [];

  /* 1 ── Kill switch. Beats everything except reads. */
  if (brand.agentPaused && caller === 'agent' && tool.effect !== 'read') {
    return { kind: 'deny', reason: 'The agent is paused for this brand.', ruleId: 'agent.paused' };
  }

  /* 2 ── Role scope.
   *
   *      A team group can satisfy this where the caller's own role cannot —
   *      that is the point of the Groups tab. It can never do more than the
   *      tool already permits: `scopeGrantedByCapability` checks the granted
   *      role against `tool.scopes` too, so a group cannot reach a tool no role
   *      it names was allowed to call. */
  if (!tool.scopes.includes(role) && !scopeGrantedByCapability(tool, capabilities, family)) {
    const needed = tool.scopes.reduce((a, r) => (ROLE_RANK[r] < ROLE_RANK[a] ? r : a), tool.scopes[0]);
    return {
      kind: 'deny',
      reason: `Requires ${needed} or above; caller is ${role}.`,
      ruleId: 'role.scope',
    };
  }

  /* 2b ─ Workspace-configurable publish permission (PRD §6).
   *
   *      After rule 2, never instead of it: `publishRoles` narrows the tool's
   *      declared scopes and must not be able to widen them. A workspace that
   *      lists a role the tool never allowed still gets rule 2's refusal. */
  if (tool.effect === 'publish' && brand.publishRoles && brand.publishRoles.length > 0) {
    // A group carrying `publish` is the workspace naming these people directly,
    // which is a more specific statement than the by-role list and should win
    // over it. It is still gated by rule 2 above, so this cannot reach a tool
    // the caller was never allowed to call.
    if (!brand.publishRoles.includes(role) && !capabilities.includes('publish')) {
      return {
        kind: 'deny',
        reason: `This workspace restricts publishing to ${brand.publishRoles.join(', ')}; caller is ${role}.`,
        ruleId: 'permission.publish_role',
      };
    }
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
    if (brand.permissions?.spendCredits === false && !capabilities.includes('spend_credits')) {
      return { kind: 'deny', reason: 'Credit spending is disabled for this workspace.', ruleId: 'permission.spend' };
    }
    /**
     * The ceiling is not a permission and no capability lifts it. "Spending is
     * switched off for this workspace" is a policy an owner can delegate; "there
     * is no money left" is a fact, and a group that could spend past the cap
     * would make the cap advisory.
     */
    if (budget.estimatedCents > budget.remainingCents) {
      return {
        kind: 'deny',
        reason: `Estimated ${budget.estimatedCents}¢ exceeds the ${budget.remainingCents}¢ remaining this month.`,
        ruleId: 'budget.exceeded',
      };
    }
  }

  /* 4b ─ Media generation, when the workspace requires sign-off (PRD §6).
   *
   *      Read off the tool rather than guessed from its family: `content.*` and
   *      `compose.*` both hold tools that produce pixels and tools that do not,
   *      so a family check would either gate `content.draft` (text, cheap) or
   *      miss `compose.render` (video, expensive). `producesMedia` is declared
   *      by the seven tools that spend a vendor's money making a file.
   *
   *      Placed after the budget rule on purpose: "you cannot afford this" is a
   *      better answer than "ask someone" when both are true. */
  if (tool.producesMedia && brand.permissions?.requireApprovalForMedia && !capabilities.includes('approve')) {
    return {
      kind: 'approval',
      reason: 'This workspace requires approval before generating media.',
      ruleId: 'permission.media_generation',
    };
  }

  /* 4c ─ Queue cap (PRD §10: "automation floods feeds/calendars").
   *
   *      Only for the agent, and only for work that *adds* to the queue. A
   *      person is allowed to keep working through a backlog they can see; the
   *      failure this guards against is SPARK filling a review queue faster than
   *      anyone can empty it, which is how the queue stops being read at all. */
  if (
    caller === 'agent' &&
    (tool.effect === 'publish' || tool.effect === 'write') &&
    brand.maxPendingReview !== undefined &&
    subject?.pendingReviewCount !== undefined &&
    subject.pendingReviewCount >= brand.maxPendingReview
  ) {
    return {
      kind: 'deny',
      reason: `${subject.pendingReviewCount} items are already waiting for review; the cap for this workspace is ${brand.maxPendingReview}.`,
      ruleId: 'brand.review_queue_full',
    };
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

    /* PRD §7.2's per-campaign scope. The campaign's own mode wins in either
     * direction — see `subject.campaignApprovalMode`. */
    const effectiveMode = subject?.campaignApprovalMode ?? brand.approvalMode;

    switch (effectiveMode) {
      case 'review_everything':
        return {
          kind: 'approval',
          reason: subject?.campaignApprovalMode
            ? 'This campaign reviews all content before publishing.'
            : 'Workspace reviews all content before publishing.',
          ruleId: subject?.campaignApprovalMode
            ? 'campaign.review_everything'
            : 'approval_mode.review_everything',
        };
      case 'review_first_week': {
        const age = daysBetween(now, brand.createdAt);
        if (age < REVIEW_FIRST_WEEK_DAYS) {
          return {
            kind: 'approval',
            reason: `Reviewing everything for the first week (day ${age + 1} of ${REVIEW_FIRST_WEEK_DAYS}).`,
            ruleId: subject?.campaignApprovalMode
              ? 'campaign.review_first_week'
              : 'approval_mode.review_first_week',
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
