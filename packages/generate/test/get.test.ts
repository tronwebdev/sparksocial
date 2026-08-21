import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { contentGet } from '../src/get.js';

function ctx(over: { get?: ScopedDb['content']['get'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get:
          over.get ??
          (async () => ({
            id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_text_update', mode: 'synthesize',
            status: 'draft', copy: [{ kind: 'text', beatId: 'copy', text: 'Two slots open this week.' }],
            why: { summary: 'x', factors: [], evidence: [], alternatives: [] }, createdAt: new Date(),
          })),
        updateDraft: async () => undefined,
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('content.get', () => {
  it('reads back a draft with its resolved beats', async () => {
    const out = await contentGet.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, ctx());
    expect(out.playbookId).toBe('pb_text_update');
    expect(out.beats).toEqual([{ kind: 'text', beatId: 'copy', text: 'Two slots open this week.' }]);
  });

  it('404s for a missing or out-of-scope draft', async () => {
    await expect(
      contentGet.handler({ contentItemId: 'ci_x', genomeId: 'gen_1' }, ctx({ get: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('an unfilled calendar slot reads as an empty beat list, not a parse error', async () => {
    const out = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({ get: async () => ({
        id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_offer_announcement', mode: 'assemble',
        status: 'scheduled', copy: undefined, createdAt: new Date(),
      }) }),
    );
    expect(out.beats).toEqual([]);
    expect(out.status).toBe('scheduled');
  });

  it('carries the stall reason and the retry count, so a UI can explain a stopped post', async () => {
    // §10's retry flow at the reading end. Before this the only record of why a
    // scheduled post stopped was a server log line, and the person who has to
    // fix it is looking at a screen.
    const out = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({ get: async () => ({
        id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_text_update', mode: 'synthesize',
        status: 'blocked', copy: [], createdAt: new Date(),
        blockedReason: 'Publishing failed 5 times and has stopped retrying.',
        publishAttempts: 5, lastPublishError: 'UPSTREAM_FAILED: token expired',
      }) }),
    );
    expect(out.status).toBe('blocked');
    expect(out.blockedReason).toContain('stopped retrying');
    expect(out.publishAttempts).toBe(5);
    expect(out.lastPublishError).toContain('token expired');
  });

  it('reports zero attempts rather than omitting the field', async () => {
    // An absent field is indistinguishable from an older API that never carried
    // it; "tried 0 times" is a fact a UI can decide not to render.
    const out = await contentGet.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, ctx());
    expect(out.publishAttempts).toBe(0);
    expect(out.lastPublishError).toBeUndefined();
  });

  it('is readable by every role, like calendar.get', () => {
    expect(contentGet.scopes).toContain('client');
    expect(contentGet.effect).toBe('read');
  });

  it('surfaces the publish receipt for a live or rolled-back post', async () => {
    const out = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({ get: async () => ({
        id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_text_update', mode: 'synthesize',
        status: 'published', platform: 'instagram', externalId: 'ext_1', via: 'aggregator:stub',
        url: 'https://example.invalid/instagram/ext_1', copy: [], createdAt: new Date(),
      }) }),
    );
    expect(out.platform).toBe('instagram');
    expect(out.externalId).toBe('ext_1');
    expect(out.via).toBe('aggregator:stub');
    expect(out.url).toBe('https://example.invalid/instagram/ext_1');
  });
});
