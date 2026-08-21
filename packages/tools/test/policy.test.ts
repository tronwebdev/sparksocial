import { describe, expect, it } from 'vitest';
import { evaluate, type Decision, type PolicyInput } from '../src/policy.js';
import type { Autonomy, Effect, Role } from '@sparksocial/shared/types';

/**
 * POLICY ENGINE TESTS — 100% branch coverage (CLAUDE.md invariant 3).
 *
 * Written *before* the handlers they guard, per the build order. Autonomy behaviour
 * lives in `evaluate()` and nowhere else, so this file is the complete specification
 * of what SPARK is allowed to do unattended. If a governance question cannot be
 * answered by reading this file, the rule is in the wrong place.
 *
 * Every test names the `ruleId` it expects. Asserting on the ruleId rather than just
 * the decision kind is deliberate: two rules returning `approval` for different
 * reasons must stay distinguishable, because the Review queue shows the reason.
 */

const NOW = new Date('2026-08-15T12:00:00Z');
const BRAND_CREATED = new Date('2026-08-01T00:00:00Z'); // 14 days before NOW

/** A permissive baseline. Each test overrides only the field under examination. */
function input(over: DeepPartial<PolicyInput> = {}): PolicyInput {
  return {
    tool: {
      name: over.tool?.name ?? 'draft.copy.write',
      effect: (over.tool?.effect ?? 'write') as Effect,
      autonomy: (over.tool?.autonomy ?? 'auto') as Autonomy,
      scopes: (over.tool?.scopes ?? ['owner', 'admin', 'editor']) as Role[],
      ...(over.tool?.producesMedia ? { producesMedia: true } : {}),
    },
    caller: over.caller ?? 'agent',
    role: (over.role ?? 'owner') as Role,
    now: over.now ?? NOW,
    brand: {
      createdAt: over.brand?.createdAt ?? BRAND_CREATED,
      approvalMode: over.brand?.approvalMode ?? 'autopublish',
      ...(over.brand?.familyOverrides ? { familyOverrides: over.brand.familyOverrides } : {}),
      ...(over.brand?.restrictedPlatforms ? { restrictedPlatforms: over.brand.restrictedPlatforms } : {}),
      ...(over.brand?.restrictedContentTypes ? { restrictedContentTypes: over.brand.restrictedContentTypes } : {}),
      ...(over.brand?.quietWindows ? { quietWindows: over.brand.quietWindows } : {}),
      ...(over.brand?.agentPaused !== undefined ? { agentPaused: over.brand.agentPaused } : {}),
      ...(over.brand?.permissions ? { permissions: over.brand.permissions } : {}),
      ...(over.brand?.publishRoles ? { publishRoles: over.brand.publishRoles as Role[] } : {}),
      ...(over.brand?.maxPendingReview !== undefined ? { maxPendingReview: over.brand.maxPendingReview } : {}),
    },
    ...(over.subject ? { subject: over.subject } : {}),
    budget: {
      remainingCents: over.budget?.remainingCents ?? 10_000,
      estimatedCents: over.budget?.estimatedCents ?? 0,
    },
    ...(over.engagement ? { engagement: over.engagement } : {}),
    ...(over.approval ? { approval: over.approval } : {}),
  } as PolicyInput;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const ruleOf = (d: Decision) => (d.kind === 'allow' ? 'allow' : d.ruleId);

// ---------------------------------------------------------------------------

describe('1 — kill switch', () => {
  it('denies any agent effect when the brand is paused', () => {
    const d = evaluate(input({ brand: { agentPaused: true }, caller: 'agent', tool: { effect: 'publish' } }));
    expect(d.kind).toBe('deny');
    expect(ruleOf(d)).toBe('agent.paused');
  });

  it('still allows agent reads while paused — the pause stops acting, not looking', () => {
    const d = evaluate(input({ brand: { agentPaused: true }, caller: 'agent', tool: { effect: 'read' } }));
    expect(d.kind).toBe('allow');
  });

  it('does not restrain a human while the agent is paused', () => {
    const d = evaluate(input({ brand: { agentPaused: true }, caller: 'user', tool: { effect: 'write' } }));
    expect(d.kind).toBe('allow');
  });
});

describe('2 — role scope', () => {
  it('denies a role outside the tool scopes and names the least-privileged sufficient role', () => {
    const d = evaluate(input({ role: 'viewer', tool: { scopes: ['owner', 'admin', 'editor'] } }));
    expect(d.kind).toBe('deny');
    expect(ruleOf(d)).toBe('role.scope');
    // `editor` is the lowest-ranked role in scopes, so it is what the message should ask for.
    expect(d.kind === 'deny' && d.reason).toContain('editor');
  });

  it('allows a role inside the tool scopes', () => {
    expect(evaluate(input({ role: 'editor' })).kind).toBe('allow');
  });

  it('picks the lowest rank when scopes are listed out of order', () => {
    const d = evaluate(input({ role: 'client', tool: { scopes: ['approver', 'owner', 'viewer'] } }));
    expect(d.kind === 'deny' && d.reason).toContain('viewer');
  });
});

describe('3 — human_only tools', () => {
  it('denies the agent', () => {
    const d = evaluate(input({ caller: 'agent', tool: { autonomy: 'human_only' } }));
    expect(ruleOf(d)).toBe('autonomy.human_only');
  });

  it('permits a human', () => {
    expect(evaluate(input({ caller: 'user', tool: { autonomy: 'human_only' } })).kind).toBe('allow');
  });
});

describe('4 — budget and spend permission', () => {
  it('denies when credit spending is disabled for the workspace', () => {
    const d = evaluate(input({
      tool: { effect: 'spend', autonomy: 'auto' },
      brand: { permissions: { spendCredits: false } },
      budget: { estimatedCents: 10, remainingCents: 10_000 },
    }));
    expect(ruleOf(d)).toBe('permission.spend');
  });

  it('denies when the estimate exceeds the remaining monthly budget', () => {
    const d = evaluate(input({
      tool: { effect: 'spend' },
      budget: { estimatedCents: 500, remainingCents: 499 },
    }));
    expect(ruleOf(d)).toBe('budget.exceeded');
    expect(d.kind === 'deny' && d.reason).toContain('499');
  });

  it('allows spend exactly at the remaining budget — the boundary is inclusive', () => {
    const d = evaluate(input({
      tool: { effect: 'spend' },
      budget: { estimatedCents: 500, remainingCents: 500 },
    }));
    expect(d.kind).toBe('allow');
  });

  it('does not budget-check a tool that costs nothing', () => {
    // Free is free, whatever the effect. A read must not be gated by a drained
    // budget — someone investigating why it drained needs the Timeline to load.
    const d = evaluate(input({ tool: { effect: 'write' }, budget: { estimatedCents: 0, remainingCents: 0 } }));
    expect(d.kind).toBe('allow');
  });

  it('budget-checks any tool that costs money, whatever its effect', () => {
    /**
     * This test replaces one that asserted the opposite, and the old one was
     * the bug: an `external` tool with a 9,999¢ estimate and nothing left was
     * allowed through, because the rule keyed on `effect === 'spend'` and
     * **no tool in the registry has ever declared that effect**. Every tool
     * that costs money is `external`, because it is.
     *
     * Found by draining a 2¢ cap with 1¢ `whatsapp.send` calls against a
     * running server and watching all of them succeed. No unit test could have
     * found it: they all construct this input by hand and pass `effect:
     * 'spend'`, a value nothing else in the codebase produces.
     */
    const d = evaluate(input({
      tool: { effect: 'external' },
      budget: { estimatedCents: 9_999, remainingCents: 0 },
    }));
    expect(d.kind).toBe('deny');
    expect(d.kind === 'deny' && d.ruleId).toBe('budget.exceeded');
  });

  it('honours the spend permission for a costed external tool too', () => {
    // The permission is about money leaving the account, not about which
    // category the tool was filed under.
    const d = evaluate(input({
      tool: { effect: 'external' },
      brand: { permissions: { spendCredits: false } },
      budget: { estimatedCents: 1, remainingCents: 10_000 },
    }));
    expect(d.kind).toBe('deny');
    expect(d.kind === 'deny' && d.ruleId).toBe('permission.spend');
  });

  it('allows spend when the permission is explicitly enabled', () => {
    const d = evaluate(input({
      tool: { effect: 'spend' },
      brand: { permissions: { spendCredits: true } },
      budget: { estimatedCents: 10, remainingCents: 100 },
    }));
    expect(d.kind).toBe('allow');
  });
});

describe('5 — destructive effects', () => {
  it('always routes to approval, even for an owner clicking the button', () => {
    const d = evaluate(input({ caller: 'user', role: 'owner', tool: { effect: 'destructive' } }));
    expect(d.kind).toBe('approval');
    expect(ruleOf(d)).toBe('effect.destructive');
  });
});

describe('6 — engagement gating', () => {
  const engageTool = { name: 'engage.reply.send', effect: 'publish' as const, autonomy: 'confirm' as const };

  it('denies replies before the campaign is eligible', () => {
    const d = evaluate(input({ tool: engageTool, engagement: { eligible: false, autonomyConfigured: true } }));
    expect(ruleOf(d)).toBe('engage.ineligible');
  });

  it('denies replies when eligibility is absent entirely', () => {
    const d = evaluate(input({ tool: engageTool }));
    expect(ruleOf(d)).toBe('engage.ineligible');
  });

  it('requires approval when eligible but autonomy is unconfigured', () => {
    const d = evaluate(input({ tool: engageTool, engagement: { eligible: true, autonomyConfigured: false } }));
    expect(ruleOf(d)).toBe('engage.unconfigured');
  });

  it('falls through to the publish rules once eligible and configured', () => {
    const d = evaluate(input({
      tool: engageTool,
      caller: 'agent',
      engagement: { eligible: true, autonomyConfigured: true },
    }));
    // autonomy 'confirm' + agent caller ⇒ confirm, not allow.
    expect(ruleOf(d)).toBe('autonomy.confirm');
  });

  it('does not gate non-publish engagement tools', () => {
    const d = evaluate(input({ tool: { name: 'engage.classify', effect: 'write' } }));
    expect(d.kind).toBe('allow');
  });
});

describe('7 — publishing governance', () => {
  const pub = { name: 'publish.now', effect: 'publish' as const, autonomy: 'auto' as const };

  it('routes to approval when a guardrail flagged the draft', () => {
    const d = evaluate(input({ tool: pub, subject: { guardrailFlags: ['claim_grounding'] } }));
    expect(ruleOf(d)).toBe('guardrail.flagged');
    expect(d.kind === 'approval' && d.reason).toContain('claim_grounding');
  });

  it('ignores an empty guardrail-flag array', () => {
    const d = evaluate(input({ tool: pub, subject: { guardrailFlags: [] } }));
    expect(d.kind).toBe('allow');
  });

  it('denies inside a publishing freeze window and names the reason', () => {
    const d = evaluate(input({
      tool: pub,
      brand: {
        quietWindows: [{
          from: new Date('2026-08-14T00:00:00Z'),
          to: new Date('2026-08-16T00:00:00Z'),
          reason: 'crisis pause',
        }],
      },
    }));
    expect(ruleOf(d)).toBe('brand.quiet_window');
    expect(d.kind === 'deny' && d.reason).toContain('crisis pause');
  });

  it('allows outside the freeze window', () => {
    const d = evaluate(input({
      tool: pub,
      brand: {
        quietWindows: [{
          from: new Date('2026-09-01T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
          reason: 'holiday',
        }],
      },
    }));
    expect(d.kind).toBe('allow');
  });

  it('routes restricted platforms to approval', () => {
    const d = evaluate(input({
      tool: pub,
      subject: { platform: 'linkedin' },
      brand: { restrictedPlatforms: ['linkedin'] },
    }));
    expect(ruleOf(d)).toBe('brand.restricted_platform');
  });

  it('allows an unrestricted platform', () => {
    const d = evaluate(input({
      tool: pub,
      subject: { platform: 'instagram' },
      brand: { restrictedPlatforms: ['linkedin'] },
    }));
    expect(d.kind).toBe('allow');
  });

  it('routes restricted content types to approval', () => {
    const d = evaluate(input({
      tool: pub,
      subject: { contentType: 'ai_ugc_testimonial' },
      brand: { restrictedContentTypes: ['ai_ugc_testimonial'] },
    }));
    expect(ruleOf(d)).toBe('brand.restricted_content_type');
  });

  it('allows an unrestricted content type', () => {
    const d = evaluate(input({
      tool: pub,
      subject: { contentType: 'workflow_clip' },
      brand: { restrictedContentTypes: ['ai_ugc_testimonial'] },
    }));
    expect(d.kind).toBe('allow');
  });

  describe('automation output', () => {
    it('routes to approval when the recipe asks for review before publish', () => {
      const d = evaluate(input({
        tool: pub,
        subject: { isAutomationOutput: true, reviewBeforePublish: true },
      }));
      expect(ruleOf(d)).toBe('recipe.review_before_publish');
    });

    it('routes to approval when workspace automation auto-publish is off', () => {
      const d = evaluate(input({
        tool: pub,
        subject: { isAutomationOutput: true, reviewBeforePublish: false },
        brand: { permissions: { automationAutoPublish: false } },
      }));
      expect(ruleOf(d)).toBe('permission.automation_autopublish');
    });

    it('publishes automation output when both switches permit it', () => {
      const d = evaluate(input({
        tool: pub,
        subject: { isAutomationOutput: true, reviewBeforePublish: false },
        brand: { permissions: { automationAutoPublish: true } },
      }));
      expect(d.kind).toBe('allow');
    });

    it('does not apply recipe rules to non-automation output', () => {
      const d = evaluate(input({
        tool: pub,
        subject: { isAutomationOutput: false, reviewBeforePublish: true },
        brand: { permissions: { automationAutoPublish: false } },
      }));
      expect(d.kind).toBe('allow');
    });
  });

  describe('approval modes', () => {
    it('review_everything gates every publish', () => {
      const d = evaluate(input({ tool: pub, brand: { approvalMode: 'review_everything' } }));
      expect(ruleOf(d)).toBe('approval_mode.review_everything');
    });

    it('review_first_week gates inside the window and reports the day number', () => {
      const d = evaluate(input({
        tool: pub,
        now: new Date('2026-08-03T12:00:00Z'), // day 3 of 7
        brand: { approvalMode: 'review_first_week', createdAt: BRAND_CREATED },
      }));
      expect(ruleOf(d)).toBe('approval_mode.review_first_week');
      expect(d.kind === 'approval' && d.reason).toContain('day 3 of 7');
    });

    it('review_first_week graduates on day 7 — the boundary releases, it does not gate', () => {
      const d = evaluate(input({
        tool: pub,
        now: new Date('2026-08-08T00:00:00Z'), // exactly 7 days after createdAt
        brand: { approvalMode: 'review_first_week', createdAt: BRAND_CREATED },
      }));
      expect(d.kind).toBe('allow');
    });

    it('autopublish is the PRD §7.1 default when nothing else intervenes', () => {
      const d = evaluate(input({ tool: pub, brand: { approvalMode: 'autopublish' } }));
      expect(d.kind).toBe('allow');
    });
  });

  it('guardrail flags beat the freeze window — the first matching rule wins', () => {
    const d = evaluate(input({
      tool: pub,
      subject: { guardrailFlags: ['brand_voice'] },
      brand: {
        quietWindows: [{ from: new Date('2026-08-14T00:00:00Z'), to: new Date('2026-08-16T00:00:00Z'), reason: 'pause' }],
      },
    }));
    expect(ruleOf(d)).toBe('guardrail.flagged');
  });
});

describe('8 — family overrides and the tool default', () => {
  it('a workspace override escalates an auto tool to approval', () => {
    const d = evaluate(input({
      tool: { name: 'synthesize.avatar_video', autonomy: 'auto' },
      brand: { familyOverrides: { synthesize: 'approval' } },
    }));
    expect(ruleOf(d)).toBe('autonomy.approval');
  });

  it('the override is scoped to its family and does not leak to others', () => {
    const d = evaluate(input({
      tool: { name: 'assemble.montage', autonomy: 'auto' },
      brand: { familyOverrides: { synthesize: 'approval' } },
    }));
    expect(d.kind).toBe('allow');
  });

  it('a workspace override can also relax a confirm tool to auto', () => {
    const d = evaluate(input({
      tool: { name: 'draft.copy.write', autonomy: 'confirm' },
      caller: 'agent',
      brand: { familyOverrides: { draft: 'auto' } },
    }));
    expect(d.kind).toBe('allow');
  });

  it("the tool's own approval default applies with no override", () => {
    const d = evaluate(input({ tool: { autonomy: 'approval' } }));
    expect(ruleOf(d)).toBe('autonomy.approval');
  });

  it('confirm asks SPARK but not the human — clicking the button IS the confirmation', () => {
    const agent = evaluate(input({ tool: { autonomy: 'confirm' }, caller: 'agent' }));
    const human = evaluate(input({ tool: { autonomy: 'confirm' }, caller: 'user' }));
    expect(ruleOf(agent)).toBe('autonomy.confirm');
    expect(human.kind).toBe('allow');
  });

  it('auto allows both callers', () => {
    expect(evaluate(input({ tool: { autonomy: 'auto' }, caller: 'agent' })).kind).toBe('allow');
    expect(evaluate(input({ tool: { autonomy: 'auto' }, caller: 'user' })).kind).toBe('allow');
  });
});

describe('purity', () => {
  it('is deterministic and does not mutate its input', () => {
    const i = input({ tool: { effect: 'publish' }, brand: { approvalMode: 'review_everything' } });
    const snapshot = JSON.stringify(i);
    const a = evaluate(i);
    const b = evaluate(i);
    expect(a).toEqual(b);
    expect(JSON.stringify(i)).toBe(snapshot);
  });

  it('reads the clock only from `now`', () => {
    // Same brand, two different injected clocks, opposite outcomes. If evaluate()
    // called Date.now() internally this could not hold.
    const gated = evaluate(input({
      tool: { effect: 'publish' },
      now: new Date('2026-08-02T00:00:00Z'),
      brand: { approvalMode: 'review_first_week', createdAt: BRAND_CREATED },
    }));
    const graduated = evaluate(input({
      tool: { effect: 'publish' },
      now: new Date('2026-08-20T00:00:00Z'),
      brand: { approvalMode: 'review_first_week', createdAt: BRAND_CREATED },
    }));
    expect(gated.kind).toBe('approval');
    expect(graduated.kind).toBe('allow');
  });
});

// ---------------------------------------------------------------------------

describe('9 — a granted approval', () => {
  const GRANT = { grantedBy: 'user_reviewer', grantedAt: new Date('2026-08-15T11:00:00Z') };

  it('turns an approval decision into allow', () => {
    // The whole point of the Review queue: a human said yes, so the call that
    // was held now runs.
    const held = input({ tool: { autonomy: 'approval' } });
    expect(ruleOf(evaluate(held))).toBe('autonomy.approval');
    expect(evaluate({ ...held, approval: GRANT })).toEqual({ kind: 'allow' });
  });

  it('releases every rule that produces an approval, not just one', () => {
    // Each of these reaches `approval` by a different route; a grant has to
    // satisfy all of them or the queue would strand whichever it missed.
    const cases: Array<[string, PolicyInput]> = [
      ['effect.destructive', input({ tool: { effect: 'destructive' } })],
      [
        'approval_mode.review_everything',
        input({ tool: { effect: 'publish' }, brand: { approvalMode: 'review_everything' } }),
      ],
      [
        'approval_mode.review_first_week',
        input({
          tool: { effect: 'publish' },
          brand: { approvalMode: 'review_first_week', createdAt: new Date('2026-08-13T00:00:00Z') },
        }),
      ],
      ['autonomy.approval', input({ tool: { autonomy: 'approval' } })],
    ];

    for (const [ruleId, held] of cases) {
      expect(ruleOf(evaluate(held)), ruleId).toBe(ruleId);
      expect(evaluate({ ...held, approval: GRANT }), ruleId).toEqual({ kind: 'allow' });
    }
  });

  it('does NOT turn a deny into allow', () => {
    // The security property. A reviewer approving a post must not thereby
    // approve a paused agent, a role that lacks the scope, or an exhausted
    // budget — none of those are what they were shown.
    const denials: Array<[string, PolicyInput]> = [
      ['agent.paused', input({ brand: { agentPaused: true }, caller: 'agent', tool: { effect: 'publish' } })],
      ['role.scope', input({ role: 'viewer' })],
      ['budget.exceeded', input({ tool: { effect: 'spend' }, budget: { remainingCents: 10, estimatedCents: 500 } })],
      ['autonomy.human_only', input({ tool: { autonomy: 'human_only' }, caller: 'agent' })],
    ];

    for (const [ruleId, denied] of denials) {
      expect(ruleOf(evaluate(denied)), ruleId).toBe(ruleId);
      const withGrant = evaluate({ ...denied, approval: GRANT });
      expect(withGrant.kind, ruleId).toBe('deny');
      expect(ruleOf(withGrant), ruleId).toBe(ruleId);
    }
  });

  it('does NOT turn a confirm into allow', () => {
    // Confirmation is a different question from approval — "are you sure?"
    // asked of the actor, not "may this happen?" asked of a reviewer.
    const held = input({ tool: { autonomy: 'confirm' }, caller: 'agent' });
    expect(evaluate(held).kind).toBe('confirm');
    expect(evaluate({ ...held, approval: GRANT }).kind).toBe('confirm');
  });

  it('leaves an already-allowed call allowed', () => {
    expect(evaluate({ ...input(), approval: GRANT })).toEqual({ kind: 'allow' });
  });
});

/* ── PRD §6: publish permission, per role, per workspace ──────────────────── */

describe('rule 2b — publishRoles narrows a publish tool and never widens it', () => {
  /**
   * §6's first permission control is "Publish permission (per role)". Roles did
   * gate publishing — `publish.now` declares `['owner','admin','editor']` — but
   * that list is compiled into the tool, so a workspace wanting editors to draft
   * and only admins to publish had no way to say so.
   */
  const pub = { name: 'publish.now', effect: 'publish' as const, autonomy: 'auto' as const };

  it('denies a role the workspace excluded, even though the tool allows it', () => {
    const d = evaluate(
      input({
        tool: { ...pub, scopes: ['owner', 'admin', 'editor'] },
        role: 'editor',
        brand: { publishRoles: ['owner', 'admin'] },
      }),
    );
    expect(d).toMatchObject({ kind: 'deny', ruleId: 'permission.publish_role' });
  });

  it('allows a role the workspace listed', () => {
    const d = evaluate(
      input({
        tool: { ...pub, scopes: ['owner', 'admin', 'editor'] },
        role: 'admin',
        brand: { publishRoles: ['owner', 'admin'] },
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('cannot widen: a role the tool never allowed is still refused by rule 2', () => {
    // The ordering matters. If this ran before rule 2, a workspace could grant
    // publishing to a viewer by listing it here.
    const d = evaluate(
      input({
        tool: { ...pub, scopes: ['owner', 'admin'] },
        role: 'viewer',
        brand: { publishRoles: ['viewer'] },
      }),
    );
    expect(d).toMatchObject({ kind: 'deny', ruleId: 'role.scope' });
  });

  it('an empty list is not a lockout — it means "unset"', () => {
    // A cleared field must not read as "nobody may publish", which would take a
    // workspace down by way of a settings screen.
    const d = evaluate(
      input({ tool: { ...pub, scopes: ['owner'] }, role: 'owner', brand: { publishRoles: [] } }),
    );
    expect(d.kind).toBe('allow');
  });

  it('does not touch non-publish tools', () => {
    const d = evaluate(
      input({
        tool: { name: 'content.draft', effect: 'write', autonomy: 'auto', scopes: ['editor'] },
        role: 'editor',
        brand: { publishRoles: ['owner'] },
      }),
    );
    expect(d.kind).toBe('allow');
  });
});

/* ── PRD §6: approval required before generating media ────────────────────── */

describe('rule 4b — media generation can require a person', () => {
  const media = {
    name: 'content.generate_avatar_video',
    effect: 'external' as const,
    autonomy: 'auto' as const,
    scopes: ['owner' as const],
    producesMedia: true,
  };

  it('routes to approval when the workspace requires it', () => {
    const d = evaluate(
      input({ tool: media, role: 'owner', brand: { permissions: { requireApprovalForMedia: true } } }),
    );
    expect(d).toMatchObject({ kind: 'approval', ruleId: 'permission.media_generation' });
  });

  it('allows when the workspace has not asked for it', () => {
    expect(evaluate(input({ tool: media, role: 'owner' })).kind).toBe('allow');
  });

  it('leaves a tool that produces no media alone', () => {
    const d = evaluate(
      input({
        tool: { name: 'content.draft', effect: 'write', autonomy: 'auto', scopes: ['owner'] },
        role: 'owner',
        brand: { permissions: { requireApprovalForMedia: true } },
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('answers "you cannot afford this" ahead of "ask someone"', () => {
    // Both are true and the budget answer is the more useful one.
    const d = evaluate(
      input({
        tool: media,
        role: 'owner',
        brand: { permissions: { requireApprovalForMedia: true } },
        budget: { remainingCents: 10, estimatedCents: 50 },
      }),
    );
    expect(d).toMatchObject({ kind: 'deny', ruleId: 'budget.exceeded' });
  });
});

/* ── PRD §10: the review queue has a ceiling ──────────────────────────────── */

describe('rule 4c — queue cap', () => {
  const writer = {
    name: 'content.draft',
    effect: 'write' as const,
    autonomy: 'auto' as const,
    scopes: ['owner' as const, 'editor' as const],
  };

  it('stops the agent adding to a full review queue', () => {
    const d = evaluate(
      input({
        tool: writer,
        caller: 'agent',
        role: 'owner',
        brand: { maxPendingReview: 20 },
        subject: { pendingReviewCount: 20 },
      }),
    );
    expect(d).toMatchObject({ kind: 'deny', ruleId: 'brand.review_queue_full' });
  });

  it('lets a person keep working through a backlog they can see', () => {
    // The failure this guards against is SPARK filling a queue faster than
    // anyone empties it. A human clearing that queue must not be blocked by it.
    const d = evaluate(
      input({
        tool: writer,
        caller: 'user',
        role: 'owner',
        brand: { maxPendingReview: 20 },
        subject: { pendingReviewCount: 50 },
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('allows the agent below the cap', () => {
    const d = evaluate(
      input({
        tool: writer,
        caller: 'agent',
        role: 'owner',
        brand: { maxPendingReview: 20 },
        subject: { pendingReviewCount: 19 },
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('no cap set means no cap', () => {
    const d = evaluate(
      input({ tool: writer, caller: 'agent', role: 'owner', subject: { pendingReviewCount: 9_999 } }),
    );
    expect(d.kind).toBe('allow');
  });

  it('a cap with no count to compare against does not fire', () => {
    // The count is derived per call; a tool that does not report one must not be
    // blocked by a cap it cannot be measured against.
    const d = evaluate(input({ tool: writer, caller: 'agent', role: 'owner', brand: { maxPendingReview: 1 } }));
    expect(d.kind).toBe('allow');
  });

  it('does not apply to reads — a full queue is exactly when you need to look at it', () => {
    const d = evaluate(
      input({
        tool: { name: 'queue.review.list', effect: 'read', autonomy: 'auto', scopes: ['owner'] },
        caller: 'agent',
        role: 'owner',
        brand: { maxPendingReview: 1 },
        subject: { pendingReviewCount: 500 },
      }),
    );
    expect(d.kind).toBe('allow');
  });
});

/* ── PRD §7.2: approvals, per campaign ────────────────────────────────────── */

describe('rule 7 — a campaign’s own approval mode overrides the brand’s', () => {
  const pub = {
    name: 'publish.now',
    effect: 'publish' as const,
    autonomy: 'auto' as const,
    scopes: ['owner' as const],
  };

  it('a cautious campaign requires review inside an autopublishing brand', () => {
    const d = evaluate(
      input({
        tool: pub,
        role: 'owner',
        brand: { approvalMode: 'autopublish' },
        subject: { campaignApprovalMode: 'review_everything' },
      }),
    );
    expect(d).toMatchObject({ kind: 'approval', ruleId: 'campaign.review_everything' });
  });

  it('a routine campaign publishes freely inside a brand that reviews everything', () => {
    // The downward direction is what makes this a control rather than a second
    // lock. Without it, a brand has to pick one posture for every campaign.
    const d = evaluate(
      input({
        tool: pub,
        role: 'owner',
        brand: { approvalMode: 'review_everything' },
        subject: { campaignApprovalMode: 'autopublish' },
      }),
    );
    expect(d.kind).toBe('allow');
  });

  it('falls through to the brand when the campaign sets nothing', () => {
    const d = evaluate(input({ tool: pub, role: 'owner', brand: { approvalMode: 'review_everything' } }));
    expect(d).toMatchObject({ kind: 'approval', ruleId: 'approval_mode.review_everything' });
  });

  it('attributes a first-week hold to the campaign when the campaign chose it', () => {
    const d = evaluate(
      input({
        tool: pub,
        role: 'owner',
        now: new Date('2026-08-03T00:00:00Z'),
        brand: { approvalMode: 'autopublish', createdAt: new Date('2026-08-01T00:00:00Z') },
        subject: { campaignApprovalMode: 'review_first_week' },
      }),
    );
    expect(d).toMatchObject({ kind: 'approval', ruleId: 'campaign.review_first_week' });
  });

  it('a graduated first-week campaign publishes', () => {
    const d = evaluate(
      input({
        tool: pub,
        role: 'owner',
        now: new Date('2026-09-01T00:00:00Z'),
        brand: { approvalMode: 'review_everything', createdAt: new Date('2026-08-01T00:00:00Z') },
        subject: { campaignApprovalMode: 'review_first_week' },
      }),
    );
    expect(d.kind).toBe('allow');
  });
});
