import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import type { TrendSource } from '@sparksocial/trends';
import { AutoTrendConfig, BulkConnectorConfig, RssConfig, runRecipe, type RecipeRunContext } from './runners.js';

/**
 * `recipe.*` — Automation Recipes, plan §12 P5 (`AUTO-01`→`AUTO-04.4`).
 *
 * *"A recipe runs unattended for two weeks producing on-brand, non-duplicate
 * output within budget."* (§12's own exit line.) The output queue is the
 * mechanism that makes "unattended" honest rather than reckless: a recipe
 * never calls `content.draft` or `publish.now` itself — it writes a
 * `recipe_outputs` row, `recipe.output.decide` is a human (or a future
 * autonomy setting) approving it, and only then does a caller turn it into a
 * real draft. Nothing here can post anything.
 */

const KIND = z.enum(['auto_trend', 'bulk_connector', 'rss']);

/** The schema each `kind` validates its `config` against — kept here so `.create` and `.validate` share exactly one source of truth. */
function schemaFor(kind: z.infer<typeof KIND>) {
  return kind === 'auto_trend' ? AutoTrendConfig : kind === 'rss' ? RssConfig : BulkConnectorConfig;
}

/* ── recipe.validate ─────────────────────────────────────────────────── */

export const RecipeValidateInput = z.object({ kind: KIND, config: z.unknown() });
export const RecipeValidateOutput = z.object({ valid: z.boolean(), error: z.string().optional() });

export const recipeValidate = defineTool({
  name: 'recipe.validate',
  version: 1,

  summary: 'Check a recipe config before saving it — the AUTO-02 preview/validation step. Free, no writes.',

  input: RecipeValidateInput,
  output: RecipeValidateOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input) {
    const result = schemaFor(input.kind).safeParse(input.config);
    return result.success ? { valid: true } : { valid: false, error: result.error.issues.map((i) => i.message).join('; ') };
  },
});

/* ── recipe.create ───────────────────────────────────────────────────── */

export const RecipeCreateInput = z.object({
  genomeId: z.string().min(1),
  kind: KIND,
  name: z.string().min(1).max(120),
  config: z.unknown(),
  /** Omit for a recipe that only runs on `recipe.run` — a manual, not scheduled, recipe. */
  intervalMinutes: z.number().int().min(15).max(60 * 24 * 7).optional(),
});

export const RecipeOut = z.object({
  id: z.string(),
  genomeId: z.string(),
  kind: KIND,
  name: z.string(),
  config: z.unknown(),
  status: z.enum(['active', 'paused']),
  intervalMinutes: z.number().optional(),
  lastRunAt: z.string().optional(),
  createdAt: z.string(),
});

export const recipeCreate = defineTool({
  name: 'recipe.create',
  version: 1,

  summary: 'Create an automation recipe (AutoTrend, Bulk Connector, or RSS). Config is validated against ' +
    'its kind before saving — the same check recipe.validate exposes standalone.',

  input: RecipeCreateInput,
  output: RecipeOut,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Each call makes a new recipe — a repeated call with the same input is a
  // second recipe, not a safe replay, same reasoning as `content.draft`.
  idempotent: false,
  surfaces: ['AUTO-01', 'AUTO-02'],

  async handler(input, ctx) {
    const parsed = schemaFor(input.kind).safeParse(input.config);
    if (!parsed.success) {
      throw new ToolError('INVALID_INPUT', `Invalid ${input.kind} config: ${parsed.error.issues.map((i) => i.message).join('; ')}`, {
        kind: input.kind,
      });
    }

    const row = await ctx.db.recipes.create({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      kind: input.kind,
      name: input.name,
      config: parsed.data,
      ...(input.intervalMinutes ? { intervalMinutes: input.intervalMinutes } : {}),
    });
    ctx.logger.info('recipe created', { genomeId: input.genomeId, kind: input.kind, recipeId: row.id });
    return toOut(row);
  },
});

/* ── recipe.get / recipe.list ────────────────────────────────────────── */

export const recipeGet = defineTool({
  name: 'recipe.get',
  version: 1,
  summary: 'Read one automation recipe back by id.',
  input: z.object({ id: z.string().min(1), genomeId: z.string().min(1) }),
  output: RecipeOut,
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  async handler(input, ctx) {
    const row = await ctx.db.recipes.get(input.id, input.genomeId, ctx.orgId);
    if (!row) throw new ToolError('NOT_FOUND', 'No such recipe.', { id: input.id });
    return toOut(row);
  },
});

export const recipeList = defineTool({
  name: 'recipe.list',
  version: 1,
  summary: 'Every automation recipe for a genome.',
  input: z.object({ genomeId: z.string().min(1) }),
  output: z.object({ recipes: z.array(RecipeOut) }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['AUTO-01'],
  async handler(input, ctx) {
    const rows = await ctx.db.recipes.list(input.genomeId, ctx.orgId);
    return { recipes: rows.map(toOut) };
  },
});

/* ── recipe.schedule ─────────────────────────────────────────────────── */

export const recipeSchedule = defineTool({
  name: 'recipe.schedule',
  version: 1,
  summary: 'Turn a recipe on or off. A paused recipe is not deleted — its config and history stay.',
  input: z.object({ id: z.string().min(1), genomeId: z.string().min(1), status: z.enum(['active', 'paused']) }),
  output: RecipeOut,
  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true, // setting the same status twice is a no-op replay, unlike .run
  surfaces: ['AUTO-01'],
  async handler(input, ctx) {
    const row = await ctx.db.recipes.setStatus({ id: input.id, genomeId: input.genomeId, orgId: ctx.orgId, status: input.status });
    if (!row) throw new ToolError('NOT_FOUND', 'No such recipe.', { id: input.id });
    return toOut(row);
  },
});

/* ── recipe.delete ───────────────────────────────────────────────────── */

export const recipeDelete = defineTool({
  name: 'recipe.delete',
  version: 1,
  summary: 'Permanently remove a recipe. Past output already decided (approved/rejected) is untouched — only the recipe itself and its schedule are removed.',
  input: z.object({ id: z.string().min(1), genomeId: z.string().min(1) }),
  output: z.object({ deleted: z.literal(true) }),
  effect: 'destructive',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,
  async handler(input, ctx) {
    await ctx.db.recipes.delete(input.id, input.genomeId, ctx.orgId);
    return { deleted: true as const };
  },
});

/* ── recipe.run ──────────────────────────────────────────────────────── */

export interface RecipeDeps {
  trendSource: TrendSource;
  fetchText: (url: string) => Promise<string>;
  /** Google Drive's shared, org-wide API key — see `RecipeRunContext.driveApiKey`'s own comment. */
  driveApiKey?: string;
  /** Same injection contract as `fetchText`, for Canva's Bearer-authenticated calls. */
  fetchWithAuth?: (url: string, bearerToken: string) => Promise<string>;
}

export const RecipeRunOutput = z.object({
  runId: z.string(),
  outputCount: z.number(),
  error: z.string().optional(),
  why: Explanation,
});

export function makeRecipeRun(deps: RecipeDeps) {
  return defineTool({
    name: 'recipe.run',
    version: 1,

    summary: 'Run a recipe right now instead of waiting for its schedule. Writes proposed output to the ' +
      "queue for review — never publishes, never creates a draft by itself.",

    input: z.object({ id: z.string().min(1), genomeId: z.string().min(1) }),
    output: RecipeRunOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Each run can produce different output (a trend feed changes, an RSS
    // feed publishes something new) — a retried run is a new attempt, not a
    // safe replay of the last one, same reasoning as `content.draft`.
    idempotent: false,
    surfaces: ['AUTO-04.4'],

    async handler(input, ctx) {
      const recipe = await ctx.db.recipes.get(input.id, input.genomeId, ctx.orgId);
      if (!recipe) throw new ToolError('NOT_FOUND', 'No such recipe.', { id: input.id });

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const assets = await ctx.db.assets.inventory(input.genomeId, ctx.orgId);
      const runCtx: RecipeRunContext = {
        genome,
        assets,
        trendSource: deps.trendSource,
        fetchText: deps.fetchText,
        ...(deps.driveApiKey ? { driveApiKey: deps.driveApiKey } : {}),
        ...(deps.fetchWithAuth ? { fetchWithAuth: deps.fetchWithAuth } : {}),
        // Resolves per-call, against this specific genome — a fixed
        // dependency injected once at registration couldn't know which
        // brand's Canva connection to look up.
        getOAuthAccessToken: async (provider) => {
          const conn = await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, provider);
          return conn?.accessToken;
        },
      };

      const { outputs, error } = await runRecipe(recipe.kind, recipe.config, runCtx);

      const { runId } = await ctx.db.recipes.recordRun({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        recipeId: recipe.id,
        status: error ? 'failed' : 'succeeded',
        outputCount: outputs.length,
        ...(error ? { error } : {}),
        outputs,
      });
      await ctx.db.recipes.markRan(recipe.id, input.genomeId, ctx.orgId, new Date());

      ctx.logger.info('recipe run', { recipeId: recipe.id, kind: recipe.kind, outputCount: outputs.length, failed: !!error });

      return {
        runId,
        outputCount: outputs.length,
        ...(error ? { error } : {}),
        why: {
          summary: error
            ? `${recipe.name} failed: ${error}`
            : outputs.length
              ? `${recipe.name} produced ${outputs.length} item${outputs.length === 1 ? '' : 's'} for review.`
              : `${recipe.name} ran but found nothing new.`,
          factors: [{ label: 'kind', detail: recipe.kind }],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}

/* ── recipe.output.list / recipe.output.decide ──────────────────────── */

const OutputOut = z.object({
  id: z.string(),
  recipeId: z.string(),
  runId: z.string(),
  status: z.enum(['pending_review', 'approved', 'rejected']),
  preview: z.unknown(),
  contentItemId: z.string().optional(),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
});

export const recipeOutputList = defineTool({
  name: 'recipe.output.list',
  version: 1,
  summary: "The output queue — every item a recipe has proposed, pending review by default (AUTO-04.4).",
  input: z.object({ genomeId: z.string().min(1), status: z.enum(['pending_review', 'approved', 'rejected']).optional(), limit: z.number().int().min(1).max(100).default(50) }),
  output: z.object({ outputs: z.array(OutputOut) }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['AUTO-04.4'],
  async handler(input, ctx) {
    const rows = await ctx.db.recipes.listOutputs(input.genomeId, ctx.orgId, { status: input.status, limit: input.limit });
    return { outputs: rows.map(toOutputOut) };
  },
});

export const recipeOutputDecide = defineTool({
  name: 'recipe.output.decide',
  version: 1,

  summary:
    'Approve or reject one proposed output. Approving records which real draft it became (pass the ' +
    'contentItemId from a content.draft call using this output\'s suggested playbook/intent) — this tool ' +
    'never creates that draft itself.',

  input: z.object({
    id: z.string().min(1),
    genomeId: z.string().min(1),
    status: z.enum(['approved', 'rejected']),
    contentItemId: z.string().optional(),
  }),
  output: OutputOut,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AUTO-04.4'],

  async handler(input, ctx) {
    if (input.status === 'approved' && !input.contentItemId) {
      throw new ToolError('INVALID_INPUT', 'Approving an output requires the contentItemId it became.', { id: input.id });
    }
    const row = await ctx.db.recipes.decideOutput({
      id: input.id,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      status: input.status,
      ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
    });
    if (!row) throw new ToolError('NOT_FOUND', 'No such output.', { id: input.id });
    return toOutputOut(row);
  },
});

function toOut(row: { id: string; genomeId: string; kind: string; name: string; config: unknown; status: 'active' | 'paused'; intervalMinutes?: number; lastRunAt?: Date; createdAt: Date }) {
  return {
    id: row.id,
    genomeId: row.genomeId,
    kind: row.kind as z.infer<typeof KIND>,
    name: row.name,
    config: row.config,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(row.intervalMinutes ? { intervalMinutes: row.intervalMinutes } : {}),
    ...(row.lastRunAt ? { lastRunAt: row.lastRunAt.toISOString() } : {}),
  };
}

function toOutputOut(row: {
  id: string;
  recipeId: string;
  runId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  preview: unknown;
  contentItemId?: string;
  createdAt: Date;
  decidedAt?: Date;
}) {
  return {
    id: row.id,
    recipeId: row.recipeId,
    runId: row.runId,
    status: row.status,
    preview: row.preview,
    createdAt: row.createdAt.toISOString(),
    ...(row.contentItemId ? { contentItemId: row.contentItemId } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}
