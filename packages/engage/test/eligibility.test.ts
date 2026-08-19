import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { engageEligibilityCheck, MIN_DAYS_SINCE_START, MIN_PUBLISHED_POSTS } from '../src/eligibility.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function ctx(over: {
  genomeId?: string;
  campaignGet?: () => Promise<unknown>;
  slots?: Array<{ status: string }>;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      campaigns: {
        get: over.campaignGet ?? (async () => ({ id: 'cmp_1', genomeId: 'gen_1', name: 'Launch', objective: 'leads', windowDays: 30, startAt: daysAgo(20), status: 'active', plan: {} })),
        slots: async () => over.slots ?? Array.from({ length: 6 }, () => ({ status: 'published' })),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('engage.eligibility.check', () => {
  it('is eligible once both the time and volume thresholds clear', async () => {
    const out = await engageEligibilityCheck.handler({ genomeId: 'gen_1', campaignId: 'cmp_1' }, ctx());
    expect(out.eligible).toBe(true);
    expect(out.publishedCount).toBe(6);
    expect(out.daysSinceStart).toBeGreaterThanOrEqual(MIN_DAYS_SINCE_START);
  });

  it('is ineligible when the campaign is too new, even with enough published posts', async () => {
    const out = await engageEligibilityCheck.handler(
      { genomeId: 'gen_1', campaignId: 'cmp_1' },
      ctx({ campaignGet: async () => ({ id: 'cmp_1', genomeId: 'gen_1', name: 'x', objective: 'leads', windowDays: 30, startAt: daysAgo(2), status: 'active', plan: {} }) }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reason).toContain('days since');
  });

  it('is ineligible when too new AND under-published, even at exactly the day threshold', async () => {
    const out = await engageEligibilityCheck.handler(
      { genomeId: 'gen_1', campaignId: 'cmp_1' },
      ctx({
        campaignGet: async () => ({ id: 'cmp_1', genomeId: 'gen_1', name: 'x', objective: 'leads', windowDays: 30, startAt: daysAgo(MIN_DAYS_SINCE_START), status: 'active', plan: {} }),
        slots: [{ status: 'published' }],
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.publishedCount).toBe(1);
    expect(out.reason).toContain(`${MIN_PUBLISHED_POSTS}`);
  });

  it('only counts published slots toward the volume threshold', async () => {
    const out = await engageEligibilityCheck.handler(
      { genomeId: 'gen_1', campaignId: 'cmp_1' },
      ctx({ slots: [{ status: 'published' }, { status: 'scheduled' }, { status: 'draft' }] }),
    );
    expect(out.publishedCount).toBe(1);
    expect(out.eligible).toBe(false);
  });

  it('carries a structured why with both factors', async () => {
    const out = await engageEligibilityCheck.handler({ genomeId: 'gen_1', campaignId: 'cmp_1' }, ctx());
    expect(out.why.factors).toHaveLength(2);
  });

  it('refuses when the campaign does not exist', async () => {
    const err = await engageEligibilityCheck
      .handler({ genomeId: 'gen_1', campaignId: 'missing' }, ctx({ campaignGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a campaign belonging to a different genome', async () => {
    const err = await engageEligibilityCheck
      .handler(
        { genomeId: 'gen_1', campaignId: 'cmp_1' },
        ctx({ campaignGet: async () => ({ id: 'cmp_1', genomeId: 'gen_other', name: 'x', objective: 'leads', windowDays: 30, startAt: daysAgo(20), status: 'active', plan: {} }) }),
      )
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageEligibilityCheck
      .handler({ genomeId: 'gen_evil', campaignId: 'cmp_1' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a read, open to every role including viewer/client', () => {
    expect(engageEligibilityCheck.effect).toBe('read');
    expect(engageEligibilityCheck.scopes).toContain('viewer');
    expect(engageEligibilityCheck.scopes).toContain('client');
  });
});
