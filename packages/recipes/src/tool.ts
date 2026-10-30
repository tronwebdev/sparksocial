import { z } from 'zod';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError, type Platform } from '@sparksocial/shared';
import type { TrendSource } from '@sparksocial/trends';
import { byId } from '@sparksocial/playbooks';
import {
  AutoTrendConfig,
  BulkConnectorConfig,
  RecipeCommonConfig,
  RssConfig,
  outputKeys,
  requiresReview,
  runRecipe,
  withinRunWindow,
  type RecipeOutputPreview,
  type RecipeRunContext,
} from './runners.js';

/**
 * Gap between two posts a single recipe run schedules.
 *
 * Not zero. A run producing five outputs would otherwise queue five publishes on
 * one instant — the pattern rate limiters punish and an audience reads as a bot,
 * which is the same reason `postingSlotAt` staggers campaign slots sharing a day.
 */
const RECIPE_STAGGER_MS = 11 * 60_000;

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
export const RecipeValidateOutput = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
  /**
   * Fields this config sets that the engine accepts and does not yet act on.
   *
   * A config field that stores and does nothing is indistinguishable, from the
   * outside, from one that works — which is how `goal`, `ctaUrl` and
   * `targetPlatforms` sat unread from the day they were added. Naming them here
   * makes the gap visible to whoever is about to build the wizard on top, instead
   * of leaving a control that silently has no effect.
   *
   * Empty when everything in the config is honoured.
   */
  notApplied: z.array(z.object({ field: z.string(), because: z.string() })),
});

/**
 * Which of those fields this config actually sets.
 *
 * Reads the **raw** config rather than the parsed one: `targetPlatforms` carries a
 * `.default([])`, so the parsed object always has the key and only the caller's
 * own input says whether they chose anything. Scanning the parsed object would
 * warn every RSS recipe about a field nobody touched.
 */
function scanNotApplied(config: unknown): Array<{ field: string; because: string }> {
  const raw = (config ?? {}) as Record<string, unknown>;
  return Object.entries(NOT_APPLIED)
    .filter(([field]) => {
      const v = raw[field];
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
    })
    .map(([field, because]) => ({ field, because }));
}

/**
 * The fields the engine stores but does not read, and why. Keyed by config field.
 *
 * `goal` was in this list until 25 August and is not any more — it now reaches
 * the copy through the output's `intent` (`withGoal` in `runners.ts`). `ctaUrl`
 * and `targetPlatforms` left it on 30 October: every post a recipe schedules now
 * carries the link (`content_items.link_url`) and goes to the chosen accounts.
 * Empty, and kept: the next field added ahead of its engine belongs here.
 */
const NOT_APPLIED: Record<string, string> = {};

export const recipeValidate = defineTool({
  name: 'recipe.validate',
  version: 1,

  summary:
    'Check a recipe config before saving it — the AUTO-02 preview/validation step. Also reports which fields ' +
    'the engine accepts but does not yet act on. Free, no writes.',

  input: RecipeValidateInput,
  output: RecipeValidateOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input) {
    const result = schemaFor(input.kind).safeParse(input.config);
    if (!result.success) {
      return { valid: false, error: result.error.issues.map((i) => i.message).join('; '), notApplied: [] };
    }
    return { valid: true, notApplied: scanNotApplied(input.config) };
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
  /**
   * `completed` is terminal and set by the engine, never by a caller — a recipe
   * whose `endAt` has passed. `recipe.schedule` cannot set it (its input is the
   * two a person may choose), which is why this enum is wider than that one's.
   */
  status: z.enum(['active', 'paused', 'completed']),
  intervalMinutes: z.number().optional(),
  lastRunAt: z.string().optional(),
  createdAt: z.string(),
  /**
   * Fields this recipe set that the engine will not act on — same list
   * `recipe.validate` returns, echoed on the write.
   *
   * On `create` rather than only on `validate` because nothing calls
   * `recipe.validate`: the Automation panel goes straight to `recipe.create`. A
   * warning on the tool nobody calls would be one more thing that exists and is
   * never read, which is the exact defect this change is undoing. Empty on every
   * recipe the panel can currently build, since its form offers none of these
   * fields yet.
   */
  notApplied: z.array(z.object({ field: z.string(), because: z.string() })).optional(),
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
    const notApplied = scanNotApplied(input.config);
    if (notApplied.length) {
      // Logged as well as returned: a recipe created through the API rather than
      // the panel has no screen to show the warning on.
      ctx.logger.warn('recipe created with fields the engine does not act on', {
        recipeId: row.id,
        fields: notApplied.map((n) => n.field),
      });
    }

    ctx.logger.info('recipe created', { genomeId: input.genomeId, kind: input.kind, recipeId: row.id });
    return { ...toOut(row), ...(notApplied.length ? { notApplied } : {}) };
  },
});

/* ── recipe.update ───────────────────────────────────────────────────── */

export const RecipeUpdateInput = z.object({
  id: z.string().min(1),
  genomeId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  /**
   * The whole config, not a patch of it.
   *
   * A recipe config is validated as a unit against its kind's schema, and a deep
   * merge would let a caller send half a config and pass validation on the
   * strength of the half it kept — a `feedUrl` from the old config silently
   * keeping a new one valid, for instance. The caller reads with `recipe.get`,
   * edits, and sends the result; `kind` comes from the stored row, so the schema
   * it is checked against cannot be chosen by the caller either.
   */
  config: z.unknown().optional(),
  /** Null clears the schedule, leaving a recipe that only runs when asked. */
  intervalMinutes: z.number().int().min(15).max(60 * 24 * 7).nullable().optional(),
});

/**
 * `recipe.update` — editing a saved recipe, which was impossible.
 *
 * Every field of a recipe was write-once: `recipe.create` set them, and the only
 * other writes were `recipe.schedule` (status) and `recipe.delete`. So correcting
 * a typo'd feed URL, adding a keyword, or moving an end date all meant deleting
 * the recipe and rebuilding it — which also threw away its run history and every
 * output still waiting in the queue.
 *
 * `kind` is deliberately not editable. Changing it would invalidate the stored
 * config and orphan every output produced under the old one; that is a new
 * recipe, and `recipe.create` is how you make one.
 */
export const recipeUpdate = defineTool({
  name: 'recipe.update',
  version: 1,

  summary:
    "Edit a saved recipe's name, config or schedule. The config is validated against the recipe's existing " +
    'kind, which cannot be changed. Free, no run is triggered.',

  input: RecipeUpdateInput,
  output: RecipeOut,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Sending the same edit twice lands the same row. Unlike `.create`, which makes
  // a second recipe.
  idempotent: true,
  surfaces: ['AUTO-01', 'AUTO-02'],

  async handler(input, ctx) {
    const existing = await ctx.db.recipes.get(input.id, input.genomeId, ctx.orgId);
    if (!existing) throw new ToolError('NOT_FOUND', 'No such recipe.', { id: input.id });

    if (input.name === undefined && input.config === undefined && input.intervalMinutes === undefined) {
      // Refused rather than answered "done": a call that names a recipe and
      // changes nothing is a caller bug, and success would hide it behind a
      // screen that appears to save.
      throw new ToolError('INVALID_INPUT', 'Nothing to change — pass name, config, or intervalMinutes.', {
        id: input.id,
      });
    }

    /**
     * Validated against the *stored* kind, not one the caller supplies. That is
     * the difference between an edit and a way to smuggle an `rss` config into an
     * `auto_trend` recipe.
     */
    let config: unknown;
    if (input.config !== undefined) {
      const parsed = schemaFor(existing.kind as z.infer<typeof KIND>).safeParse(input.config);
      if (!parsed.success) {
        throw new ToolError(
          'INVALID_INPUT',
          `Invalid ${existing.kind} config: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          { kind: existing.kind },
        );
      }
      config = parsed.data;
    }

    const row = await ctx.db.recipes.update({
      id: input.id,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(input.intervalMinutes !== undefined ? { intervalMinutes: input.intervalMinutes } : {}),
    });
    if (!row) throw new ToolError('NOT_FOUND', 'No such recipe.', { id: input.id });

    const notApplied = input.config !== undefined ? scanNotApplied(input.config) : [];
    if (notApplied.length) {
      ctx.logger.warn('recipe updated with fields the engine does not act on', {
        recipeId: row.id,
        fields: notApplied.map((n) => n.field),
      });
    }

    ctx.logger.info('recipe updated', {
      recipeId: row.id,
      changed: Object.keys(input).filter((k) => k !== 'id' && k !== 'genomeId'),
    });
    return { ...toOut(row), ...(notApplied.length ? { notApplied } : {}) };
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
  /**
   * Two values, not three. `completed` is what the engine sets when a recipe's own
   * `endAt` passes, and it is not a thing to be *chosen* — offering it here would
   * let a caller retire a recipe by claiming its window had closed, and would give
   * two spellings for what "stop this" means.
   */
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

/** What a runner needs to read a source for one genome. Shared by `.run` and `.preview`. */
async function runContextFor(deps: RecipeDeps, ctx: ToolCtx, genomeId: string): Promise<RecipeRunContext> {
  const genome = await ctx.db.genomes.get(genomeId, ctx.orgId);
  if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId });
  const assets = await ctx.db.assets.inventory(genomeId, ctx.orgId);
  return {
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
      const conn = await ctx.db.oauthConnections.get(genomeId, ctx.orgId, provider);
      return conn?.accessToken;
    },
  };
}

/**
 * When this recipe's next post can go out: after the last one it already has
 * queued, and never sooner than one stagger from now.
 *
 * Reading the queue rather than counting from "now" is what keeps two approvals
 * a minute apart, or a run landing while the previous run's posts are still
 * waiting, from stacking posts on the same instant. The lead also leaves time for
 * the queue's own drafting call to land before the scheduler would draft it.
 */
async function nextSlot(ctx: ToolCtx, recipeId: string, genomeId: string): Promise<Date> {
  const last = await ctx.db.recipes.lastScheduledAt(recipeId, genomeId, ctx.orgId);
  const soonest = Date.now() + RECIPE_STAGGER_MS;
  return new Date(Math.max(soonest, last ? last.getTime() + RECIPE_STAGGER_MS : 0));
}

/**
 * Turns one output into scheduled posts — one per chosen account — carrying the
 * recipe's id, its CTA link and the output's brief. Returns the posts' ids and
 * when the slot after them is.
 *
 * The copy is deliberately not written here. Each post carries its intent and
 * the scheduler drafts it when it comes due — the same path a campaign slot
 * takes, so there is one drafting path rather than two that can disagree about
 * the same playbook. (The queue's Approve drafts the copy straight away so the
 * person can read it; the scheduler then finds the copy written and publishes.)
 *
 * The chosen accounts the format supports, or every chosen account when it
 * supports none of them: the person picked those accounts, and the format is
 * the engine's guess. No accounts chosen leaves the platform to the playbook's
 * first, the scheduler's long-standing fallback.
 */
async function schedulePosts(
  ctx: ToolCtx,
  recipe: { id: string; name: string; kind: string; config: unknown },
  genomeId: string,
  output: RecipeOutputPreview,
  at: Date,
): Promise<{ ids: string[]; next: Date }> {
  const playbook = output.playbookId ? byId(output.playbookId) : undefined;
  if (!output.playbookId || !playbook) return { ids: [], next: at };

  const common = RecipeCommonConfig.partial().safeParse(recipe.config);
  const targets = common.success ? (common.data.targetPlatforms ?? []) : [];
  const ctaUrl = common.success ? common.data.ctaUrl : undefined;
  const supported = targets.filter((p) => playbook.output.platforms.includes(p));
  const platforms: Array<Platform | undefined> = targets.length ? (supported.length ? supported : targets) : [undefined];

  const ids: string[] = [];
  let slot = at.getTime();
  for (const platform of platforms) {
    const item = await ctx.db.content.createDraft({
      genomeId,
      orgId: ctx.orgId,
      playbookId: output.playbookId,
      mode: playbook.mode === 'direct_finish' ? 'direct_finish' : playbook.mode,
      pillar: playbook.content_pillar,
      copy: [],
      why: {
        summary: `${recipe.name} proposed this from ${output.sourceUrl ?? output.title}.`,
        factors: [
          { label: 'recipe', detail: recipe.name },
          { label: 'kind', detail: recipe.kind },
          ...(output.playbookName ? [{ label: 'format', detail: output.playbookName }] : []),
          ...(platform ? [{ label: 'account', detail: `${platform}, chosen on the recipe` }] : []),
          ...(output.sourceUrl ? [{ label: 'source', detail: output.sourceUrl }] : []),
        ],
        evidence: output.trendId ? [{ kind: 'trend' as const, id: output.trendId }] : [],
        alternatives: [],
      },
      recipeId: recipe.id,
      intent: output.intent,
      // Counts toward PRD §5's trend-to-post rate like a hand-made one. The
      // trend's id, not its title — the title was stored here before, so the
      // join this column exists for matched nothing.
      ...(output.trendId ? { sourceTrendId: output.trendId } : {}),
      ...(platform ? { platform } : {}),
      ...(ctaUrl ? { linkUrl: ctaUrl } : {}),
      scheduledAt: new Date(slot),
    });
    ids.push(item.id);
    slot += RECIPE_STAGGER_MS;
  }
  return { ids, next: new Date(slot) };
}

export function makeRecipeRun(deps: RecipeDeps) {
  return defineTool({
    name: 'recipe.run',
    version: 1,

    summary: 'Run a recipe right now instead of waiting for its schedule. New items go to the review queue, ' +
      'or straight onto the calendar when the recipe has review-before-publish switched off. Items the recipe ' +
      'produced before are skipped.',

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

      const runCtx = await runContextFor(deps, ctx, input.genomeId);

      /**
       * PRD §8.10's start/end options. A recipe outside its window produces
       * nothing and says why, rather than silently running or silently not.
       */
      const window = withinRunWindow(recipe.config, new Date());
      if (!window.ok) {
        /**
         * Past its end date, the recipe is retired rather than merely refused.
         *
         * This used to return and stop, which was correct about *this* run and
         * wrong about every subsequent one: `findDue` selects on
         * `status = 'active'` and knows nothing about `endAt`, so the scheduler
         * kept invoking an expired recipe every five minutes forever — an audit
         * row and one of ten batch slots each time, taken from recipes that could
         * still do work. Nothing ever cleared it, because nothing was looking.
         *
         * Only for `finished`, not for `not started yet`: a recipe with a future
         * `startAt` is waiting, and marking it completed would retire it before it
         * ever ran. `withinRunWindow` distinguishes the two by which bound it
         * failed, so that distinction is read here rather than re-derived.
         */
        if (window.expired) {
          await ctx.db.recipes.setStatus({
            id: input.id,
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            status: 'completed',
          });
          ctx.logger.info('recipe completed — past its end date', { id: input.id });
        }
        return {
          runId: '',
          outputCount: 0,
          error: window.reason,
          why: {
            summary: window.reason,
            factors: [
              { label: 'kind', detail: recipe.kind },
              ...(window.expired
                ? [{ label: 'status', detail: 'Marked completed — it will not be polled again.' }]
                : []),
            ],
            evidence: [],
            alternatives: [],
          },
        };
      }

      /**
       * "Skip items it has already posted" — the launch screen promised it and
       * nothing did it: a second run of an RSS recipe proposed the same five
       * articles again, and a bulk recipe re-proposed its whole sheet on every
       * cycle. Everything this recipe produced before, any status, is the memory.
       */
      const previous = await ctx.db.recipes.recentOutputPreviews(recipe.id, input.genomeId, ctx.orgId, 500);
      runCtx.seen = new Set(previous.flatMap(outputKeys));

      const { outputs, error } = await runRecipe(recipe.kind, recipe.config, runCtx);

      /**
       * ── Recipes publish now, which is the whole point of a recipe ──────────
       *
       * PRD §8.10's default is *"publish automatically if approvals are OFF and
       * content not flagged"*, with a per-recipe "review before publish"
       * checkbox as the opt-in. With review off, each output becomes scheduled
       * posts carrying the recipe's id. That id is what `policy.ts` rule 7 reads
       * back (via `publish.now`'s `policySubject`), so an unattended recipe post
       * is still subject to the workspace's approval mode, its restricted
       * platforms, its quiet windows and the `automationAutoPublish` permission.
       * "Autopublish" here means the *recipe* asks no further permission — not
       * that the brand's governance stops applying.
       *
       * Those outputs are recorded `approved` with the posts they became. They
       * used to be recorded `pending_review`, so the queue showed already-
       * scheduled posts as waiting on a person, and approving one made a second.
       */
      const needsReview = requiresReview(recipe.config);
      const scheduled: string[] = [];
      const records: Array<{ preview: unknown; status?: 'pending_review' | 'approved'; contentItemId?: string }> = [];

      let at = needsReview || !outputs.length ? new Date() : await nextSlot(ctx, recipe.id, input.genomeId);
      for (const output of outputs) {
        if (needsReview) {
          records.push({ preview: output });
          continue;
        }
        const { ids, next } = await schedulePosts(ctx, recipe, input.genomeId, output, at);
        at = next;
        if (!ids.length) {
          // No format fits it, so there is nothing to schedule. Left in the queue
          // where a person can see it and remove it, rather than dropped unseen.
          records.push({ preview: output });
          continue;
        }
        scheduled.push(...ids);
        records.push({ preview: { ...output, contentItemIds: ids }, status: 'approved', contentItemId: ids[0]! });
      }
      const unformatted = outputs.filter((o) => !o.playbookId).length;

      const { runId } = await ctx.db.recipes.recordRun({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        recipeId: recipe.id,
        status: error ? 'failed' : 'succeeded',
        outputCount: outputs.length,
        ...(error ? { error } : {}),
        outputs: records,
      });
      await ctx.db.recipes.markRan(recipe.id, input.genomeId, ctx.orgId, new Date());

      ctx.logger.info('recipe run', {
        recipeId: recipe.id,
        kind: recipe.kind,
        outputCount: outputs.length,
        scheduled: scheduled.length,
        failed: !!error,
      });

      return {
        runId,
        outputCount: outputs.length,
        ...(error ? { error } : {}),
        why: {
          summary: error
            ? `${recipe.name} failed: ${error}`
            : scheduled.length
              ? `${recipe.name} scheduled ${scheduled.length} post${scheduled.length === 1 ? '' : 's'} to publish.`
              : outputs.length
                ? `${recipe.name} produced ${outputs.length} item${outputs.length === 1 ? '' : 's'} for review.`
                : `${recipe.name} ran and found nothing it has not already produced.`,
          factors: [
            { label: 'kind', detail: recipe.kind },
            ...(unformatted
              ? [{ label: 'no format', detail: `${unformatted} item${unformatted === 1 ? '' : 's'} matched no format this brand can make, so they can only be removed.` }]
              : []),
          ],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}

/* ── recipe.preview ──────────────────────────────────────────────────── */

export const RecipePreviewInput = z.object({
  genomeId: z.string().min(1),
  kind: KIND,
  config: z.unknown(),
});

export const RecipePreviewOutput = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      intent: z.string(),
      sourceUrl: z.string().optional(),
      /** The format it would become; absent when no format this brand can make fits it. */
      playbookName: z.string().optional(),
    }),
  ),
  error: z.string().optional(),
  why: Explanation,
});

/**
 * `recipe.preview` — what a recipe would produce if it ran now, without saving
 * anything. AUTO-04.3's "RSS URL + Preview" and AUTO-02.4's "Preview Trends":
 * the wizard had a feed URL box and nothing that read the feed, so a typo'd URL
 * or a feed with no items was discovered a day later as an empty run.
 *
 * The same runner as `recipe.run`, minus the history (an unsaved recipe has
 * none) and minus every write.
 */
export function makeRecipePreview(deps: RecipeDeps) {
  return defineTool({
    name: 'recipe.preview',
    version: 1,

    summary:
      'Show what a recipe config would produce right now — the feed items, sheet rows or trends it would turn into ' +
      'posts, and the format each would become. Reads the source; saves nothing. Free.',

    input: RecipePreviewInput,
    output: RecipePreviewOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    surfaces: ['AUTO-02.4', 'AUTO-03.4', 'AUTO-04.3'],

    async handler(input, ctx) {
      const parsed = schemaFor(input.kind).safeParse(input.config);
      if (!parsed.success) {
        const error = parsed.error.issues.map((i) => i.message).join('; ');
        return { items: [], error, why: { summary: `Not a valid ${input.kind} config yet: ${error}`, factors: [], evidence: [], alternatives: [] } };
      }
      const runCtx = await runContextFor(deps, ctx, input.genomeId);
      const { outputs, error } = await runRecipe(input.kind, parsed.data, runCtx);
      return {
        items: outputs.map((o) => ({
          title: o.title,
          intent: o.intent,
          ...(o.sourceUrl ? { sourceUrl: o.sourceUrl } : {}),
          ...(o.playbookName ? { playbookName: o.playbookName } : {}),
        })),
        ...(error ? { error } : {}),
        why: {
          summary: error
            ? error
            : outputs.length
              ? `A run now would produce ${outputs.length} item${outputs.length === 1 ? '' : 's'}.`
              : 'A run now would produce nothing.',
          factors: [{ label: 'kind', detail: input.kind }],
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

/**
 * `recipe.output.decide` — approving schedules the post.
 *
 * Approving used to need a `contentItemId` the caller had already made with
 * `content.draft`, and the draft that call made had no schedule, no recipe and no
 * account: an approved output became a loose draft that published only if
 * somebody went and scheduled it by hand. With review on — the default — no
 * recipe post ever went out on its own. Approving now does what review-off does
 * at run time: one scheduled post per chosen account, queued behind this
 * recipe's other posts, carrying its link and its recipe id. Approval is the
 * review the recipe asked for, so the publish is not held for it a second time
 * (see `contentPublishOrigin`).
 *
 * Passing `contentItemId` still records a draft the caller made itself.
 */
export const recipeOutputDecide = defineTool({
  name: 'recipe.output.decide',
  version: 1,

  summary:
    'Approve or reject one proposed output. Approving schedules it as a post on each of the recipe\'s chosen ' +
    'accounts, queued after the recipe\'s other posts; the copy is written before it goes out. Rejecting removes ' +
    'it, and the recipe will not propose it again.',

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
  // A repeated approval returns the already-approved row rather than scheduling
  // the post twice, so a replay is safe.
  idempotent: true,
  surfaces: ['AUTO-04.4'],

  async handler(input, ctx) {
    const existing = await ctx.db.recipes.getOutput(input.id, input.genomeId, ctx.orgId);
    if (!existing) throw new ToolError('NOT_FOUND', 'No such output.', { id: input.id });
    if (existing.status === input.status) return toOutputOut(existing);
    if (existing.status !== 'pending_review') {
      throw new ToolError('INVALID_INPUT', `This output was already ${existing.status}.`, { id: input.id });
    }

    if (input.status === 'rejected' || input.contentItemId) {
      const row = await ctx.db.recipes.decideOutput({
        id: input.id,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        status: input.status,
        ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
      });
      if (!row) throw new ToolError('NOT_FOUND', 'No such output.', { id: input.id });
      return toOutputOut(row);
    }

    const preview = (existing.preview ?? {}) as RecipeOutputPreview;
    if (!preview.playbookId) {
      throw new ToolError(
        'INVALID_INPUT',
        'No format this brand can make fits this item, so there is nothing to post. Remove it instead.',
        { id: input.id },
      );
    }
    const recipe = await ctx.db.recipes.get(existing.recipeId, input.genomeId, ctx.orgId);
    if (!recipe) throw new ToolError('NOT_FOUND', 'The recipe that produced this output no longer exists.', { id: input.id });

    const at = await nextSlot(ctx, recipe.id, input.genomeId);
    const { ids } = await schedulePosts(ctx, recipe, input.genomeId, preview, at);
    if (!ids.length) {
      throw new ToolError('INVALID_INPUT', `The format ${preview.playbookId} no longer exists, so this cannot be posted.`, { id: input.id });
    }

    const row = await ctx.db.recipes.decideOutput({
      id: input.id,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      status: 'approved',
      contentItemId: ids[0]!,
      preview: { ...preview, contentItemIds: ids },
    });
    if (!row) throw new ToolError('NOT_FOUND', 'No such output.', { id: input.id });
    ctx.logger.info('recipe output approved and scheduled', { id: input.id, posts: ids.length, at: at.toISOString() });
    return toOutputOut(row);
  },
});

function toOut(row: { id: string; genomeId: string; kind: string; name: string; config: unknown; status: 'active' | 'paused' | 'completed'; intervalMinutes?: number; lastRunAt?: Date; createdAt: Date }) {
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
