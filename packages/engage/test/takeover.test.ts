import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { engageTakeover } from '../src/takeover.js';

const MESSAGE = {
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'dm',
  authorHandle: '@a_follower',
  text: 'Can we talk about a partnership?',
  status: 'classified',
  category: 'sales_opportunity',
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function ctx(
  over: { messageGet?: () => Promise<unknown>; genomeId?: string; takenOver?: unknown[]; markResult?: unknown } = {},
): ToolCtx {
  const takenOver = over.takenOver ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        get: over.messageGet ?? (async () => MESSAGE),
        markEscalated: async (args: unknown) => {
          takenOver.push(args);
          return 'markResult' in over ? over.markResult : { ...MESSAGE, status: 'escalated' };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('engage.takeover', () => {
  it('flips the message to the escalated status — the same one engage.escalate uses, by design', async () => {
    const takenOver: unknown[] = [];
    const out = await engageTakeover.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ takenOver }));

    expect(takenOver[0]).toMatchObject({ id: 'msg_1', genomeId: 'gen_1', orgId: 'org_1' });
    expect(out.status).toBe('escalated');
  });

  it('is covered by engage.audit.query\'s fixed resolved-status list without a sixth status value', async () => {
    const { RESOLVED_ENGAGEMENT_STATUSES } = await import('../src/auditQuery.js');
    const out = await engageTakeover.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());
    expect(RESOLVED_ENGAGEMENT_STATUSES).toContain(out.status);
  });

  it('returns a why explaining the takeover', async () => {
    const out = await engageTakeover.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());
    expect(out.why.summary).toMatch(/human took direct control/i);
  });

  it('refuses when the message does not exist', async () => {
    const err = await engageTakeover
      .handler({ genomeId: 'gen_1', messageId: 'missing' }, ctx({ messageGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses when the store update finds nothing to update', async () => {
    const err = await engageTakeover
      .handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ markResult: undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageTakeover
      .handler({ genomeId: 'gen_evil', messageId: 'msg_1' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a write, auto, idempotent, family engage', () => {
    expect(engageTakeover.effect).toBe('write');
    expect(engageTakeover.autonomy).toBe('auto');
    expect(engageTakeover.idempotent).toBe(true);
    expect(toolFamily(engageTakeover.name)).toBe('engage');
  });
});
