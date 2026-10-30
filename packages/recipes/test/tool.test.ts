import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx, RecipeRecord, RecipeOutputRecord } from '@sparksocial/tools';
import { createStubTrendSource } from '@sparksocial/trends';
import {
  recipeValidate,
  recipeCreate,
  recipeUpdate,
  recipeGet,
  recipeList,
  recipeSchedule,
  recipeDelete,
  makeRecipeRun,
  makeRecipePreview,
  recipeOutputList,
  recipeOutputDecide,
} from '../src/tool.js';

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;
const trendSource = createStubTrendSource();

function fakeStore() {
  const recipes = new Map<string, RecipeRecord>();
  const outputs: RecipeOutputRecord[] = [];
  /** What `content.createDraft` was asked to make — the posts a recipe scheduled. */
  const posts: Array<Record<string, any> & { id: string }> = [];
  let nextId = 1;
  let nextRunId = 1;

  return {
    recipes,
    outputs,
    posts,
    content: {
      async createDraft(args: any) {
        const row = { ...args, id: `ci_${posts.length + 1}`, status: args.scheduledAt ? 'scheduled' : 'draft' };
        posts.push(row);
        return row;
      },
    },
    store: {
      async create(args: any) {
        const id = `recipe_${nextId++}`;
        const row: RecipeRecord = {
          id,
          genomeId: args.genomeId,
          kind: args.kind,
          name: args.name,
          config: args.config,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(args.intervalMinutes ? { intervalMinutes: args.intervalMinutes } : {}),
        };
        recipes.set(id, row);
        return row;
      },
      async get(id: string) {
        return recipes.get(id);
      },
      async list(genomeId: string) {
        return [...recipes.values()].filter((r) => r.genomeId === genomeId);
      },
      async setStatus({ id, status }: any) {
        const row = recipes.get(id);
        if (!row) return undefined;
        row.status = status;
        return row;
      },
      async update({ id, name, config, intervalMinutes }: any) {
        const row = recipes.get(id);
        if (!row) return undefined;
        if (name !== undefined) row.name = name;
        if (config !== undefined) row.config = config;
        if (intervalMinutes !== undefined) row.intervalMinutes = intervalMinutes ?? undefined;
        return row;
      },
      async delete(id: string) {
        recipes.delete(id);
      },
      async markRan(id: string, _genomeId: string, _orgId: string, at: Date) {
        const row = recipes.get(id);
        if (row) row.lastRunAt = at;
      },
      async findDue() {
        return [];
      },
      async recordRun(args: any) {
        const runId = `run_${nextRunId++}`;
        for (const o of args.outputs) {
          outputs.push({
            id: `out_${outputs.length + 1}`,
            recipeId: args.recipeId,
            runId,
            genomeId: args.genomeId,
            status: o.status ?? 'pending_review',
            preview: o.preview,
            createdAt: new Date(),
            ...(o.contentItemId ? { contentItemId: o.contentItemId } : {}),
          });
        }
        return { runId };
      },
      async getOutput(id: string) {
        return outputs.find((o) => o.id === id);
      },
      async recentOutputPreviews(recipeId: string) {
        return outputs.filter((o) => o.recipeId === recipeId).map((o) => o.preview);
      },
      async lastScheduledAt() {
        return undefined;
      },
      async listOutputs(genomeId: string, _orgId: string, args: any) {
        return outputs.filter((o) => o.genomeId === genomeId && (!args.status || o.status === args.status)).slice(0, args.limit);
      },
      async decideOutput(args: any) {
        const row = outputs.find((o) => o.id === args.id);
        if (!row) return undefined;
        row.status = args.status;
        row.decidedAt = new Date();
        if (args.contentItemId) row.contentItemId = args.contentItemId;
        if (args.preview !== undefined) row.preview = args.preview;
        return row;
      },
    },
  };
}

const sharedContent = fakeStore().content;

function ctx(
  store: ReturnType<typeof fakeStore>['store'],
  over: Partial<ToolCtx> = {},
  content: ReturnType<typeof fakeStore>['content'] = sharedContent,
): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      recipes: store,
      content,
      genomes: { get: async () => barber },
      assets: { inventory: async () => ({}) },
      oauthConnections: { get: async () => undefined },
    } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('recipe.validate', () => {
  it('accepts a valid rss config', () => {
    const out = recipeValidate.handler({ kind: 'rss', config: { feedUrl: 'https://example.com/feed.xml' } }, ctx(fakeStore().store));
    // `notApplied` is part of the contract now, and asserted rather than
    // loosened away: an empty array is the answer for a config that sets only
    // fields the engine honours, and a non-empty one for a config that does not.
    return expect(out).resolves.toEqual({ valid: true, notApplied: [] });
  });

  it('rejects an auto_trend config with an out-of-range score', async () => {
    const out = await recipeValidate.handler({ kind: 'auto_trend', config: { minScore: 5 } }, ctx(fakeStore().store));
    expect(out.valid).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

describe('recipe.create', () => {
  it('creates a recipe with a validated config', async () => {
    const { store } = fakeStore();
    const out = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'rss', name: 'Industry feed', config: { feedUrl: 'https://example.com/feed.xml' } },
      ctx(store),
    );
    expect(out.id).toBeTruthy();
    expect(out.status).toBe('active');
  });

  it('refuses an invalid config rather than creating a broken recipe', async () => {
    const { store } = fakeStore();
    await expect(
      recipeCreate.handler({ genomeId: 'gen_barber', kind: 'rss', name: 'Bad', config: { feedUrl: 'not a url' } }, ctx(store)),
    ).rejects.toThrow(ToolError);
  });

  it('is not idempotent — each call makes a new recipe', () => {
    expect(recipeCreate.idempotent).toBe(false);
  });
});

describe('recipe.get / recipe.list / recipe.schedule / recipe.delete', () => {
  it('round-trips through create, get, list, pause, delete', async () => {
    const { store } = fakeStore();
    const created = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'auto_trend', name: 'Trend watcher', config: {} },
      ctx(store),
    );

    const got = await recipeGet.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(store));
    expect(got.id).toBe(created.id);

    const listed = await recipeList.handler({ genomeId: 'gen_barber' }, ctx(store));
    expect(listed.recipes).toHaveLength(1);

    const paused = await recipeSchedule.handler({ id: created.id, genomeId: 'gen_barber', status: 'paused' }, ctx(store));
    expect(paused.status).toBe('paused');

    await recipeDelete.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(store));
    await expect(recipeGet.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(store))).rejects.toThrow(ToolError);
  });
});

describe('recipe.run', () => {
  it('runs an auto_trend recipe and records the output', async () => {
    const { store } = fakeStore();
    const created = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'auto_trend', name: 'Trend watcher', config: { minScore: 0.1 } },
      ctx(store),
    );
    const run = makeRecipeRun({ trendSource, fetchText: async () => '' });
    const out = await run.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(store));
    expect(out.outputCount).toBeGreaterThan(0);
    expect(out.error).toBeUndefined();
  });

  it('404s for an unknown recipe', async () => {
    const { store } = fakeStore();
    const run = makeRecipeRun({ trendSource, fetchText: async () => '' });
    await expect(run.handler({ id: 'ghost', genomeId: 'gen_barber' }, ctx(store))).rejects.toThrow(ToolError);
  });

  it('is not idempotent — a retried run can find new output', () => {
    const run = makeRecipeRun({ trendSource, fetchText: async () => '' });
    expect(run.idempotent).toBe(false);
  });

  const feed = `<rss><channel>${['a', 'b', 'c']
    .map((x) => `<item><title>Story ${x}</title><link>https://example.com/${x}</link></item>`)
    .join('')}</channel></rss>`;

  it('does not propose the same feed items on the next run', async () => {
    // A second run of an RSS recipe used to queue the same five articles again.
    const f = fakeStore();
    const created = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'rss', name: 'Feed', config: { feedUrl: 'https://example.com/feed.xml', maxItems: 2 } },
      ctx(f.store),
    );
    const run = makeRecipeRun({ trendSource, fetchText: async () => feed });
    expect((await run.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store))).outputCount).toBe(2);
    expect((await run.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store))).outputCount).toBe(1);
    const third = await run.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store));
    expect(third.outputCount).toBe(0);
    expect(f.outputs.map((o) => (o.preview as { title: string }).title)).toEqual(['Story a', 'Story b', 'Story c']);
  });

  it('with review off, schedules a post per chosen account with the CTA link, and records them approved', async () => {
    const f = fakeStore();
    const created = await recipeCreate.handler(
      {
        genomeId: 'gen_barber',
        kind: 'rss',
        name: 'Autopost',
        config: {
          feedUrl: 'https://example.com/feed.xml',
          maxItems: 1,
          reviewBeforePublish: false,
          targetPlatforms: ['instagram', 'tiktok'],
          ctaUrl: 'https://example.com/book',
        },
      },
      ctx(f.store),
    );
    const run = makeRecipeRun({ trendSource, fetchText: async () => feed });
    const out = await run.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store, {}, f.content));

    expect(f.posts.length).toBeGreaterThan(0);
    expect(f.posts.every((p) => p.recipeId === created.id && p.linkUrl === 'https://example.com/book' && p.scheduledAt)).toBe(true);
    expect(f.posts.every((p) => ['instagram', 'tiktok'].includes(p.platform))).toBe(true);
    // Not waiting on anybody: already on the calendar.
    expect(f.outputs[0]!.status).toBe('approved');
    expect(f.outputs[0]!.contentItemId).toBe(f.posts[0]!.id);
    expect(out.why.summary).toMatch(/scheduled/);
  });
});

describe('recipe.preview', () => {
  it('reads the source and saves nothing', async () => {
    const f = fakeStore();
    const preview = makeRecipePreview({
      trendSource,
      fetchText: async () => '<rss><channel><item><title>Hello</title><link>https://e.com/h</link></item></channel></rss>',
    });
    const out = await preview.handler(
      { genomeId: 'gen_barber', kind: 'rss', config: { feedUrl: 'https://e.com/feed.xml' } },
      ctx(f.store),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ title: 'Hello', sourceUrl: 'https://e.com/h', playbookName: expect.any(String) });
    expect(f.outputs).toEqual([]);
    expect(preview.effect).toBe('read');
  });

  it("leaves out what a saved recipe already used, when it is given the recipe's id", async () => {
    const f = fakeStore();
    const feed = '<rss><channel><item><title>Hello</title><link>https://e.com/h</link></item></channel></rss>';
    const created = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'rss', name: 'Feed', config: { feedUrl: 'https://e.com/feed.xml' } },
      ctx(f.store),
    );
    await makeRecipeRun({ trendSource, fetchText: async () => feed }).handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store));
    const preview = makeRecipePreview({ trendSource, fetchText: async () => feed });
    const input = { genomeId: 'gen_barber', kind: 'rss' as const, config: { feedUrl: 'https://e.com/feed.xml' } };
    expect((await preview.handler(input, ctx(f.store))).items).toHaveLength(1);
    const editing = await preview.handler({ ...input, recipeId: created.id }, ctx(f.store));
    expect(editing.items).toEqual([]);
    expect(editing.why.summary).toMatch(/already used/);
  });

  it('answers an unfinished config with the reason rather than throwing', async () => {
    const preview = makeRecipePreview({ trendSource, fetchText: async () => '' });
    const out = await preview.handler({ genomeId: 'gen_barber', kind: 'rss', config: { feedUrl: 'nope' } }, ctx(fakeStore().store));
    expect(out.items).toEqual([]);
    expect(out.error).toBeTruthy();
  });
});

describe('recipe.output.list / recipe.output.decide', () => {
  it('lists proposed output and approves one into a real content item', async () => {
    const { store } = fakeStore();
    const created = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'auto_trend', name: 'Trend watcher', config: { minScore: 0.1 } },
      ctx(store),
    );
    const run = makeRecipeRun({ trendSource, fetchText: async () => '' });
    await run.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(store));

    const list = await recipeOutputList.handler({ genomeId: 'gen_barber', limit: 10 }, ctx(store));
    expect(list.outputs.length).toBeGreaterThan(0);

    const decided = await recipeOutputDecide.handler(
      { id: list.outputs[0]!.id, genomeId: 'gen_barber', status: 'approved', contentItemId: 'ci_1' },
      ctx(store),
    );
    expect(decided.status).toBe('approved');
    expect(decided.contentItemId).toBe('ci_1');
  });

  it('approving schedules the post on the chosen account, linked to the recipe', async () => {
    // Approving used to need a draft the caller had made, which had no schedule,
    // no recipe and no account — so with review on, nothing ever published.
    const f = fakeStore();
    const created = await recipeCreate.handler(
      {
        genomeId: 'gen_barber',
        kind: 'auto_trend',
        name: 'Trend watcher',
        config: { minScore: 0.1, targetPlatforms: ['instagram'], ctaUrl: 'https://example.com/book' },
      },
      ctx(f.store),
    );
    await makeRecipeRun({ trendSource, fetchText: async () => '' }).handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store));
    const pending = f.outputs[0]!;
    expect(pending.status).toBe('pending_review');

    const decided = await recipeOutputDecide.handler(
      { id: pending.id, genomeId: 'gen_barber', status: 'approved' },
      ctx(f.store, {}, f.content),
    );
    expect(decided.status).toBe('approved');
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0]).toMatchObject({
      recipeId: created.id,
      platform: 'instagram',
      linkUrl: 'https://example.com/book',
      sourceTrendId: (pending.preview as { trendId: string }).trendId,
    });
    expect(f.posts[0]!.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(decided.contentItemId).toBe(f.posts[0]!.id);
    expect((decided.preview as { contentItemIds: string[] }).contentItemIds).toEqual([f.posts[0]!.id]);

    // A replay returns the approved row instead of scheduling a second post.
    await recipeOutputDecide.handler({ id: pending.id, genomeId: 'gen_barber', status: 'approved' }, ctx(f.store, {}, f.content));
    expect(f.posts).toHaveLength(1);
    // And it cannot be flipped to rejected once it is on the calendar.
    await expect(
      recipeOutputDecide.handler({ id: pending.id, genomeId: 'gen_barber', status: 'rejected' }, ctx(f.store, {}, f.content)),
    ).rejects.toThrow(/already approved/);
  });

  it('refuses to approve an output that matched no format', async () => {
    const f = fakeStore();
    f.outputs.push({ id: 'out_x', recipeId: 'r', runId: 'run', genomeId: 'gen_barber', status: 'pending_review', preview: { title: 'T', intent: 'I' }, createdAt: new Date() });
    await expect(
      recipeOutputDecide.handler({ id: 'out_x', genomeId: 'gen_barber', status: 'approved' }, ctx(f.store)),
    ).rejects.toThrow(/Remove it instead/);
  });

  it('404s an unknown output', async () => {
    const { store } = fakeStore();
    await expect(
      recipeOutputDecide.handler({ id: 'out_1', genomeId: 'gen_barber', status: 'approved' }, ctx(store)),
    ).rejects.toThrow(ToolError);
  });
});

/**
 * `recipe.update` — editing a saved recipe, which was impossible.
 *
 * Every field was write-once: `create` set them, and the only other writes were
 * `schedule` (status) and `delete`. Correcting a mistyped feed URL therefore
 * meant deleting the recipe, which also threw away its run history and every
 * output still waiting in the queue.
 */
describe('recipe.update', () => {
  async function saved(store: ReturnType<typeof fakeStore>['store']) {
    return recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'rss', name: 'Blog', config: { feedUrl: 'https://exmaple.com/feed.xml' } },
      ctx(store),
    );
  }

  it('edits the config and keeps the recipe', async () => {
    const f = fakeStore();
    const created = await saved(f.store);

    const out = await recipeUpdate.handler(
      { id: created.id, genomeId: 'gen_barber', config: { feedUrl: 'https://example.com/feed.xml' } },
      ctx(f.store),
    );

    expect((out.config as { feedUrl: string }).feedUrl).toBe('https://example.com/feed.xml');
    // Same row, so the run history and the queued outputs survive the edit.
    expect(out.id).toBe(created.id);
    expect(f.recipes.size).toBe(1);
  });

  it('validates the new config against the stored kind', async () => {
    /**
     * The load-bearing rule. `kind` is not an input, so a caller cannot send an
     * `rss` body and have it checked against `auto_trend`'s looser schema — which
     * would be a way to smuggle a config the engine cannot run into a recipe the
     * scheduler will keep invoking.
     */
    const f = fakeStore();
    const created = await saved(f.store);

    await expect(
      recipeUpdate.handler({ id: created.id, genomeId: 'gen_barber', config: { notAFeedUrl: 1 } }, ctx(f.store)),
    ).rejects.toThrow(ToolError);
  });

  it('replaces the config rather than merging it', async () => {
    /**
     * A deep merge would let half a config pass validation on the strength of the
     * half it kept — the old `feedUrl` silently keeping a new config valid. So an
     * update that omits a required field is refused, not completed from the
     * previous value.
     */
    const f = fakeStore();
    const created = await saved(f.store);

    await expect(
      recipeUpdate.handler({ id: created.id, genomeId: 'gen_barber', config: { maxItems: 3 } }, ctx(f.store)),
    ).rejects.toThrow(ToolError);
  });

  it('renames without touching the config', async () => {
    const f = fakeStore();
    const created = await saved(f.store);

    const out = await recipeUpdate.handler(
      { id: created.id, genomeId: 'gen_barber', name: 'Podcast feed' },
      ctx(f.store),
    );

    expect(out.name).toBe('Podcast feed');
    expect((out.config as { feedUrl: string }).feedUrl).toBe('https://exmaple.com/feed.xml');
  });

  it('clears the schedule on null, leaving a run-on-demand recipe', async () => {
    // `undefined` leaves the schedule alone and `null` removes it. Without the
    // distinction there would be no way to stop a recipe polling while keeping it.
    const f = fakeStore();
    const created = await recipeCreate.handler(
      {
        genomeId: 'gen_barber',
        kind: 'rss',
        name: 'Blog',
        config: { feedUrl: 'https://example.com/feed.xml' },
        intervalMinutes: 60,
      },
      ctx(f.store),
    );

    const out = await recipeUpdate.handler(
      { id: created.id, genomeId: 'gen_barber', intervalMinutes: null },
      ctx(f.store),
    );
    expect(out.intervalMinutes).toBeUndefined();
  });

  it('refuses a call that changes nothing', async () => {
    // Not a no-op success: a call naming a recipe and no field is a caller bug,
    // and "done" would hide it behind a screen that appears to save.
    const f = fakeStore();
    const created = await saved(f.store);

    await expect(
      recipeUpdate.handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store)),
    ).rejects.toThrow(ToolError);
  });

  it('reads an unknown recipe as absent', async () => {
    const f = fakeStore();
    await expect(
      recipeUpdate.handler({ id: 'recipe_missing', genomeId: 'gen_barber', name: 'x' }, ctx(f.store)),
    ).rejects.toThrow(ToolError);
  });

  it('is idempotent, unlike create', () => {
    // Sending the same edit twice lands the same row; sending the same create
    // twice makes two recipes.
    expect(recipeUpdate.idempotent).toBe(true);
    expect(recipeCreate.idempotent).toBe(false);
  });
});

/**
 * A recipe past its `endAt` is retired, not merely refused.
 *
 * `withinRunWindow` has always stopped an expired recipe producing output. What it
 * could not do is stop the *scheduler*: `findDue` selects on `status = 'active'`
 * and knows nothing about `endAt`, so an expired recipe was invoked every five
 * minutes forever — an audit row and one of ten batch slots each time, taken from
 * recipes that could still do work. Nothing cleared it because nothing looked.
 */
describe('recipe.run and the end of a window', () => {
  const run = () => makeRecipeRun({ trendSource, fetchText: async () => '' });

  it('marks a finished recipe completed, so the scheduler stops polling it', async () => {
    const f = fakeStore();
    const created = await recipeCreate.handler(
      {
        genomeId: 'gen_barber',
        kind: 'rss',
        name: 'Old',
        config: { feedUrl: 'https://example.com/feed.xml', endAt: '2020-01-01T00:00:00.000Z' },
        intervalMinutes: 60,
      },
      ctx(f.store),
    );

    const out = await run().handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store));

    expect(out.outputCount).toBe(0);
    expect(out.error).toMatch(/finished/i);
    expect(f.recipes.get(created.id)!.status).toBe('completed');
    // Said in the explanation too, since a status change the owner cannot see is
    // one they will be surprised by.
    expect(out.why.factors.some((factor) => /completed/i.test(factor.detail ?? ''))).toBe(true);
  });

  it('leaves a not-yet-started recipe active', async () => {
    /**
     * The distinction that makes the flag worth having. Both bounds mean "no
     * output from this run", but a recipe with a future `startAt` is *waiting* —
     * retiring it would kill it before it ever ran, and nothing would restart it.
     */
    const f = fakeStore();
    const created = await recipeCreate.handler(
      {
        genomeId: 'gen_barber',
        kind: 'rss',
        name: 'Future',
        config: { feedUrl: 'https://example.com/feed.xml', startAt: '2099-01-01T00:00:00.000Z' },
        intervalMinutes: 60,
      },
      ctx(f.store),
    );

    const out = await run().handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store));

    expect(out.outputCount).toBe(0);
    expect(out.error).toMatch(/does not start until/i);
    expect(f.recipes.get(created.id)!.status).toBe('active');
  });

  it('leaves a recipe with no window active', async () => {
    // The common case: most recipes set neither bound and must keep running.
    const f = fakeStore();
    const created = await recipeCreate.handler(
      { genomeId: 'gen_barber', kind: 'rss', name: 'Ongoing', config: { feedUrl: 'https://example.com/feed.xml' } },
      ctx(f.store),
    );

    await run().handler({ id: created.id, genomeId: 'gen_barber' }, ctx(f.store));
    expect(f.recipes.get(created.id)!.status).toBe('active');
  });
});
