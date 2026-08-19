import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeEngageClassify } from '../src/classify.js';
import type { EngagementClassifier } from '../src/classifier.js';

const MESSAGE = {
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'comment',
  authorHandle: '@a_follower',
  text: 'How much does a haircut cost?',
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  status: 'new',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const GENOME = { identity: { business_name: 'Emeka Cuts', category: 'barbershop', one_liner: 'fades done right' } };

function ctx(over: { messageGet?: () => Promise<unknown>; genomeGet?: () => Promise<unknown>; genomeId?: string; classified?: unknown[] } = {}): ToolCtx {
  const classified = over.classified ?? [];
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        get: over.messageGet ?? (async () => MESSAGE),
        classify: async (args: { category: string; intentScore: number; suggestedReply?: string }) => {
          classified.push(args);
          return { ...MESSAGE, status: 'classified', category: args.category, intentScore: args.intentScore, ...(args.suggestedReply ? { suggestedReply: args.suggestedReply } : {}) };
        },
      },
      genomes: {
        get: over.genomeGet ?? (async () => GENOME),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubClassifier(): EngagementClassifier & { classify: ReturnType<typeof vi.fn> } {
  return {
    classify: vi.fn(async () => ({
      category: 'sales_opportunity' as const,
      intentScore: 0.8,
      suggestedReply: 'Book with us!',
      reason: 'Explicit pricing question — strong buying intent.',
    })),
  };
}

describe('engage.classify', () => {
  it('passes the genome and message to the classifier', async () => {
    const classifier = stubClassifier();
    const tool = makeEngageClassify({ classifier });
    await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());

    expect(classifier.classify).toHaveBeenCalledWith({
      genome: GENOME,
      kind: 'comment',
      authorHandle: '@a_follower',
      text: 'How much does a haircut cost?',
    });
  });

  it('records the classification with a structured why', async () => {
    const classified: unknown[] = [];
    const tool = makeEngageClassify({ classifier: stubClassifier() });
    await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ classified }));

    expect(classified[0]).toMatchObject({
      id: 'msg_1',
      genomeId: 'gen_1',
      orgId: 'org_1',
      category: 'sales_opportunity',
      intentScore: 0.8,
      suggestedReply: 'Book with us!',
    });
    expect(classified[0]).toHaveProperty('why.summary');
  });

  it('returns the classification and why', async () => {
    const tool = makeEngageClassify({ classifier: stubClassifier() });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());
    expect(out).toMatchObject({ messageId: 'msg_1', category: 'sales_opportunity', intentScore: 0.8, suggestedReply: 'Book with us!' });
    expect(out.why).toBeDefined();
  });

  it('refuses when the message does not exist', async () => {
    const tool = makeEngageClassify({ classifier: stubClassifier() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'missing' }, ctx({ messageGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses when the genome does not exist', async () => {
    const tool = makeEngageClassify({ classifier: stubClassifier() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ genomeGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const tool = makeEngageClassify({ classifier: stubClassifier() });
    const err = await tool
      .handler({ genomeId: 'gen_evil', messageId: 'msg_1' }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('omits suggestedReply from the output when the classifier withholds one', async () => {
    const classifier: EngagementClassifier = {
      classify: async () => ({ category: 'needs_review', intentScore: 0.4, reason: 'Ambiguous, better for a human to answer.' }),
    };
    const tool = makeEngageClassify({ classifier });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx());
    expect(out).not.toHaveProperty('suggestedReply');
  });

  it('is idempotent — re-classifying refreshes rather than duplicating', () => {
    const tool = makeEngageClassify({ classifier: stubClassifier() });
    expect(tool.idempotent).toBe(true);
  });
});
