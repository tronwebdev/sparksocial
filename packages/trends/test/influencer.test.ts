import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import {
  trendInfluencerWatch,
  makeTrendInfluencerReview,
  normaliseHandle,
  type InfluencerSource,
} from '../src/influencer.js';
import type { Trend } from '../src/trend.js';

/**
 * §8.9's influencer watchlist.
 *
 * Three things carry weight here. **One spelling per account** — platforms are
 * inconsistent about `@` and case, and two rows for one competitor means a brand
 * watching it twice and unable to remove either. **The refusal** — reading a
 * named account's posts needs listening access nobody has cleared, and returning
 * an empty list would say "your competitors went quiet", which is a materially
 * different and false claim. And **scoring reuse** — a competitor's post is only
 * worth acting on if this brand could credibly make something like it, which is
 * the question `scoreTrend` already answers.
 */

/**
 * The real golden-set genome, not a hand-built literal. `scoreTrend` reads
 * `constraints.compliance_profile` among other things, and a partial fake fails
 * on whichever field the scorer touches next — which is a test breaking on its
 * own fixture rather than on the code.
 */
const genome = () => GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;

interface Row {
  id: string;
  platform: string;
  handle: string;
  displayName?: string;
  note?: string;
  createdAt: Date;
}

function store(initial: Row[] = []) {
  const rows = [...initial];
  return {
    rows,
    impl: {
      async add({ platform, handle, note }: { platform: string; handle: string; note?: string }) {
        const existing = rows.find((r) => r.platform === platform && r.handle === handle);
        if (existing) {
          if (note !== undefined) existing.note = note;
          return existing;
        }
        const created: Row = {
          id: `inf_${rows.length + 1}`,
          platform,
          handle,
          createdAt: new Date(2026, 7, 20, rows.length),
          ...(note ? { note } : {}),
        };
        rows.push(created);
        return created;
      },
      async remove({ platform, handle }: { platform: string; handle: string }) {
        const i = rows.findIndex((r) => r.platform === platform && r.handle === handle);
        if (i >= 0) rows.splice(i, 1);
      },
      async list() {
        return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },
  };
}

const ctx = (influencers: unknown, over: Partial<ToolCtx> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      influencers,
      genomes: { get: async (id: string) => (id === 'gen_1' ? genome() : undefined) },
      assets: { inventory: async () => ({}) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

const post = (over: Partial<Trend> = {}): Trend => ({
  id: 'p1',
  source: 'instagram' as Trend['source'],
  topic: 'One continuous shot of a fade',
  tags: ['before_after', 'craft'],
  metrics: { volume: 4_000, velocity: 0.6, saturation: 0.2, growth: 1.1 },
  samples: [],
  language: 'en',
  ...over,
});

const sourceWith = (byHandle: Record<string, Trend[]>): InfluencerSource => ({
  name: 'test',
  async recentPosts({ handle }) {
    const posts = byHandle[handle];
    if (!posts) throw new Error(`no access to @${handle}`);
    return posts;
  },
});

describe('normaliseHandle', () => {
  it('collapses the spellings platforms disagree about', () => {
    // Two rows for one account means a brand watching a competitor twice, and
    // then unable to remove either from a screen showing the other spelling.
    expect(normaliseHandle('@Competitor')).toBe('competitor');
    expect(normaliseHandle('  competitor ')).toBe('competitor');
    expect(normaliseHandle('@@competitor')).toBe('competitor');
  });
});

describe('trend.influencer.watch', () => {
  it('stores the normalised handle, whatever was typed', async () => {
    const s = store();
    const out = await trendInfluencerWatch.handler(
      { genomeId: 'gen_1', action: 'add', platform: 'instagram', handle: '@RivalCuts' },
      ctx(s.impl),
    );
    expect(out.watchlist[0]!.handle).toBe('rivalcuts');
  });

  it('removes the row even when the handle is typed differently', async () => {
    // The bug this closes by construction: `@RivalCuts` on the Remove button
    // and `rivalcuts` in the row.
    const s = store();
    await trendInfluencerWatch.handler(
      { genomeId: 'gen_1', action: 'add', platform: 'instagram', handle: 'rivalcuts' },
      ctx(s.impl),
    );
    const out = await trendInfluencerWatch.handler(
      { genomeId: 'gen_1', action: 'remove', platform: 'instagram', handle: '@RivalCuts' },
      ctx(s.impl),
    );
    expect(out.watchlist).toEqual([]);
  });

  it('watching the same account twice is one watch, and updates the note', async () => {
    const s = store();
    await trendInfluencerWatch.handler(
      { genomeId: 'gen_1', action: 'add', platform: 'instagram', handle: 'rival', note: 'first guess' },
      ctx(s.impl),
    );
    const out = await trendInfluencerWatch.handler(
      { genomeId: 'gen_1', action: 'add', platform: 'instagram', handle: 'rival', note: 'their reels do well' },
      ctx(s.impl),
    );
    expect(out.watchlist).toHaveLength(1);
    expect(out.watchlist[0]!.note).toBe('their reels do well');
  });

  it('treats the same handle on two platforms as two accounts', async () => {
    const s = store();
    await trendInfluencerWatch.handler({ genomeId: 'gen_1', action: 'add', platform: 'instagram', handle: 'rival' }, ctx(s.impl));
    const out = await trendInfluencerWatch.handler({ genomeId: 'gen_1', action: 'add', platform: 'tiktok', handle: 'rival' }, ctx(s.impl));
    expect(out.watchlist).toHaveLength(2);
  });

  it('refuses an add with no handle rather than storing a blank watch', () => {
    expect(
      trendInfluencerWatch.input.safeParse({ genomeId: 'gen_1', action: 'add', platform: 'instagram' }).success,
    ).toBe(false);
  });

  it('refuses a handle that is nothing but @', async () => {
    await expect(
      trendInfluencerWatch.handler({ genomeId: 'gen_1', action: 'add', platform: 'instagram', handle: '@' }, ctx(store().impl)),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a genome that is not the one selected', async () => {
    await expect(
      trendInfluencerWatch.handler({ genomeId: 'gen_other', action: 'list' }, ctx(store().impl)),
    ).rejects.toThrow(ToolError);
  });

  it('is not readable by a viewer or an agency client', () => {
    // A list of the accounts a brand studies is frequently a list of its
    // competitors — strategy, not content.
    expect(trendInfluencerWatch.scopes).not.toContain('viewer');
    expect(trendInfluencerWatch.scopes).not.toContain('client');
  });
});

describe('trend.influencer.review', () => {
  it('refuses by name when listening access is not configured', async () => {
    // Returning an empty list would say "your competitors posted nothing",
    // which is a different and false claim.
    const s = store([{ id: 'i1', platform: 'instagram', handle: 'rival', createdAt: new Date() }]);
    await expect(
      makeTrendInfluencerReview(undefined).handler({ genomeId: 'gen_1', postsPerAccount: 5, limit: 15 }, ctx(s.impl)),
    ).rejects.toThrow(ToolError);
  });

  it('returns empty without complaint when nothing is watched at all', async () => {
    // Nothing to look at is not a failure, and must not read as one — this is
    // the state every brand starts in.
    const out = await makeTrendInfluencerReview(undefined).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 15 },
      ctx(store().impl),
    );
    expect(out.posts).toEqual([]);
    expect(out.why.summary).toMatch(/no accounts/i);
  });

  it('scores a watched account’s posts with the same machinery as the open feed', async () => {
    const s = store([{ id: 'i1', platform: 'instagram', handle: 'rival', createdAt: new Date() }]);
    const out = await makeTrendInfluencerReview(sourceWith({ rival: [post()] })).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 15 },
      ctx(s.impl),
    );
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]!.score).toBeGreaterThan(0);
    expect(out.posts[0]!.handle).toBe('rival');
  });

  it('flags an unsafe post rather than hiding it', async () => {
    // Same choice `trend.rank` makes: a competitor doing something this brand
    // must not do is genuinely useful to see.
    const s = store([{ id: 'i1', platform: 'instagram', handle: 'rival', createdAt: new Date() }]);
    const unsafe = post({ id: 'p2', topic: 'Debating a medical treatment claim', tags: ['health_claim', 'controversy'] });
    const out = await makeTrendInfluencerReview(sourceWith({ rival: [unsafe] })).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 15 },
      ctx(s.impl),
    );
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]!.safe).toBe(false);
    expect(out.posts[0]!.unsafeBecause).toBeTruthy();
  });

  it('one unreachable account does not empty the whole review', async () => {
    const s = store([
      { id: 'i1', platform: 'instagram', handle: 'reachable', createdAt: new Date(2026, 7, 20) },
      { id: 'i2', platform: 'instagram', handle: 'broken', createdAt: new Date(2026, 7, 21) },
    ]);
    const out = await makeTrendInfluencerReview(sourceWith({ reachable: [post()] })).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 15 },
      ctx(s.impl),
    );
    expect(out.posts).toHaveLength(1);
    expect(out.quiet).toHaveLength(1);
    expect(out.quiet[0]!.handle).toBe('broken');
    // The reason is about us, not about them.
    expect(out.quiet[0]!.because).toMatch(/no access/);
  });

  it('separates "posted nothing" from "could not look"', async () => {
    const s = store([{ id: 'i1', platform: 'instagram', handle: 'silent', createdAt: new Date() }]);
    const out = await makeTrendInfluencerReview(sourceWith({ silent: [] })).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 15 },
      ctx(s.impl),
    );
    expect(out.quiet[0]!.because).toBe('nothing posted recently');
  });

  it('orders by score and honours the limit', async () => {
    const s = store([{ id: 'i1', platform: 'instagram', handle: 'rival', createdAt: new Date() }]);
    const posts = [
      post({ id: 'a', topic: 'A meme with nothing to do with cutting hair', tags: ['meme'] }),
      post({ id: 'b', topic: 'Before and after a fade, one shot', tags: ['before_after', 'craft'] }),
    ];
    const out = await makeTrendInfluencerReview(sourceWith({ rival: posts })).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 1 },
      ctx(s.impl),
    );
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]!.trendId).toBe('b');
  });

  it('carries a why, because the ordering is a claim about what matters', async () => {
    const s = store([{ id: 'i1', platform: 'instagram', handle: 'rival', createdAt: new Date() }]);
    const out = await makeTrendInfluencerReview(sourceWith({ rival: [post()] })).handler(
      { genomeId: 'gen_1', postsPerAccount: 5, limit: 15 },
      ctx(s.impl),
    );
    expect(out.why.summary).toContain('@rival');
    expect(out.why.factors?.[0]?.label).toBe('scored by');
  });
});
