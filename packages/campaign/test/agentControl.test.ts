import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { evaluate } from '@sparksocial/tools';
import type { BrandGovernance, BrandGovernanceStore, ToolCtx } from '@sparksocial/tools';
import { agentPause, agentResume, agentStatus } from '../src/agentControl.js';

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
    ...initial,
  };
  return {
    get: async () => row,
    setApprovalMode: async (_b, _o, mode) => ((row = { ...row, approvalMode: mode }), row),
    setAgentPaused: async ({ paused, by, reason }) => {
      row = paused
        ? { ...row, agentPaused: true, pausedAt: new Date(), pausedBy: by, ...(reason ? { pauseReason: reason } : {}) }
        : { brandId: row.brandId, name: row.name, approvalMode: row.approvalMode, createdAt: row.createdAt, agentPaused: false };
      return row;
    },
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
