import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import type { ContentDraft } from '@sparksocial/tools/defineTool';
import { PublishError, createStubAdapter } from '../src/adapter.js';
import { makePublishRollback } from '../src/tool.js';

/**
 * `publish.rollback` reverses the one irreversible step (`publish.now`) as
 * far as it can be reversed: the platform's own delete, when the adapter
 * actually serving that platform has one. What it must never do is pretend a
 * post came down when nothing was actually deleted.
 */

const embed = { embed: async () => [0] };

const publishedItem: ContentDraft = {
  id: 'item_1',
  genomeId: 'gen_1',
  mode: 'direct_finish',
  playbookId: 'pb_craft_capture',
  status: 'published',
  createdAt: new Date(),
  platform: 'instagram',
  externalId: 'stub_instagram_1',
  via: 'aggregator:stub',
};

function fakeContentStore(item: ContentDraft | undefined) {
  const rolledBack: unknown[] = [];
  return {
    rolledBack,
    content: {
      get: async () => item,
      markRolledBack: async (args: unknown) => {
        rolledBack.push(args);
      },
    } as unknown as ToolCtx['db']['content'],
  };
}

// See `tool.test.ts`'s identical fixture for why this is merged into every
// test's `db` override rather than only the default.
const defaultOauthConnections = { get: async () => undefined };

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => {
  const { db: dbOver, ...restOver } = over;
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { oauthConnections: defaultOauthConnections, ...dbOver } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...restOver,
  } as unknown as ToolCtx;
};

const input = { contentItemId: 'item_1', genomeId: 'gen_1' };

describe('publish.rollback — registry contract', () => {
  const tool = makePublishRollback({ adapters: [createStubAdapter()], embed });

  it('declares the publish effect — same approval-ladder branch as publish.now', () => {
    expect(tool.effect).toBe('publish');
  });

  it('is not idempotent — a retried rollback must not error on an already-deleted post', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is not available to editors — only owner/admin can take a live post down', () => {
    expect(tool.scopes).toEqual(['owner', 'admin']);
  });
});

describe('publish.rollback — behaviour', () => {
  it('deletes through the routed adapter and marks the item rolled back', async () => {
    const adapter = createStubAdapter({ name: 'aggregator:test' });
    const { content, rolledBack } = fakeContentStore(publishedItem);
    const tool = makePublishRollback({ adapters: [adapter], embed });

    const out = await tool.handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }));

    expect(adapter.deleted).toEqual(['stub_instagram_1']);
    expect(rolledBack).toEqual([{ id: 'item_1', orgId: 'org_1' }]);
    expect(out.platform).toBe('instagram');
    expect(out.contentItemId).toBe('item_1');
  });

  it('refuses cleanly, naming the platform, when the adapter has no delete method', async () => {
    const adapter = createStubAdapter({ deletable: false });
    const { content } = fakeContentStore(publishedItem);
    const tool = makePublishRollback({ adapters: [adapter], embed });

    const err = await tool
      .handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }))
      .catch((e: unknown) => e as ToolError);

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).meta.platform).toBe('instagram');
  });

  it('does not call markRolledBack when the adapter has no delete method', async () => {
    const adapter = createStubAdapter({ deletable: false });
    const { content, rolledBack } = fakeContentStore(publishedItem);
    const tool = makePublishRollback({ adapters: [adapter], embed });

    await tool.handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] })).catch(() => {});
    expect(rolledBack).toHaveLength(0);
  });

  it('refuses a content item that is not published', async () => {
    const draft: ContentDraft = { ...publishedItem, status: 'draft', platform: undefined, externalId: undefined };
    const { content } = fakeContentStore(draft);
    const tool = makePublishRollback({ adapters: [createStubAdapter()], embed });

    const err = await tool
      .handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }))
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('INVALID_INPUT');
  });

  it('propagates NOT_FOUND for a missing or out-of-scope content item', async () => {
    const { content } = fakeContentStore(undefined);
    const tool = makePublishRollback({ adapters: [createStubAdapter()], embed });

    const err = await tool
      .handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }))
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('surfaces a permanent adapter delete failure as UPSTREAM_FAILED', async () => {
    const failing = {
      name: 'aggregator:failing',
      supports: () => true,
      publish: async () => {
        throw new Error('unused');
      },
      delete: async () => {
        throw new PublishError('instagram', 'post already removed', false);
      },
    };
    const { content } = fakeContentStore(publishedItem);
    const tool = makePublishRollback({ adapters: [failing], embed });

    const err = await tool
      .handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }))
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('UPSTREAM_FAILED');
  });
});
