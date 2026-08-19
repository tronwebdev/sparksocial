import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { makeEngageAutohandle } from '../src/autohandle.js';
import type { ReplySender } from '../src/replySender.js';

const MESSAGE = {
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'comment',
  authorHandle: '@a_follower',
  text: 'What time do you open?',
  status: 'classified',
  category: 'auto_handled',
  suggestedReply: 'We open at 9am Mon-Sat!',
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function ctx(
  over: { messageGet?: () => Promise<unknown>; genomeId?: string; autoHandled?: unknown[]; markResult?: unknown } = {},
): ToolCtx {
  const autoHandled = over.autoHandled ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        get: over.messageGet ?? (async () => MESSAGE),
        markAutoHandled: async (args: unknown) => {
          autoHandled.push(args);
          return over.markResult === undefined ? { ...MESSAGE, status: 'auto_handled' } : over.markResult;
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

describe('engage.autohandle', () => {
  it('sends the message\'s own stored suggested reply, not a caller-supplied one', async () => {
    const sender = stubSender();
    const tool = makeEngageAutohandle({ sender });
    await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());

    expect(sender.send).toHaveBeenCalledWith({
      platform: 'instagram',
      kind: 'comment',
      externalId: 'ext_1',
      authorHandle: '@a_follower',
      text: 'We open at 9am Mon-Sat!',
    });
  });

  it('marks the message auto_handled, not replied, once delivery succeeds', async () => {
    const autoHandled: unknown[] = [];
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ autoHandled }));

    expect(autoHandled[0]).toMatchObject({ id: 'msg_1', genomeId: 'gen_1', orgId: 'org_1' });
    expect(out.status).toBe('auto_handled');
  });

  it('returns the delivery receipt and a why', async () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());
    expect(out).toMatchObject({ messageId: 'msg_1', externalId: 'stub_reply_1', via: 'stub' });
    expect(out.why).toBeDefined();
  });

  it('refuses a message that is not in the auto_handled category', async () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ messageGet: async () => ({ ...MESSAGE, category: 'needs_review' }) }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
  });

  it('refuses a message with no suggested reply on file', async () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ messageGet: async () => ({ ...MESSAGE, suggestedReply: undefined }) }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
  });

  it('refuses when the message does not exist', async () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'missing' }, ctx({ messageGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const err = await tool
      .handler({ genomeId: 'gen_evil', messageId: 'msg_1' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is tagged publish/non-idempotent, family engage — the shape policy.ts rule 6 keys on', () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    expect(tool.effect).toBe('publish');
    expect(tool.idempotent).toBe(false);
    expect(toolFamily(tool.name)).toBe('engage');
  });

  /**
   * Proves the claim in this tool's own file comment: tagging `autonomy:
   * 'auto'` does not skip `policy.ts` rule 6. Same real-policy-engine
   * harness `engage.reply.send`'s own test uses (see
   * `packages/engage/test/replySend.test.ts`), run against this tool's
   * declared shape instead.
   */
  it('is denied by the real policy engine until eligible, and reaches allow once eligible/configured', () => {
    const tool = makeEngageAutohandle({ sender: stubSender() });
    const base = {
      tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
      caller: 'agent' as const,
      role: 'owner' as const,
      now: new Date('2026-08-15T12:00:00Z'),
      brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' as const, agentPaused: false },
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
