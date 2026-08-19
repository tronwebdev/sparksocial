import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeEngageReplyDraft } from '../src/replyDraft.js';
import type { ReplyWriter } from '../src/replyWriter.js';

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

const GENOME = { identity: { business_name: 'Emeka Cuts', category: 'barbershop', one_liner: 'fades done right' }, voice: {} };

function ctx(
  over: { message?: unknown; messageGet?: () => Promise<unknown>; genomeGet?: () => Promise<unknown>; genomeId?: string } = {},
): ToolCtx {
  return {
    orgId: 'org_1',
    ...(over.genomeId ? { genomeId: over.genomeId } : {}),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      engagement: {
        get: over.messageGet ?? (async () => over.message ?? MESSAGE),
      },
      genomes: {
        get: over.genomeGet ?? (async () => GENOME),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubWriter(): ReplyWriter & { write: ReturnType<typeof vi.fn> } {
  return { write: vi.fn(async () => 'A fresh, brand-voiced reply.') };
}

describe('engage.reply.draft', () => {
  it('reuses the classifier-suggested reply when one is on file', async () => {
    const writer = stubWriter();
    const tool = makeEngageReplyDraft({ writer });
    const out = await tool.handler(
      { genomeId: 'gen_1', messageId: 'msg_1', regenerate: false },
      ctx({ message: { ...MESSAGE, suggestedReply: 'Book with us any time!' } }),
    );

    expect(out.text).toBe('Book with us any time!');
    expect(out.source).toBe('suggested');
    expect(writer.write).not.toHaveBeenCalled();
    expect(out.why).toBeDefined();
  });

  it('asks the writer for a fresh draft when nothing is on file', async () => {
    const writer = stubWriter();
    const tool = makeEngageReplyDraft({ writer });
    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1', regenerate: false }, ctx({ message: MESSAGE }));

    expect(writer.write).toHaveBeenCalledWith({
      genome: GENOME,
      kind: 'comment',
      authorHandle: '@a_follower',
      messageText: 'How much does a haircut cost?',
    });
    expect(out.text).toBe('A fresh, brand-voiced reply.');
    expect(out.source).toBe('generated');
  });

  it('regenerates instead of reusing a suggestion when asked', async () => {
    const writer = stubWriter();
    const tool = makeEngageReplyDraft({ writer });
    const out = await tool.handler(
      { genomeId: 'gen_1', messageId: 'msg_1', regenerate: true },
      ctx({ message: { ...MESSAGE, suggestedReply: 'Old suggestion' } }),
    );

    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(out.source).toBe('generated');
    expect(out.text).toBe('A fresh, brand-voiced reply.');
  });

  it('refuses when the message does not exist', async () => {
    const tool = makeEngageReplyDraft({ writer: stubWriter() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'missing', regenerate: false }, ctx({ messageGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses when the genome does not exist and a fresh draft is needed', async () => {
    const tool = makeEngageReplyDraft({ writer: stubWriter() });
    const err = await tool
      .handler({ genomeId: 'gen_1', messageId: 'msg_1', regenerate: false }, ctx({ message: MESSAGE, genomeGet: async () => undefined }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a genome other than the one selected', async () => {
    const tool = makeEngageReplyDraft({ writer: stubWriter() });
    const err = await tool
      .handler({ genomeId: 'gen_evil', messageId: 'msg_1', regenerate: false }, ctx({ genomeId: 'gen_1' }))
      .catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('is read-effect and auto-autonomy — drafting is free to try', () => {
    const tool = makeEngageReplyDraft({ writer: stubWriter() });
    expect(tool.effect).toBe('read');
    expect(tool.autonomy).toBe('auto');
    expect(tool.idempotent).toBe(true);
  });
});
