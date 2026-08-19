import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { engageOpportunityCreate, engageOpportunityRoute } from '../src/opportunity.js';

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
