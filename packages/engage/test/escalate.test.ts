import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { engageEscalate } from '../src/escalate.js';

const MESSAGE = {
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'comment',
  authorHandle: '@a_follower',
  text: 'This is unacceptable, I want a refund now.',
  status: 'classified',
  category: 'needs_review',
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const GENOME = { workspace_id: 'brand_1', identity: { business_name: 'Emeka Cuts' } };

function ctx(
  over: {
    messageGet?: () => Promise<unknown>;
    genomeGet?: () => Promise<unknown>;
    genomeId?: string;
    notified?: unknown[];
    escalated?: unknown[];
    markResult?: unknown;
  } = {},
): ToolCtx {
  const notified = over.notified ?? [];
  const escalated = over.escalated ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        get: over.messageGet ?? (async () => MESSAGE),
        markEscalated: async (args: unknown) => {
          escalated.push(args);
          return over.markResult === undefined ? { ...MESSAGE, status: 'escalated' } : over.markResult;
        },
      },
      genomes: { get: over.genomeGet ?? (async () => GENOME) },
      humanLoop: {
        create: async (args: unknown) => {
          notified.push(args);
          return { id: 'msg_human_1', brandId: 'brand_1', kind: 'notify', body: '', urgency: 'normal', createdAt: new Date() };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('engage.escalate', () => {
  it('notifies the owner through humanLoop with the reason', async () => {
    const notified: unknown[] = [];
    await engageEscalate.handler({ genomeId: 'gen_1', messageId: 'msg_1', reason: 'Hostile tone, needs a human.' }, ctx({ notified }));

    expect(notified[0]).toMatchObject({ brandId: 'brand_1', orgId: 'org_1', kind: 'notify' });
    expect((notified[0] as { body: string }).body).toContain('Hostile tone, needs a human.');
  });

  it('marks the message escalated', async () => {
    const escalated: unknown[] = [];
    const out = await engageEscalate.handler({ genomeId: 'gen_1', messageId: 'msg_1', reason: 'Ambiguous.' }, ctx({ escalated }));

    expect(escalated[0]).toMatchObject({ id: 'msg_1', genomeId: 'gen_1', orgId: 'org_1' });
    expect(out.status).toBe('escalated');
    expect(out.notified).toBe(true);
  });

  it('returns a why explaining the escalation', async () => {
    const out = await engageEscalate.handler({ genomeId: 'gen_1', messageId: 'msg_1', reason: 'Legal threat.' }, ctx());
    expect(out.why.summary).toContain('Legal threat.');
  });

  it('refuses when the message does not exist', async () => {
    const err = await engageEscalate
      .handler({ genomeId: 'gen_1', messageId: 'missing', reason: 'x' }, ctx({ messageGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses when the genome does not exist', async () => {
    const err = await engageEscalate
      .handler({ genomeId: 'gen_1', messageId: 'msg_1', reason: 'x' }, ctx({ genomeGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageEscalate
      .handler({ genomeId: 'gen_evil', messageId: 'msg_1', reason: 'x' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a write, auto, idempotent, family engage — not gated by policy.ts rule 6 (only publish is)', () => {
    expect(engageEscalate.effect).toBe('write');
    expect(engageEscalate.autonomy).toBe('auto');
    expect(engageEscalate.idempotent).toBe(true);
    expect(toolFamily(engageEscalate.name)).toBe('engage');
  });
});
