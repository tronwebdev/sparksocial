import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { Explanation } from '@sparksocial/shared';
import type { RecordedCall, ToolCtx } from '@sparksocial/tools';
import { agentExplain } from '../src/explain.js';

/**
 * `agent.explain` reads a recorded decision back. The properties worth
 * defending are all about what it refuses to do: it does not compose an
 * explanation, and it does not tell you whether a call exists in someone else's
 * workspace.
 */

const WHY: Explanation = {
  summary: 'Picked the fade close-up because it is the only cleared clip under 30 days old.',
  factors: [{ label: 'assets', detail: '1 eligible' }],
  evidence: [{ kind: 'asset', id: 'asset_1' }],
  alternatives: [],
};

const call = (over: Partial<RecordedCall> = {}): RecordedCall => ({
  id: 'call_1',
  tool: 'publish.now',
  caller: 'agent',
  decision: 'allow',
  status: 'succeeded',
  costCents: 0,
  at: new Date('2026-08-11T09:00:00Z'),
  ...over,
});

const ctx = (row: RecordedCall | undefined, orgId = 'org_1'): ToolCtx =>
  ({
    orgId: 'org_1',
    brandId: 'brand_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      toolCalls: {
        get: async (id: string, org: string) => (row && row.id === id && org === orgId ? row : undefined),
      },
    } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

describe('the registry contract', () => {
  it('is a free read available to everyone, including an agency client', () => {
    // A client seeing why a post went out is the whole argument for the
    // Timeline. Gating it to staff leaves the most doubtful person with the
    // least evidence.
    expect(agentExplain.effect).toBe('read');
    expect(agentExplain.scopes).toContain('client');
    expect(agentExplain.scopes).toContain('viewer');
  });
});

describe('reading a recorded why', () => {
  it('returns the stored explanation verbatim', async () => {
    const out = await agentExplain.handler({ callId: 'call_1' }, ctx(call({ why: WHY })));

    expect(out.why).toEqual(WHY);
    expect(out.summary).toBe(WHY.summary);
    expect(out.unexplained).toBe(false);
  });

  it('never invents one', async () => {
    // The load-bearing test. An LLM could write a fluent paragraph about any
    // call from its name alone, and a plausible reconstruction is
    // indistinguishable from a real record right up until it contradicts one.
    const out = await agentExplain.handler({ callId: 'call_1' }, ctx(call({ tool: 'asset.retrieve' })));

    expect(out.why).toBeUndefined();
    expect(out.unexplained).toBe(true);
    expect(out.summary).toMatch(/without recording a decision/i);
  });
});

describe('refusals explain themselves', () => {
  it('builds an explanation from the policy outcome for a denial', async () => {
    // "Why didn't you post?" is the most-asked question and those rows carry no
    // `why` — nothing ran. `ruleId` and `reason` are the explanation.
    const out = await agentExplain.handler(
      { callId: 'call_1' },
      ctx(call({ decision: 'deny', status: 'failed', ruleId: 'agent.paused', reason: 'SPARK is paused' })),
    );

    expect(out.unexplained).toBe(false);
    expect(out.why?.summary).toMatch(/refused/i);
    // Cited, not paraphrased: "blocked by agent.paused" is checkable against
    // policy.ts in a way "SPARK decided not to" is not.
    expect(out.why?.evidence).toContainEqual(
      expect.objectContaining({ kind: 'rule', id: 'agent.paused' }),
    );
  });

  it('distinguishes held-for-approval from refused', async () => {
    const out = await agentExplain.handler(
      { callId: 'call_1' },
      ctx(call({ decision: 'approval', status: 'gated', ruleId: 'approval_mode.review_everything' })),
    );

    expect(out.summary).toMatch(/waiting for approval/i);
    expect(out.why?.alternatives?.[0]?.option).toMatch(/run it anyway/i);
  });

  it('does not treat a plain failure as a refusal', async () => {
    // An upstream timeout is not a decision. Dressing it as one would make the
    // Timeline claim SPARK chose something it did not choose.
    const out = await agentExplain.handler(
      { callId: 'call_1' },
      ctx(call({ decision: 'allow', status: 'failed', reason: 'upstream timeout' })),
    );

    expect(out.unexplained).toBe(true);
    expect(out.why).toBeUndefined();
  });
});

describe('isolation', () => {
  it('reports a call from another org as not found', async () => {
    // Indistinguishable from "no such id" on purpose: a separate error would
    // make this an oracle for enumerating another workspace's activity.
    await expect(
      agentExplain.handler({ callId: 'call_1' }, ctx(call({ why: WHY }), 'org_other')),
    ).rejects.toThrow(ToolError);
  });

  it('reports an unknown id the same way', async () => {
    await expect(agentExplain.handler({ callId: 'nope' }, ctx(call()))).rejects.toThrow(ToolError);
  });
});
