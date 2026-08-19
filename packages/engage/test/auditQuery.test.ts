import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { engageAuditQuery, RESOLVED_ENGAGEMENT_STATUSES } from '../src/auditQuery.js';

const ROW = {
  id: 'msg_1',
  platform: 'instagram',
  kind: 'comment',
  authorHandle: '@a_follower',
  text: 'Thanks!',
  status: 'replied',
  receivedAt: new Date('2026-01-05T00:00:00Z'),
  createdAt: new Date('2026-01-05T00:00:00Z'),
};

function ctx(over: { genomeId?: string; auditArgs?: unknown[]; rows?: unknown[] } = {}): ToolCtx {
  const auditArgs = over.auditArgs ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        audit: async (genomeId: string, orgId: string, args: unknown) => {
          auditArgs.push({ genomeId, orgId, ...(args as object) });
          return over.rows ?? [ROW];
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('engage.audit.query', () => {
  it('queries the fixed resolved-status set — replied, auto_handled, escalated, dismissed, converted', async () => {
    const auditArgs: unknown[] = [];
    await engageAuditQuery.handler({ genomeId: 'gen_1', limit: 50 }, ctx({ auditArgs }));

    expect(auditArgs[0]).toMatchObject({
      genomeId: 'gen_1',
      orgId: 'org_1',
      statuses: [...RESOLVED_ENGAGEMENT_STATUSES],
      limit: 50,
    });
    expect(RESOLVED_ENGAGEMENT_STATUSES).toEqual(['replied', 'auto_handled', 'escalated', 'dismissed', 'converted']);
  });

  it('passes since/until through as Dates when supplied', async () => {
    const auditArgs: unknown[] = [];
    await engageAuditQuery.handler(
      { genomeId: 'gen_1', since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z', limit: 50 },
      ctx({ auditArgs }),
    );

    const passed = auditArgs[0] as { since: Date; until: Date };
    expect(passed.since).toBeInstanceOf(Date);
    expect(passed.until).toBeInstanceOf(Date);
  });

  it('omits since/until when not supplied', async () => {
    const auditArgs: unknown[] = [];
    await engageAuditQuery.handler({ genomeId: 'gen_1', limit: 50 }, ctx({ auditArgs }));
    expect(auditArgs[0]).not.toHaveProperty('since');
    expect(auditArgs[0]).not.toHaveProperty('until');
  });

  it('returns the rows the store gives it, mapped to the output shape', async () => {
    const out = await engageAuditQuery.handler({ genomeId: 'gen_1', limit: 50 }, ctx());
    expect(out.items).toEqual([
      expect.objectContaining({ id: 'msg_1', platform: 'instagram', status: 'replied', authorHandle: '@a_follower' }),
    ]);
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageAuditQuery
      .handler({ genomeId: 'gen_evil', limit: 50 }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a read, open to every role including viewer/client, no why on the tool itself', () => {
    expect(engageAuditQuery.effect).toBe('read');
    expect(engageAuditQuery.scopes).toContain('viewer');
    expect(engageAuditQuery.scopes).toContain('client');
    expect(engageAuditQuery.idempotent).toBe(true);
    expect(engageAuditQuery.output.shape).not.toHaveProperty('why');
  });
});
