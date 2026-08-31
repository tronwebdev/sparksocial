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
  recipeOutputList,
  recipeOutputDecide,
} from '../src/tool.js';

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;
const trendSource = createStubTrendSource();

function fakeStore() {
  const recipes = new Map<string, RecipeRecord>();
  const outputs: RecipeOutputRecord[] = [];
  let nextId = 1;
  let nextRunId = 1;

  return {
    recipes,
    outputs,
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
        for (const preview of args.outputs) {
          outputs.push({ id: `out_${outputs.length + 1}`, recipeId: args.recipeId, runId, genomeId: args.genomeId, status: 'pending_review', preview, createdAt: new Date() });
        }
        return { runId };
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
        return row;
      },
    },
  };
}

function ctx(store: ReturnType<typeof fakeStore>['store'], over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      recipes: store,
      genomes: { get: async () => barber },
      assets: { inventory: async () => ({}) },
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

  it('refuses to approve an output without a contentItemId', async () => {
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
