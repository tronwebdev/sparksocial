import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import {
  contentPublishPayload,
  mediaUrls,
  referencedAssetIds,
  withLink,
  writtenText,
} from '../src/publishPayload.js';

/**
 * `content.publish_payload` — what actually goes out when a post is published.
 *
 * This exists so there is exactly one answer to that question. The publish
 * scheduler had the only copy of the rule, so the Plan Queue's "Send now" could
 * not be built without either a second copy in the browser — free to drift, and
 * the failure would be a post going out *differently* depending on whether a
 * person or the clock sent it — or a tool to ask. The scheduler now calls the
 * same three functions tested below.
 */

function ctx(item: unknown): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { content: { get: async () => item } },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

/*
 * A fully valid beat array, `role` and `caption` included.
 *
 * Worth stating because omitting them did not produce a partial result: the
 * handler parses the whole array as one discriminated union, so a single
 * malformed beat drops *every* beat and the post reads as having no copy at
 * all. The first version of this fixture left them off and the failure arrived
 * as "This post has no written copy yet", which is true of the parsed array and
 * says nothing about the asset beat that caused it.
 */
const beats = [
  { kind: 'text', beatId: 'hook', text: 'First line.' },
  { kind: 'asset', beatId: 'proof', assetId: 'as_1', role: 'product_shot', caption: null },
  { kind: 'text', beatId: 'cta', text: 'Second line.' },
  { kind: 'generated_image', beatId: 'b', url: 'https://cdn.example/a.png', prompt: 'p' },
];

const item = {
  id: 'c_1',
  playbookId: 'pb_voice_over_broll',
  platform: 'instagram',
  status: 'scheduled',
  copy: beats,
};

const input = { contentItemId: 'c_1', genomeId: 'gen_1' };

describe('withLink — a recipe post carries its CTA', () => {
  it('puts the link on its own line after the caption', () => {
    expect(withLink('Fresh roast today.', 'https://brand.com/book')).toBe('Fresh roast today.' + String.fromCharCode(10, 10) + 'https://brand.com/book');
  });

  it('does not add a link the caption already carries, or one that is not there', () => {
    expect(withLink('Book at https://brand.com/book now', 'https://brand.com/book')).toBe('Book at https://brand.com/book now');
    expect(withLink('Caption', null)).toBe('Caption');
    expect(withLink('Caption', '  ')).toBe('Caption');
  });
});

describe('the assembly rule', () => {
  it('joins text beats in order, blank line between, and nothing else', () => {
    expect(writtenText(beats as never)).toBe('First line.\n\nSecond line.');
  });

  it('takes asset ids from asset beats only', () => {
    expect(referencedAssetIds(beats as never)).toEqual(['as_1']);
  });

  it('takes urls from generated media beats only', () => {
    expect(mediaUrls(beats as never)).toEqual(['https://cdn.example/a.png']);
  });

  /*
   * Auto-illustration attaches a backdrop *behind* a text beat for the
   * renderer, and `compose.render` turns the whole post into one file.
   * Publishing the backdrop as a separate attachment would post the raw b-roll
   * beside the finished video.
   */
  it('ignores a backdrop attached to a text beat', () => {
    const withBackdrop = [
      { kind: 'text', beatId: 'hook', text: 'Words.', backdrop: { kind: 'video', urls: ['https://cdn.example/b.mp4'] } },
    ];
    expect(mediaUrls(withBackdrop as never)).toEqual([]);
    expect(writtenText(withBackdrop as never)).toBe('Words.');
  });
});

describe('content.publish_payload', () => {
  it('reads only — publishing is a separate, guarded call', () => {
    expect(contentPublishPayload.effect).toBe('read');
  });

  it('returns exactly what publish.now takes', async () => {
    const out = await contentPublishPayload.handler(input, ctx(item));

    expect(out).toMatchObject({
      contentItemId: 'c_1',
      playbookId: 'pb_voice_over_broll',
      platform: 'instagram',
      text: 'First line.\n\nSecond line.',
      referencedAssetIds: ['as_1'],
      mediaUrls: ['https://cdn.example/a.png'],
    });
  });

  it("falls back to the playbook's first platform when the post names none", async () => {
    const out = await contentPublishPayload.handler(input, ctx({ ...item, platform: undefined }));

    expect(out.platform).toBeTruthy();
    // And it says so, rather than presenting a fallback as a choice.
    expect(out.why.factors.some((f) => /not set on the post/i.test(f.detail ?? ''))).toBe(true);
  });

  it('refuses a post with no written copy rather than publishing silence', async () => {
    await expect(
      contentPublishPayload.handler(
        input,
        ctx({ ...item, copy: [{ kind: 'asset', beatId: 'a', assetId: 'as_1', role: 'product_shot', caption: null }] }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses a post that is already published', async () => {
    await expect(
      contentPublishPayload.handler(input, ctx({ ...item, status: 'published' })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses when neither the post nor its playbook names an account', async () => {
    await expect(
      contentPublishPayload.handler(input, ctx({ ...item, platform: undefined, playbookId: 'pb_does_not_exist' })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses a genomeId that is not the active one', async () => {
    await expect(
      contentPublishPayload.handler({ ...input, genomeId: 'gen_OTHER' }, ctx(item)),
    ).rejects.toMatchObject({ code: 'ISOLATION_VIOLATION' });
  });

  it('refuses a post that does not exist', async () => {
    await expect(contentPublishPayload.handler(input, ctx(undefined))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
