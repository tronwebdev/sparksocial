import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { evaluate } from '@sparksocial/tools';
import type { BrandGovernance, BrandGovernanceStore, ToolCtx } from '@sparksocial/tools';
import { agentFrequencySet, agentPause, agentResume, agentStatus } from '../src/agentControl.js';

/**
 * THE KILL SWITCH.
 *
 * `policy.ts` rule 1 has denied paused agents since P1, and nothing could set
 * the flag — so the field was permanently undefined and the only way to stop a
 * misbehaving agent was killing the process. These tests are mostly about the
 * end-to-end property: that clicking Pause actually reaches the policy engine.
 */

function store(initial: Partial<BrandGovernance> = {}): BrandGovernanceStore {
  let row: BrandGovernance = {
    brandId: 'brand_1',
    name: 'Emeka Cuts',
    approvalMode: 'autopublish',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    agentPaused: false,
    postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
    ...initial,
  };
  return {
    get: async () => row,
    setApprovalMode: async (_b, _o, mode) => ((row = { ...row, approvalMode: mode }), row),
    setFrequency: async ({ postsPerWeek }) => ((row = { ...row, postsPerWeek }), row),
    setAgentPaused: async ({ paused, by, reason }) => {
      row = paused
        ? { ...row, agentPaused: true, pausedAt: new Date(), pausedBy: by, ...(reason ? { pauseReason: reason } : {}) }
        // Spread the existing row and drop the pause fields, rather than
        // rebuilding a literal — a hand-listed literal silently omits every
        // field added to `BrandGovernance` after it was written.
        : (() => {
            const { pausedAt: _a, pausedBy: _b, pauseReason: _c, ...rest } = row;
            return { ...rest, agentPaused: false };
          })();
      return row;
    },
    setPolicy: async () => row,
    setGovernance: async () => row,
  };
}

const ctx = (brands: BrandGovernanceStore, over: Partial<ToolCtx> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    brandId: 'brand_1',
    userId: 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { brands } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

describe('the registry contract', () => {
  it('pause and resume are human_only — the agent never touches its own kill switch', () => {
    // An agent that could unpause itself mid-run would make the control
    // decorative; this is the line that forecloses it.
    expect(agentPause.autonomy).toBe('human_only');
    expect(agentResume.autonomy).toBe('human_only');
  });

  it('pausing is available to more roles than resuming', () => {
    // Stopping something that looks wrong should be the least gated action in
    // the product. Restarting it deserves a second thought.
    expect(agentPause.scopes).toContain('editor');
    expect(agentResume.scopes).not.toContain('editor');
  });

  it('status is readable by everyone, including the agent', () => {
    expect(agentStatus.effect).toBe('read');
    expect(agentStatus.scopes).toContain('client');
  });

  it('status reports the current frequency, not just pause state — the Command Center needs a value to show before it sets one', async () => {
    const out = await agentStatus.handler({}, ctx(store({ postsPerWeek: 5 })));
    expect(out.postsPerWeek).toBe(5);
  });
});

describe('pause / resume', () => {
  it('records who paused it and why', async () => {
    const s = store();
    const out = await agentPause.handler({ reason: 'Posting off-brand copy' }, ctx(s));

    expect(out.paused).toBe(true);
    expect(out.pausedBy).toBe('user_owner');
    expect(out.reason).toBe('Posting off-brand copy');
    // Plain language, because this renders on a stop button someone just hit.
    expect(out.effect).toMatch(/cannot publish/i);
  });

  it('clears the pause metadata on resume', async () => {
    // A stale "paused by X three weeks ago" sitting next to a running agent is
    // worse than no metadata — it makes people doubt the status display.
    const s = store();
    await agentPause.handler({ reason: 'checking' }, ctx(s));
    const out = await agentResume.handler({}, ctx(s));

    expect(out.paused).toBe(false);
    expect(out.pausedBy).toBeUndefined();
    expect(out.reason).toBeUndefined();
  });

  it('is idempotent — pausing twice is still paused', async () => {
    const s = store();
    await agentPause.handler({}, ctx(s));
    const second = await agentPause.handler({}, ctx(s));
    expect(second.paused).toBe(true);
    expect(agentPause.idempotent).toBe(true);
  });

  it('refuses without an attributable person', async () => {
    // `human_only` already blocks the agent, but a session with no user id
    // would leave the audit trail unable to say who stopped the agent.
    await expect(agentPause.handler({}, ctx(store(), { userId: undefined }))).rejects.toThrow(ToolError);
  });

  it('refuses without a brand — the switch is per brand, not per org', async () => {
    // An agency freezing all forty clients because one misbehaved is not a
    // kill switch, it is an outage.
    await expect(agentPause.handler({}, ctx(store(), { brandId: undefined }))).rejects.toThrow(ToolError);
  });
});

describe('the switch actually reaches the policy engine', () => {
  const publishCall = (agentPaused: boolean) => ({
    tool: { name: 'publish.now', effect: 'publish' as const, autonomy: 'auto' as const, scopes: ['owner' as const] },
    caller: 'agent' as const,
    role: 'owner' as const,
    now: new Date('2026-08-15T12:00:00Z'),
    brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' as const, agentPaused },
    budget: { remainingCents: 10_000, estimatedCents: 0 },
  });

  it('a paused brand denies an agent publish', async () => {
    // The end-to-end property. Everything else is plumbing toward this.
    const s = store();
    await agentPause.handler({ reason: 'stop' }, ctx(s));
    const g = await s.get('brand_1', 'org_1');

    const decision = evaluate(publishCall(g.agentPaused));
    expect(decision.kind).toBe('deny');
    expect(decision.kind === 'deny' && decision.ruleId).toBe('agent.paused');
  });

  it('and allows it again after resume', async () => {
    const s = store();
    await agentPause.handler({}, ctx(s));
    await agentResume.handler({}, ctx(s));
    const g = await s.get('brand_1', 'org_1');

    expect(evaluate(publishCall(g.agentPaused))).toEqual({ kind: 'allow' });
  });

  it('leaves reads working while paused', async () => {
    // Someone investigating why they paused the agent needs the Timeline, the
    // calendar and the queue to still load. Pausing stops the agent acting,
    // not the owner looking.
    const s = store();
    await agentPause.handler({}, ctx(s));
    const g = await s.get('brand_1', 'org_1');

    const read = { ...publishCall(g.agentPaused), tool: { ...publishCall(g.agentPaused).tool, effect: 'read' as const } };
    expect(evaluate(read)).toEqual({ kind: 'allow' });
  });

  it('does not block a human, only the agent', async () => {
    // The switch stops unattended action. A person deliberately clicking
    // publish is not what anyone paused the agent to prevent.
    const s = store();
    await agentPause.handler({}, ctx(s));
    const g = await s.get('brand_1', 'org_1');

    expect(evaluate({ ...publishCall(g.agentPaused), caller: 'user' }).kind).not.toBe('deny');
  });
});

describe('agent.frequency.set', () => {
  /**
   * Frequency is how loud the account is; pause is whether it speaks at all.
   * Keeping them distinct is what lets an owner turn the volume down without
   * discovering later that they also stopped the agent.
   */
  it('sets the cadence and reports the change', async () => {
    const s = store({ postsPerWeek: 3 });
    const out = await agentFrequencySet.handler({ postsPerWeek: 5 }, ctx(s));

    expect(out.postsPerWeek).toBe(5);
    expect(out.why.summary).toMatch(/3 → 5/);
    expect(out.why.factors).toContainEqual({ label: 'was', detail: '3/week' });
  });

  it('names pausing as the rejected alternative when turning down', async () => {
    // The mistake people actually make: turning the number down when they mean
    // stop. Invariant 4 says name the option that was not taken.
    const s = store({ postsPerWeek: 7 });
    const out = await agentFrequencySet.handler({ postsPerWeek: 1 }, ctx(s));

    expect(out.why.alternatives?.[0]?.option).toMatch(/pause/i);
  });

  it('offers no alternative when turning up — there is no confusion to resolve', async () => {
    const s = store({ postsPerWeek: 2 });
    const out = await agentFrequencySet.handler({ postsPerWeek: 6 }, ctx(s));
    expect(out.why.alternatives).toEqual([]);
  });

  it('rejects zero — that is agent.pause, and encoding "off" twice is a bug source', () => {
    // A running agent set to post nothing reads as broken on the Command Center.
    expect(agentFrequencySet.input.safeParse({ postsPerWeek: 0 }).success).toBe(false);
    expect(agentFrequencySet.input.safeParse({ postsPerWeek: 1 }).success).toBe(true);
  });

  it('caps at twice a day', () => {
    // Past this the mix engine fills every extra slot by repeating a format —
    // the exact failure the calendar's spacing floor exists to prevent.
    expect(agentFrequencySet.input.safeParse({ postsPerWeek: 15 }).success).toBe(false);
    expect(agentFrequencySet.input.safeParse({ postsPerWeek: 14 }).success).toBe(true);
    expect(agentFrequencySet.input.safeParse({ postsPerWeek: 3.5 }).success).toBe(false);
  });

  it('is auto, unlike the kill switch', () => {
    // SPARK lowering the cadence because the Asset Graph cannot supply the
    // current one is the judgement the product exists to make. Pausing is a
    // safety control and stays human_only.
    expect(agentFrequencySet.autonomy).toBe('auto');
    expect(agentPause.autonomy).toBe('human_only');
  });

  it('does not touch the pause state', async () => {
    // The separation, asserted rather than assumed.
    const s = store();
    await agentPause.handler({ reason: 'checking' }, ctx(s));
    await agentFrequencySet.handler({ postsPerWeek: 5 }, ctx(s));

    const g = await s.get('brand_1', 'org_1');
    expect(g.agentPaused).toBe(true);
    expect(g.postsPerWeek).toBe(5);
  });

  it('needs a brand', async () => {
    await expect(agentFrequencySet.handler({ postsPerWeek: 3 }, ctx(store(), { brandId: undefined })))
      .rejects.toThrow(ToolError);
  });
});
