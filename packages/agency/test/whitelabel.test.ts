import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { whitelabelLinkCreate } from '../src/whitelabel.js';

function ctx(db: unknown, over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: db as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('whitelabel.link.create', () => {
  it('creates an expiring calendar link', async () => {
    const creates: unknown[] = [];
    const db = { reviewLinks: { create: async (args: unknown) => { creates.push(args); return { id: 'link_1', token: 'tok_abc', brandId: 'brand_1', scope: 'calendar', createdBy: 'user_1', expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date() }; } } };
    const out = await whitelabelLinkCreate.handler({ brandId: 'brand_1', scope: 'calendar', expiresInDays: 7 }, ctx(db));
    expect(out.token).toBe('tok_abc');
    expect(creates[0]).toMatchObject({ orgId: 'org_1', brandId: 'brand_1', scope: 'calendar', createdBy: 'user_1' });
  });

  it('refuses a content_item scope with no targetId', async () => {
    await expect(whitelabelLinkCreate.handler({ brandId: 'brand_1', scope: 'content_item', expiresInDays: 7 }, ctx({}))).rejects.toThrow(ToolError);
  });

  it('is owner/admin only — a review link is a real exposure surface', () => {
    expect(whitelabelLinkCreate.scopes).toEqual(['owner', 'admin']);
  });
});
