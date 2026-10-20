import { describe, expect, it } from 'vitest';
import type { ContentDraft, ScopedDb, ToolCtx } from '@sparksocial/tools';
import { contentList } from '../src/list.js';

function ctx(
  over: {
    list?: ScopedDb['content']['list'];
    listRendersForItems?: ScopedDb['content']['listRendersForItems'];
  } = {},
): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get: async () => undefined,
        updateDraft: async () => undefined,
        list: over.list ?? (async () => []),
        /* Thumbnails. Defaulted to none so every existing case still describes
           a list with no media, which is what they were written against. */
        listRendersForItems: over.listRendersForItems ?? (async () => []),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const row = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'ci_1',
  genomeId: 'gen_1',
  playbookId: 'pb_text_update',
  mode: 'synthesize',
  status: 'draft',
  copy: [{ kind: 'text', beatId: 'copy', text: 'Two slots open this week for the fade.' }],
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

describe('content.list', () => {
  it('resolves the playbook name and pulls a summary from the first text beat', async () => {
    const out = await contentList.handler({ genomeId: 'gen_1', limit: 50 }, ctx({ list: async () => [row()] }));

    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      contentItemId: 'ci_1',
      playbookId: 'pb_text_update',
      playbookName: 'Text Update',
      mediaType: 'text',
      status: 'draft',
      summary: 'Two slots open this week for the fade.',
    });
  });

  it('truncates a long summary rather than dumping the whole beat', async () => {
    const longText = 'x'.repeat(200);
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({ list: async () => [row({ copy: [{ kind: 'text', beatId: 'copy', text: longText }] })] }),
    );
    expect(out.items[0]!.summary.length).toBeLessThan(100);
    expect(out.items[0]!.summary.endsWith('…')).toBe(true);
  });

  it('reads an unfilled slot (no copy yet) as "(no copy yet)", not an error', async () => {
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({ list: async () => [row({ copy: undefined })] }),
    );
    expect(out.items[0]!.summary).toBe('(no copy yet)');
  });

  it('passes the status filter and limit straight through', async () => {
    let seen: unknown;
    const list: ScopedDb['content']['list'] = async (_genomeId, _orgId, args) => {
      seen = args;
      return [];
    };
    await contentList.handler({ genomeId: 'gen_1', status: 'scheduled', limit: 10 }, ctx({ list }));
    expect(seen).toEqual({ status: 'scheduled', limit: 10 });
  });

  it('is readable by every role, like calendar.get and content.get', () => {
    expect(contentList.scopes).toContain('client');
    expect(contentList.effect).toBe('read');
  });
});

/**
 * `5.5` — the stall reason on the list row.
 *
 * `StallNotice` has existed in `DraftPanel` since P2 and had never rendered. One
 * cause was reachability, fixed in `PlanQueue`; the other was here — `content.list`
 * returned `status` and nothing about *why*, so a list could show a `blocked`
 * badge and could not say what happened. Every stalled post looked identical from
 * the outside and had to be opened one at a time.
 */
describe('content.list — why a post stopped', () => {
  it('carries the blocked reason through to the row', async () => {
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({
        list: async () => [
          row({
            status: 'blocked',
            blockedReason: 'Publishing failed 5 times and has stopped retrying.',
            publishAttempts: 5,
          }),
        ],
      }),
    );
    expect(out.items[0]).toMatchObject({
      status: 'blocked',
      blockedReason: 'Publishing failed 5 times and has stopped retrying.',
      publishAttempts: 5,
    });
  });

  it('carries it for needs_review too — one column, both states', async () => {
    // `markContentNeedsReview` reuses `blocked_reason`, deliberately: both states
    // answer the same question a person opening a stalled item asks.
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({ list: async () => [row({ status: 'needs_review', blockedReason: 'Waiting for approval: guardrail flagged.' })] }),
    );
    expect(out.items[0]).toMatchObject({
      status: 'needs_review',
      blockedReason: 'Waiting for approval: guardrail flagged.',
    });
  });

  it('leaves both absent on an ordinary post rather than sending nulls', async () => {
    // An absent field is how the panel decides whether to show a reason at all;
    // an empty string would render a blank line under every healthy row.
    const out = await contentList.handler({ genomeId: 'gen_1', limit: 50 }, ctx({ list: async () => [row()] }));
    expect(out.items[0]).not.toHaveProperty('blockedReason');
    expect(out.items[0]).not.toHaveProperty('publishAttempts');
  });

  it('omits publishAttempts at zero — "tried 0 times" is not a reason', async () => {
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({ list: async () => [row({ status: 'needs_review', publishAttempts: 0 })] }),
    );
    expect(out.items[0]).not.toHaveProperty('publishAttempts');
  });
});

/**
 * The thumbnail reaches the row, not merely the helper.
 *
 * `thumbnailFor` has its own tests, and a helper passing while nothing calls
 * it is a real failure mode in this repo — `fullSizeLogo` did exactly that in
 * `brandKit.ts` an hour before this was written, with both suites green. So
 * these go through `contentList.handler` and read the field off the item.
 */
describe('content.list thumbnails', () => {
  const render = (aspect: string, storageUrl: string) => ({
    id: 'r_1',
    contentItemId: 'ci_1',
    aspect,
    storageUrl,
    engine: 'remotion',
    costCents: 0,
    createdAt: new Date(),
  });

  it('puts the vertical render on the row', async () => {
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({
        list: async () => [row()],
        listRendersForItems: async () => [
          render('1:1', 'https://r2.test/square.png'),
          render('9:16', 'https://r2.test/tall.png'),
        ],
      }),
    );

    expect(out.items[0]).toMatchObject({ thumbnailUrl: 'https://r2.test/tall.png' });
  });

  it('matches renders to their own item, not to the first row', async () => {
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({
        list: async () => [row({ id: 'ci_1' }), row({ id: 'ci_2' })],
        listRendersForItems: async () => [{ ...render('9:16', 'https://r2.test/second.png'), contentItemId: 'ci_2' }],
      }),
    );

    // The render belongs to the second row. Keying the map by item id is what
    // stops it being painted onto every cell in the month.
    expect(out.items[0]).not.toHaveProperty('thumbnailUrl');
    expect(out.items[1]).toMatchObject({ thumbnailUrl: 'https://r2.test/second.png' });
  });

  it('omits the field entirely for a slot with nothing to show', async () => {
    const out = await contentList.handler({ genomeId: 'gen_1', limit: 50 }, ctx({ list: async () => [row()] }));
    expect(out.items[0]).not.toHaveProperty('thumbnailUrl');
  });

  /*
   * The list is what the calendar is built from. Losing a month of posts
   * because a render lookup failed would be a bad trade for a picture.
   */
  it('still returns the posts when the render read fails', async () => {
    const out = await contentList.handler(
      { genomeId: 'gen_1', limit: 50 },
      ctx({
        list: async () => [row()],
        listRendersForItems: async () => { throw new Error('renders table unavailable'); },
      }),
    );

    expect(out.items).toHaveLength(1);
    expect(out.items[0]).not.toHaveProperty('thumbnailUrl');
  });
});
