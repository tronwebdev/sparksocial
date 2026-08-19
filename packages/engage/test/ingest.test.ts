import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { engageIngest } from '../src/ingest.js';

function ctx(over: { genomeId?: string; ingested?: unknown[] } = {}): ToolCtx {
  const ingested = over.ingested ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        ingest: async (args: unknown) => {
          ingested.push(args);
          return { id: 'msg_1', genomeId: 'gen_1', platform: 'instagram', externalId: 'ext_1', kind: 'comment', authorHandle: '@x', text: 'hi', receivedAt: new Date(), status: 'new', createdAt: new Date() };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const input = {
  genomeId: 'gen_1',
  platform: 'instagram' as const,
  externalId: 'ext_1',
  kind: 'comment' as const,
  authorHandle: '@a_follower',
  text: 'How much does this cost?',
};

describe('engage.ingest', () => {
  it('writes the message and returns its id and status', async () => {
    const ingested: unknown[] = [];
    const out = await engageIngest.handler(input, ctx({ ingested }));
    expect(out).toEqual({ id: 'msg_1', status: 'new' });
    expect(ingested[0]).toMatchObject({ genomeId: 'gen_1', orgId: 'org_1', platform: 'instagram', externalId: 'ext_1' });
  });

  it('refuses a genome other than the one selected', async () => {
    const err = await engageIngest
      .handler(input, ctx({ genomeId: 'gen_someone_else' }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is a plain write, callable without human approval, not open to viewers', () => {
    expect(engageIngest.effect).toBe('write');
    expect(engageIngest.autonomy).toBe('auto');
    expect(engageIngest.scopes).not.toContain('viewer');
    expect(engageIngest.scopes).not.toContain('client');
  });

  it('is idempotent — a webhook retry must not duplicate the message', () => {
    expect(engageIngest.idempotent).toBe(true);
  });

  it('refuses an unsupported platform at the schema, before the tool runs', () => {
    expect(engageIngest.input.safeParse({ ...input, platform: 'facebook' }).success).toBe(false);
  });

  it('refuses an empty message at the schema', () => {
    expect(engageIngest.input.safeParse({ ...input, text: '' }).success).toBe(false);
  });
});
