import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { engageOpportunityCreate, engageOpportunityList, engageOpportunityRoute } from '../src/opportunity.js';

const MESSAGE = {
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'dm',
  authorHandle: '@a_follower',
  text: 'Interested in a bulk order for our office.',
  status: 'classified',
  category: 'sales_opportunity',
  intentScore: 0.9,
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const OPPORTUNITY = {
  id: 'opp_1',
  genomeId: 'gen_1',
  inboxItemId: 'msg_1',
  temperature: 'hot' as const,
  recommendedAction: 'Call within the hour.',
  createdAt: new Date('2026-01-02T00:00:00Z'),
};

function createCtx(
  over: { messageGet?: () => Promise<unknown>; genomeId?: string; created?: unknown[]; createResult?: unknown } = {},
): ToolCtx {
  const created = over.created ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      // A campaign on the top rung. `engage.opportunity.create` reads the rung
      // since 22 August — the handoff rule only applies on `sales_assist` — and
      // this file is about raising an opportunity, not about the rung, so it sits
      // where routing is permitted and the tests below stay about their subject.
      campaigns: {
        listForGenome: async () => [
          { id: 'camp_1', genomeId: 'gen_1', startAt: new Date(0), engagementRung: 'sales_assist' },
        ],
        slots: async () => [],
      },
      engagement: { get: over.messageGet ?? (async () => MESSAGE) },
      opportunities: {
        create: async (args: unknown) => {
          created.push(args);
          return over.createResult === undefined ? OPPORTUNITY : over.createResult;
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function routeCtx(
  over: { opportunityGet?: () => Promise<unknown>; genomeId?: string; routed?: unknown[]; routeResult?: unknown } = {},
): ToolCtx {
  const routed = over.routed ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      opportunities: {
        get: over.opportunityGet ?? (async () => OPPORTUNITY),
        route: async (args: unknown) => {
          routed.push(args);
          return over.routeResult === undefined ? { ...OPPORTUNITY, routedTo: (args as { routedTo: string }).routedTo } : over.routeResult;
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('engage.opportunity.create', () => {
  it('creates an opportunity linked to the message', async () => {
    const created: unknown[] = [];
    const out = await engageOpportunityCreate.handler(
      { genomeId: 'gen_1', messageId: 'msg_1', temperature: 'hot', recommendedAction: 'Call within the hour.' },
      createCtx({ created }),
    );

    expect(created[0]).toMatchObject({ genomeId: 'gen_1', orgId: 'org_1', inboxItemId: 'msg_1', temperature: 'hot' });
    expect(out).toMatchObject({ opportunityId: 'opp_1', messageId: 'msg_1', temperature: 'hot' });
    expect(out.why).toBeDefined();
  });

  it('refuses a message not classified sales_opportunity', async () => {
    const err = await engageOpportunityCreate
      .handler(
        { genomeId: 'gen_1', messageId: 'msg_1', temperature: 'warm', recommendedAction: 'Follow up.' },
        createCtx({ messageGet: async () => ({ ...MESSAGE, category: 'needs_review' }) }),
      )
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
  });

  it('refuses when the message does not exist', async () => {
    const err = await engageOpportunityCreate
      .handler(
        { genomeId: 'gen_1', messageId: 'missing', temperature: 'warm', recommendedAction: 'Follow up.' },
        createCtx({ messageGet: async () => undefined }),
      )
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageOpportunityCreate
      .handler(
        { genomeId: 'gen_evil', messageId: 'msg_1', temperature: 'warm', recommendedAction: 'Follow up.' },
        createCtx({ genomeId: 'gen_1' }),
      )
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is write/auto/non-idempotent, family engage — raising twice makes two real leads', () => {
    expect(engageOpportunityCreate.effect).toBe('write');
    expect(engageOpportunityCreate.autonomy).toBe('auto');
    expect(engageOpportunityCreate.idempotent).toBe(false);
    expect(toolFamily(engageOpportunityCreate.name)).toBe('engage');
  });
});

describe('engage.opportunity.list', () => {
  const RAISED = [
    {
      id: 'opp_hot',
      genomeId: 'gen_1',
      inboxItemId: 'msg_1',
      temperature: 'hot' as const,
      recommendedAction: 'Call within the hour.',
      routedTo: 'sales@emekacuts.com',
      createdAt: new Date('2026-01-03T00:00:00Z'),
      platform: 'instagram',
      authorHandle: '@a_follower',
      authorName: 'A Follower',
      messageText: 'Interested in a bulk order for our office.',
      intentScore: 0.9,
      receivedAt: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: 'opp_warm',
      genomeId: 'gen_1',
      inboxItemId: 'msg_2',
      temperature: 'warm' as const,
      recommendedAction: 'Send the price list.',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      platform: 'facebook',
      authorHandle: '@browser',
      messageText: 'What do you charge?',
    },
    {
      id: 'opp_cold',
      genomeId: 'gen_1',
      inboxItemId: 'msg_3',
      temperature: 'cold' as const,
      recommendedAction: 'Add to the newsletter.',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  function listCtx(over: { rows?: unknown[]; genomeId?: string; captured?: unknown[] } = {}): ToolCtx {
    const captured = over.captured ?? [];
    return {
      orgId: 'org_1',
      ...(over.genomeId ? { genomeId: over.genomeId } : {}),
      role: 'owner',
      approvalMode: 'autopublish',
      budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
      db: {
        opportunities: {
          listForGenome: async (...args: unknown[]) => {
            captured.push(args);
            return over.rows ?? RAISED;
          },
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    } as unknown as ToolCtx;
  }

  it('returns each lead with the message behind it', async () => {
    const out = await engageOpportunityList.handler({ genomeId: 'gen_1', limit: 25 }, listCtx());

    expect(out.items).toHaveLength(3);
    expect(out.items[0]).toMatchObject({
      opportunityId: 'opp_hot',
      messageId: 'msg_1',
      temperature: 'hot',
      routedTo: 'sales@emekacuts.com',
      authorHandle: '@a_follower',
      messageText: 'Interested in a bulk order for our office.',
      intentScore: 0.9,
    });
    expect(out.items[0]!.raisedAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('counts every temperature even when filtered to one', async () => {
    /**
     * The counts describe the whole set on purpose. Counting after the filter
     * would have the badges report the filter back to itself — "0 warm" while
     * looking at the hot ones — which reads as "there are no warm leads".
     */
    const out = await engageOpportunityList.handler(
      { genomeId: 'gen_1', limit: 25, temperature: 'hot' },
      listCtx(),
    );

    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.opportunityId).toBe('opp_hot');
    expect(out.counts).toEqual({ hot: 1, warm: 1, cold: 1 });
  });

  it('keeps a lead whose message could not be read', async () => {
    // The join is a left join: a lead nobody can render is still a lead the
    // total has to include, or the count on the tab disagrees with the list.
    const out = await engageOpportunityList.handler({ genomeId: 'gen_1', limit: 25 }, listCtx());
    const cold = out.items.find((i) => i.opportunityId === 'opp_cold');
    expect(cold).toBeDefined();
    expect(cold?.authorHandle).toBeUndefined();
    expect(cold?.recommendedAction).toBe('Add to the newsletter.');
  });

  it('passes the limit through to the store', async () => {
    const captured: unknown[] = [];
    await engageOpportunityList.handler({ genomeId: 'gen_1', limit: 5 }, listCtx({ captured }));
    expect(captured[0]).toEqual(['gen_1', 'org_1', 5]);
  });

  it('is empty rather than broken for a brand with no leads', async () => {
    const out = await engageOpportunityList.handler({ genomeId: 'gen_1', limit: 25 }, listCtx({ rows: [] }));
    expect(out.items).toEqual([]);
    expect(out.counts).toEqual({ hot: 0, warm: 0, cold: 0 });
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageOpportunityList
      .handler({ genomeId: 'gen_evil', limit: 25 }, listCtx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a free read every role can make, family engage', () => {
    expect(engageOpportunityList.effect).toBe('read');
    expect(engageOpportunityList.autonomy).toBe('auto');
    expect(engageOpportunityList.idempotent).toBe(true);
    expect(toolFamily(engageOpportunityList.name)).toBe('engage');
    // Same scopes as `engage.list` — reading the judgement is not gated tighter
    // than reading the message it was made about.
    expect(engageOpportunityList.scopes).toEqual(engageOpportunityCreate.scopes.concat(['approver', 'viewer', 'client']));
  });
});

describe('engage.opportunity.route', () => {
  it('routes an existing opportunity to a destination', async () => {
    const routed: unknown[] = [];
    const out = await engageOpportunityRoute.handler(
      { genomeId: 'gen_1', opportunityId: 'opp_1', routedTo: 'sales@emekacuts.com' },
      routeCtx({ routed }),
    );

    expect(routed[0]).toMatchObject({ id: 'opp_1', genomeId: 'gen_1', orgId: 'org_1', routedTo: 'sales@emekacuts.com' });
    expect(out).toMatchObject({ opportunityId: 'opp_1', routedTo: 'sales@emekacuts.com' });
    expect(out.why).toBeDefined();
  });

  it('refuses when the opportunity does not exist', async () => {
    const err = await engageOpportunityRoute
      .handler({ genomeId: 'gen_1', opportunityId: 'missing', routedTo: 'x' }, routeCtx({ opportunityGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageOpportunityRoute
      .handler({ genomeId: 'gen_evil', opportunityId: 'opp_1', routedTo: 'x' }, routeCtx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is write/auto/idempotent, family engage — re-routing just updates the destination', () => {
    expect(engageOpportunityRoute.effect).toBe('write');
    expect(engageOpportunityRoute.autonomy).toBe('auto');
    expect(engageOpportunityRoute.idempotent).toBe(true);
    expect(toolFamily(engageOpportunityRoute.name)).toBe('engage');
  });
});
