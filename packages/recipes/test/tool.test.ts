import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx, RecipeRecord, RecipeOutputRecord } from '@sparksocial/tools';
import { createStubTrendSource } from '@sparksocial/trends';
import {
  recipeValidate,
  recipeCreate,
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
    return expect(out).resolves.toEqual({ valid: true });
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
