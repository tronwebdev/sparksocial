import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { makeEngageReplySend } from '../src/replySend.js';
import type { ReplySender } from '../src/replySender.js';

const MESSAGE = {
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
};

function ctx(
  over: { messageGet?: () => Promise<unknown>; genomeId?: string; replied?: unknown[]; markRepliedResult?: unknown } = {},
): ToolCtx {
  const replied = over.replied ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        get: over.messageGet ?? (async () => MESSAGE),
        markReplied: async (args: unknown) => {
          replied.push(args);
          return over.markRepliedResult === undefined ? { ...MESSAGE, status: 'replied' } : over.markRepliedResult;
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubSender(): ReplySender & { send: ReturnType<typeof vi.fn> } {
  return {
    name: 'stub',
    send: vi.fn(async () => ({ externalId: 'stub_reply_1', via: 'stub', sentAt: new Date('2026-01-02T00:00:00Z') })),
  };
}

describe('engage.reply.send', () => {
  it('sends exactly the text supplied, not a re-derived draft', async () => {
    const sender = stubSender();
    const tool = makeEngageReplySend({ sender });
    await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1', text: 'Hand-edited reply text.' }, ctx());

    expect(sender.send).toHaveBeenCalledWith({
      platform: 'instagram',
      kind: 'comment',
      externalId: 'ext_1',
      authorHandle: '@a_follower',
      text: 'Hand-edited reply text.',
    });
  });

  it('marks the message replied once delivery succeeds', async () => {
    const replied: unknown[] = [];
    const tool = makeEngageReplySend({ sender: stubSender() });
    await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1', text: 'Thanks!' }, ctx({ replied }));

    expect(replied[0]).toMatchObject({ id: 'msg_1', genomeId: 'gen_1', orgId: 'org_1' });
  });

  it('returns the delivery receipt and a why', async () => {
    const tool = makeEngageReplySend({ sender: stubSender() });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1', text: 'Thanks!' }, ctx());

    expect(out).toMatchObject({ messageId: 'msg_1', status: 'replied', externalId: 'stub_reply_1', via: 'stub' });
    expect(out.why).toBeDefined();
  });

  it('does not fail the call when the store update comes back empty — logs instead', async () => {
    const tool = makeEngageReplySend({ sender: stubSender() });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1', text: 'Thanks!' }, ctx({ markRepliedResult: undefined }));
    expect(out.status).toBe('replied'); // falls back to the literal, since the row update didn't confirm it
  });

  it('refuses when the message does not exist', async () => {
    const tool = makeEngageReplySend({ sender: stubSender() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'missing', text: 'Thanks!' }, ctx({ messageGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const tool = makeEngageReplySend({ sender: stubSender() });
    const err = await tool
      .handler({ genomeId: 'gen_evil', messageId: 'msg_1', text: 'Thanks!' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is tagged publish/confirm/non-idempotent — the shape `policy.ts` rule 6 keys on', () => {
    const tool = makeEngageReplySend({ sender: stubSender() });
    expect(tool.effect).toBe('publish');
    expect(tool.autonomy).toBe('confirm');
    expect(tool.idempotent).toBe(false);
    expect(toolFamily(tool.name)).toBe('engage');
  });

  /**
   * The registered tool's own declared shape, run through the real policy
   * engine — not a hand-copied `{ name, effect, autonomy }` fixture. Proves
   * `makeEngageReplySend`'s tags actually engage `policy.ts` rule 6
   * (`packages/tools/test/policy.test.ts`'s "6 — engagement gating" suite),
   * end to end, the way `invokeTool` would evaluate a real call.
   */
  it('is denied by the real policy engine until eligible, and reaches allow once eligible/configured for a human caller', () => {
    const tool = makeEngageReplySend({ sender: stubSender() });
    const base = {
      tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
      caller: 'user' as const,
      role: 'owner' as const,
      now: new Date('2026-08-15T12:00:00Z'),
      brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' as const },
      budget: { remainingCents: 10_000, estimatedCents: 0 },
    };

    const noEligibility = evaluate(base);
    expect(noEligibility.kind).toBe('deny');
    expect(noEligibility.kind === 'deny' && noEligibility.ruleId).toBe('engage.ineligible');

    const eligibleButUnconfigured = evaluate({ ...base, engagement: { eligible: true, autonomyConfigured: false } });
    expect(eligibleButUnconfigured.kind).toBe('approval');

    const cleared = evaluate({ ...base, engagement: { eligible: true, autonomyConfigured: true } });
    expect(cleared.kind).toBe('allow');
  });
});
