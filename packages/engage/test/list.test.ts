import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { engageList } from '../src/list.js';

const ROW = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'comment',
  authorHandle: '@a_follower',
  text: 'How much does a haircut cost?',
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  status: 'classified',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

function ctx(over: { genomeId?: string; list?: (...args: unknown[]) => Promise<unknown[]>; captured?: unknown[] } = {}): ToolCtx {
  const captured = over.captured ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        list: async (genomeId: string, orgId: string, args: unknown) => {
          captured.push({ genomeId, orgId, args });
          return over.list ? over.list(genomeId, orgId, args) : [ROW()];
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const input = { genomeId: 'gen_1', limit: 50 };

describe('engage.list', () => {
  it('lists messages for a genome, newest first (delegated to the store)', async () => {
    const captured: unknown[] = [];
    const out = await engageList.handler(input, ctx({ captured }));
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      id: 'msg_1',
      platform: 'instagram',
      authorHandle: '@a_follower',
      status: 'classified',
    });
    expect(captured[0]).toMatchObject({ genomeId: 'gen_1', orgId: 'org_1', args: { limit: 50 } });
  });

  it('passes a category filter through to the store', async () => {
    const captured: unknown[] = [];
    await engageList.handler({ ...input, category: 'sales_opportunity' as const }, ctx({ captured }));
    expect(captured[0]).toMatchObject({ args: { category: 'sales_opportunity', limit: 50 } });
  });

  it('does not pass a category filter when one is not given, so unclassified rows can surface', async () => {
    const captured: unknown[] = [];
    await engageList.handler(input, ctx({ captured }));
    expect(captured[0] as { args: Record<string, unknown> }).toMatchObject({ args: { limit: 50 } });
    expect((captured[0] as { args: Record<string, unknown> }).args).not.toHaveProperty('category');
  });

  it('serializes dates and omits unset optional fields', async () => {
    const out = await engageList.handler(
      input,
      ctx({ list: async () => [ROW({ category: undefined, intentScore: undefined, suggestedReply: undefined, why: undefined, authorName: undefined })] }),
    );
    expect(out.items[0]!.receivedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.items[0]).not.toHaveProperty('category');
    expect(out.items[0]).not.toHaveProperty('suggestedReply');
    expect(out.items[0]).not.toHaveProperty('why');
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageList.handler(input, ctx({ genomeId: 'gen_someone_else' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a free read, open to every scope including client and viewer', () => {
    expect(engageList.effect).toBe('read');
    expect(engageList.autonomy).toBe('auto');
    expect(engageList.scopes).toContain('viewer');
    expect(engageList.scopes).toContain('client');
    expect(engageList.idempotent).toBe(true);
  });

  it('rejects an unsupported category at the schema, before the tool runs', () => {
    expect(engageList.input.safeParse({ ...input, category: 'not_a_real_category' }).success).toBe(false);
  });
});
