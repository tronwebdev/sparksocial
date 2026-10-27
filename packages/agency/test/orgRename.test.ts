import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import { makeOrgRename } from '../src/org.js';

const ctx = (over: Partial<ToolCtx> = {}) =>
  ({
    orgId: 'org_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

function decide(tool: ReturnType<typeof makeOrgRename>, over: { caller?: string; role?: string }) {
  return evaluate({
    caller: over.caller ?? 'user',
    role: over.role ?? 'owner',
    tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
    brand: { approvalMode: 'autopublish', agentPaused: false },
    budget: { estimatedCents: 0, remainingCents: 10_000 },
  } as unknown as Parameters<typeof evaluate>[0]);
}

describe('org.rename', () => {
  it('renames the caller’s own organisation in Clerk', async () => {
    const calls: unknown[] = [];
    const clerk = {
      organizations: {
        updateOrganization: async (id: string, args: unknown) => {
          calls.push([id, args]);
          return { id, name: (args as { name: string }).name };
        },
      },
    } as any;
    const out = await makeOrgRename({ clerk }).handler({ name: 'Northside Agency' }, ctx());
    expect(out).toEqual({ orgId: 'org_1', name: 'Northside Agency' });
    // `ctx.orgId`, never an id from the input — there is no org id in the input.
    expect(calls).toEqual([['org_1', { name: 'Northside Agency' }]]);
  });

  it('refuses a name of spaces before it reaches Clerk', () => {
    const tool = makeOrgRename({ clerk: {} as any });
    expect(tool.input.safeParse({ name: '   ' }).success).toBe(false);
    expect(tool.input.parse({ name: '  Acme  ' })).toEqual({ name: 'Acme' });
  });

  it('wraps a Clerk failure as UPSTREAM_FAILED', async () => {
    const clerk = { organizations: { updateOrganization: async () => { throw new Error('Clerk 403'); } } } as any;
    await expect(makeOrgRename({ clerk }).handler({ name: 'Acme' }, ctx())).rejects.toThrow(ToolError);
  });

  it('is refused to an editor', () => {
    const tool = makeOrgRename({ clerk: {} as any });
    expect(decide(tool, { role: 'editor' }).kind).toBe('deny');
  });

  it('is refused to SPARK, even for an owner', () => {
    const tool = makeOrgRename({ clerk: {} as any });
    expect(decide(tool, { caller: 'agent' }).kind).toBe('deny');
    expect(decide(tool, {}).kind).toBe('allow');
  });
});
