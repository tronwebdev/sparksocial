import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  __resetRegistry,
  defineTool,
  invokeTool,
  makeApprovalDecide,
  queueReviewList,
  register,
  type InvokeDeps,
  type ToolCallRecord,
  type ToolCtx,
} from '@sparksocial/tools';
import { memoryInvokeDeps } from '../src/app.js';
import { createDevApprovalStore } from '../src/dev-approvals.js';
import { makeApprovalExecutor, withApprovalQueue } from '../src/approval-wiring.js';

/**
 * THE REVIEW QUEUE, end to end.
 *
 * The behaviour under test is the loop that was missing: a call is held by the
 * approval ladder, appears in a queue, a human decides, and — only then — the
 * original call runs. Most of these assertions are about what an approval must
 * *not* be able to do, because a queue that can be talked into running
 * something other than what was reviewed is worse than no queue.
 */

const brand = { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'review_everything' as const };

function harness() {
  const deps = memoryInvokeDeps();
  const approvals = createDevApprovalStore((id) => deps.rows.find((r) => r.id === id));
  const withQueue = withApprovalQueue(deps, (a) => approvals.enqueue(a));

  const ctx = (over: Partial<ToolCtx> = {}): ToolCtx =>
    ({
      orgId: 'org_1',
      brandId: 'brand_1',
      userId: 'user_reviewer',
      role: 'owner',
      approvalMode: 'review_everything',
      budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
      db: { approvals } as unknown as ToolCtx['db'],
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
      ...over,
    }) as unknown as ToolCtx;

  const execute = makeApprovalExecutor({
    deps: withQueue as InvokeDeps,
    loadBrandGovernance: async () => brand,
    lookupCall: async (callId, orgId) =>
      deps.rows.find((r) => r.id === callId && r.orgId === orgId) as ToolCallRecord | undefined,
  });

  return { deps, approvals, withQueue, ctx, execute };
}

/** A publish-effect tool, so `review_everything` holds it. */
function publisher() {
  let ran = 0;
  const tool = defineTool({
    name: 'test.publish',
    version: 1,
    summary: 'Held by the approval ladder.',
    input: z.object({ text: z.string() }),
    output: z.object({ posted: z.string() }),
    effect: 'publish',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    // Required of every publish tool by `defineTool` — see `PolicySubject`.
    // These tests exercise the approval ladder, not platform restrictions, so
    // there is no platform to report.
    policySubject: async () => ({}),
    async handler(input) {
      ran += 1;
      return { posted: input.text };
    },
  });
  return { tool, ran: () => ran };
}

describe('a held call reaches the queue', () => {
  beforeEach(() => __resetRegistry());

  it('gates, enqueues, and does NOT run the handler', async () => {
    const h = harness();
    const { tool, ran } = publisher();
    register(tool);

    const result = await invokeTool(
      { tool: tool.name, input: { text: 'hello' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    expect(result.status).toBe('gated');
    expect(ran()).toBe(0);

    const pending = await h.approvals.pending('org_1', 'brand_1', 25);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.tool).toBe('test.publish');
    // The queue shows the reason, so the reviewer knows what they are deciding.
    expect(pending[0]!.ruleId).toBe('approval_mode.review_everything');
  });

  it('enqueues once for a repeated hold, not twice', async () => {
    const h = harness();
    const { tool } = publisher();
    register(tool);

    const req = { tool: tool.name, input: { text: 'hello' }, caller: 'agent' as const, ctx: h.ctx(), brand };
    const a = await invokeTool(req, h.withQueue);
    // Same call id cannot repeat, but a *retry* produces a second gated row;
    // each is its own review item, which is correct — they are different calls.
    expect(a.status).toBe('gated');

    // Enqueuing the same callId twice must be a no-op.
    await h.approvals.enqueue({ callId: a.call.id, orgId: 'org_1', tool: 'test.publish' });
    expect(await h.approvals.pending('org_1', 'brand_1', 25)).toHaveLength(1);
  });

  it('does not enqueue a denial', async () => {
    // A deny has nothing to decide. Putting it in the queue would ask a human
    // to rule on something the policy engine has already refused outright.
    const h = harness();
    const { tool } = publisher();
    register(tool);

    const result = await invokeTool(
      { tool: tool.name, input: { text: 'x' }, caller: 'agent', ctx: h.ctx({ role: 'viewer' }), brand },
      h.withQueue,
    );

    expect(result.status).toBe('gated');
    expect(result.status === 'gated' && result.decision.kind).toBe('deny');
    expect(await h.approvals.pending('org_1', 'brand_1', 25)).toHaveLength(0);
  });
});

describe('approval.decide', () => {
  beforeEach(() => __resetRegistry());

  it('is human_only — an agent must never release its own held call', () => {
    // The single most important line in the feature. If SPARK could approve
    // what SPARK proposed, every approval mode would be decorative.
    const tool = makeApprovalDecide({ execute: async () => ({}) as never });
    expect(tool.autonomy).toBe('human_only');
    expect(tool.scopes).not.toContain('editor');
    expect(tool.scopes).not.toContain('viewer');
  });

  it('runs the original call on approve', async () => {
    const h = harness();
    const { tool, ran } = publisher();
    register(tool);

    const held = await invokeTool(
      { tool: tool.name, input: { text: 'ship it' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    const decide = makeApprovalDecide({ execute: h.execute });
    const out = await decide.handler({ callId: held.call.id, decision: 'approve' }, h.ctx());

    expect(ran()).toBe(1);
    expect(out.executed?.status).toBe('succeeded');
    // And it leaves the queue.
    expect(await h.approvals.pending('org_1', 'brand_1', 25)).toHaveLength(0);
  });

  it('replays the ORIGINAL input, not anything the approver supplies', async () => {
    // "Approve call X" must never become "run anything, citing call X".
    const h = harness();
    const captured: unknown[] = [];
    const tool = defineTool({
      name: 'test.publish',
      version: 1,
      summary: 'Records what it received.',
      input: z.object({ text: z.string() }),
      output: z.object({ ok: z.boolean() }),
      effect: 'publish',
      autonomy: 'auto',
      scopes: ['owner', 'admin', 'editor'],
      idempotent: true,
      policySubject: async () => ({}),
      async handler(input) {
        captured.push(input);
        return { ok: true };
      },
    });
    register(tool);

    const held = await invokeTool(
      { tool: tool.name, input: { text: 'the original' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    const decide = makeApprovalDecide({ execute: h.execute });
    // The schema has no field for input at all — this is the belt to the
    // executor's braces.
    await decide.handler(
      { callId: held.call.id, decision: 'approve' } as never,
      h.ctx(),
    );

    expect(captured).toEqual([{ text: 'the original' }]);
  });

  it('does not run anything on reject', async () => {
    const h = harness();
    const { tool, ran } = publisher();
    register(tool);

    const held = await invokeTool(
      { tool: tool.name, input: { text: 'no' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    const decide = makeApprovalDecide({ execute: h.execute });
    const out = await decide.handler({ callId: held.call.id, decision: 'reject' }, h.ctx());

    expect(ran()).toBe(0);
    expect(out.executed).toBeUndefined();
    expect(await h.approvals.pending('org_1', 'brand_1', 25)).toHaveLength(0);
  });

  it('refuses a second decision on the same item', async () => {
    // Two reviewers clicking at once must not both believe they decided, and an
    // approve must not silently overwrite a reject.
    const h = harness();
    const { tool } = publisher();
    register(tool);

    const held = await invokeTool(
      { tool: tool.name, input: { text: 'x' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    const decide = makeApprovalDecide({ execute: h.execute });
    await decide.handler({ callId: held.call.id, decision: 'approve' }, h.ctx());

    await expect(
      decide.handler({ callId: held.call.id, decision: 'reject' }, h.ctx()),
    ).rejects.toThrow();
  });

  it('refuses an approval belonging to another org', async () => {
    const h = harness();
    const { tool, ran } = publisher();
    register(tool);

    const held = await invokeTool(
      { tool: tool.name, input: { text: 'x' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    const decide = makeApprovalDecide({ execute: h.execute });
    await expect(
      decide.handler({ callId: held.call.id, decision: 'approve' }, h.ctx({ orgId: 'org_attacker' })),
    ).rejects.toThrow();
    expect(ran()).toBe(0);
  });

  it('re-runs every other policy rule — approval releases one hold, not all of them', async () => {
    // A call approved while the agent was running must still fail if the agent
    // has since been paused. The grant is narrow by construction.
    const h = harness();
    const { tool, ran } = publisher();
    register(tool);

    const held = await invokeTool(
      { tool: tool.name, input: { text: 'x' }, caller: 'agent', ctx: h.ctx(), brand },
      h.withQueue,
    );

    const paused = makeApprovalExecutor({
      deps: h.withQueue as InvokeDeps,
      loadBrandGovernance: async () => ({ ...brand, agentPaused: true }),
      lookupCall: async (callId, orgId) =>
        h.deps.rows.find((r) => r.id === callId && r.orgId === orgId) as ToolCallRecord | undefined,
    });

    const decide = makeApprovalDecide({ execute: paused });
    const out = await decide.handler({ callId: held.call.id, decision: 'approve' }, h.ctx());

    expect(ran()).toBe(0);
    expect(out.executed?.status).toBe('gated');
  });
});

describe('queue.review.list', () => {
  it('is readable by every role — a queue nobody can see is a queue that backs up', () => {
    expect(queueReviewList.scopes).toContain('viewer');
    expect(queueReviewList.scopes).toContain('client');
    expect(queueReviewList.effect).toBe('read');
  });

  it('shows only this org’s items', async () => {
    const h = harness();
    await h.approvals.enqueue({ callId: 'c1', orgId: 'org_1', brandId: 'brand_1', tool: 't' });
    await h.approvals.enqueue({ callId: 'c2', orgId: 'org_2', brandId: 'brand_1', tool: 't' });

    const mine = await queueReviewList.handler({ limit: 25 }, h.ctx());
    expect(mine.items.map((i) => i.callId)).toEqual(['c1']);
  });
});

describe('the store scopes independently of the tool', () => {
  // Both layers check the org, and a mutation removing either one is still
  // caught by the other — which is correct, and also means neither is covered
  // by the end-to-end test alone. These pin each guard on its own, so a future
  // refactor that drops one does not pass silently on the strength of the other.
  it('get() returns undefined for another org', async () => {
    const h = harness();
    await h.approvals.enqueue({ callId: 'c1', orgId: 'org_1', brandId: 'brand_1', tool: 't' });

    expect(await h.approvals.get('c1', 'org_1')).toBeDefined();
    expect(await h.approvals.get('c1', 'org_attacker')).toBeUndefined();
  });

  it('resolve() refuses for another org', async () => {
    const h = harness();
    await h.approvals.enqueue({ callId: 'c1', orgId: 'org_1', brandId: 'brand_1', tool: 't' });

    await expect(h.approvals.resolve('c1', 'org_attacker', 'approved', 'u')).rejects.toThrow();
    // And the item is untouched, so the real org can still decide it.
    expect(await h.approvals.pending('org_1', 'brand_1', 25)).toHaveLength(1);
  });
});
