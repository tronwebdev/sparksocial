import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { contentGet } from '../src/get.js';

function ctx(over: { get?: ScopedDb['content']['get']; renders?: Awaited<ReturnType<ScopedDb['content']['listRenders']>> } = {}): ToolCtx {
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
        // Declared on the store interface, so a fake that omits it is an
        // incomplete fake rather than a reason for the read to be defensive.
        listRenders: async () => over.renders ?? [],
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

/**
 * `playbookMissing` — the flag that turns a 404 into a sentence.
 *
 * This read has always tolerated a playbook id the library no longer has: it uses
 * the playbook only for a media-type hint and falls back to `'text'` rather than
 * failing a read over a display detail. That is right. What was missing is that
 * the caller could not *tell* — and `DraftPanel` went on to hand the same id to
 * `content.draft`, which is strict by design and answers
 * `NOT_FOUND: No playbook "…"`. Staging showed four of those on
 * `POST /api/tools/content.draft`, and an empty grey modal.
 *
 * Tolerant reads and strict writes are both correct. The read just has to say
 * which case it is in.
 */
describe('content.get — a playbook the library no longer has', () => {
  const gone = async () => ({
    id: 'ci_gone',
    genomeId: 'gen_1',
    playbookId: 'pb_does_not_exist',
    mode: 'synthesize',
    status: 'draft',
    copy: [],
    why: { summary: 'x', factors: [], evidence: [], alternatives: [] },
    createdAt: new Date(),
  });

  it('still returns the post rather than failing', async () => {
    const out = await contentGet.handler({ contentItemId: 'ci_gone', genomeId: 'gen_1' }, ctx({ get: gone as never }));
    expect(out.contentItemId).toBe('ci_gone');
    expect(out.playbookId).toBe('pb_does_not_exist');
  });

  it('says the playbook is missing', async () => {
    const out = await contentGet.handler({ contentItemId: 'ci_gone', genomeId: 'gen_1' }, ctx({ get: gone as never }));
    expect(out.playbookMissing).toBe(true);
  });

  it('falls back to a text media type rather than guessing', async () => {
    // The reason this read tolerates it at all: the playbook is consulted for a
    // display hint, and losing the hint is not worth losing the post.
    const out = await contentGet.handler({ contentItemId: 'ci_gone', genomeId: 'gen_1' }, ctx({ get: gone as never }));
    expect(out.mediaType).toBe('text');
  });

  it('reports false for a playbook that does resolve', async () => {
    // Otherwise the flag would be true for everything and the panel would refuse
    // to redraft any post at all.
    const out = await contentGet.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, ctx());
    expect(out.playbookMissing).toBe(false);
  });
});

/**
 * The Draft Panel's preview held renders in state that only a fresh
 * `compose.render` ever filled, so a post the render queue had already composed
 * reopened with no video and a Render button beside it — an offer to pay a
 * second time for a file sitting in the table. This read is where that comes
 * from now.
 */
describe('content.get — renders already made', () => {
  const render = (aspect: string, url: string, at: string) => ({
    id: url,
    contentItemId: 'ci_1',
    aspect,
    storageUrl: url,
    engine: 'remotion',
    costCents: 5,
    createdAt: new Date(at),
  });

  it('returns the files this post already has', async () => {
    const res = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({ renders: [render('9:16', 'https://cdn/a.mp4', '2026-01-02')] }),
    );

    expect(res.renders).toEqual([{ aspect: '9:16', url: 'https://cdn/a.mp4', engine: 'remotion' }]);
  });

  /**
   * A re-render adds a row rather than replacing one, so the table holds every
   * take ever made. Showing all of them would be a gallery of supplanted
   * versions; the newest of each aspect is the post as it stands.
   */
  it('keeps the newest take of each aspect and drops the supplanted ones', async () => {
    const res = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({
        renders: [
          render('9:16', 'https://cdn/new.mp4', '2026-01-03'),
          render('1:1', 'https://cdn/square.mp4', '2026-01-03'),
          render('9:16', 'https://cdn/old.mp4', '2026-01-01'),
        ],
      }),
    );

    expect(res.renders.map((r) => r.url)).toEqual(['https://cdn/new.mp4', 'https://cdn/square.mp4']);
  });

  /**
   * The one format where "one render per aspect" is the wrong rule.
   *
   * `compose.render` writes a row per slide per aspect for a carousel — six
   * rows, same aspect, differing only by `beatId`. Keying the dedupe on the
   * aspect alone kept the newest of the six and threw the rest away, so a
   * six-slide carousel read back as one image. That is exactly what the Draft
   * Panel displayed and how it was reported: "it's just showing as an image".
   */
  it('keeps every slide of a carousel, not just the newest one', async () => {
    const slide = (beatId: string, url: string, at: string) => ({ ...render('4:5', url, at), beatId });

    const res = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({
        get: async () => ({
          id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_text_update', mode: 'synthesize',
          status: 'draft',
          copy: [
            { kind: 'text', beatId: 'b1', text: 'Hook' },
            { kind: 'text', beatId: 'b2', text: 'Step' },
            { kind: 'text', beatId: 'b3', text: 'CTA' },
          ],
          why: { summary: 'x', factors: [], evidence: [], alternatives: [] }, createdAt: new Date(),
        }),
        renders: [
          slide('b3', 'https://cdn/s3.png', '2026-01-03'),
          slide('b2', 'https://cdn/s2.png', '2026-01-03'),
          slide('b1', 'https://cdn/s1.png', '2026-01-03'),
        ],
      }),
    );

    // In slide order, not newest-first — a preview that opens on the last
    // slide and counts down is not a preview of the post.
    expect(res.renders.map((r) => r.url)).toEqual([
      'https://cdn/s1.png',
      'https://cdn/s2.png',
      'https://cdn/s3.png',
    ]);
  });

  /** A re-rendered slide still replaces its own previous take, not its neighbours'. */
  it('keeps the newest take of each slide', async () => {
    const slide = (beatId: string, url: string, at: string) => ({ ...render('4:5', url, at), beatId });

    const res = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({
        get: async () => ({
          id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_text_update', mode: 'synthesize',
          status: 'draft',
          copy: [
            { kind: 'text', beatId: 'b1', text: 'Hook' },
            { kind: 'text', beatId: 'b2', text: 'CTA' },
          ],
          why: { summary: 'x', factors: [], evidence: [], alternatives: [] }, createdAt: new Date(),
        }),
        renders: [
          slide('b1', 'https://cdn/s1-new.png', '2026-01-05'),
          slide('b2', 'https://cdn/s2.png', '2026-01-03'),
          slide('b1', 'https://cdn/s1-old.png', '2026-01-01'),
        ],
      }),
    );

    expect(res.renders.map((r) => r.url)).toEqual(['https://cdn/s1-new.png', 'https://cdn/s2.png']);
  });

  /**
   * The first real re-render after the column shipped came back with seven
   * renders for six slides: the six new ones, plus the row written before
   * `beat_id` existed, which has no slide and so collided with none of them.
   * The deck read "Slide 1 of 7" with a stale duplicate at the end.
   */
  it('drops a slideless row from an aspect that now has slides', async () => {
    const slide = (beatId: string, url: string, at: string) => ({ ...render('4:5', url, at), beatId });

    const res = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({
        get: async () => ({
          id: 'ci_1', genomeId: 'gen_1', playbookId: 'pb_text_update', mode: 'synthesize',
          status: 'draft',
          copy: [
            { kind: 'text', beatId: 'b1', text: 'Hook' },
            { kind: 'text', beatId: 'b2', text: 'CTA' },
          ],
          why: { summary: 'x', factors: [], evidence: [], alternatives: [] }, createdAt: new Date(),
        }),
        renders: [
          slide('b1', 'https://cdn/s1.png', '2026-02-01'),
          slide('b2', 'https://cdn/s2.png', '2026-02-01'),
          // Written by the old renderer, before anything recorded a slide.
          render('4:5', 'https://cdn/legacy.png', '2026-01-01'),
        ],
      }),
    );

    expect(res.renders.map((r) => r.url)).toEqual(['https://cdn/s1.png', 'https://cdn/s2.png']);
  });

  /*
   * Rows written before the column existed carry no slide, and must keep
   * behaving as they did — one per aspect — rather than all surviving as
   * separate "slides" of a post that has one.
   */
  it('still collapses rows that predate the slide column', async () => {
    const res = await contentGet.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1' },
      ctx({
        renders: [
          render('4:5', 'https://cdn/legacy-new.png', '2026-01-03'),
          render('4:5', 'https://cdn/legacy-old.png', '2026-01-01'),
        ],
      }),
    );

    expect(res.renders.map((r) => r.url)).toEqual(['https://cdn/legacy-new.png']);
  });

  it('answers with an empty list rather than failing when nothing is rendered', async () => {
    const res = await contentGet.handler({ contentItemId: 'ci_1', genomeId: 'gen_1' }, ctx());
    expect(res.renders).toEqual([]);
  });
});
