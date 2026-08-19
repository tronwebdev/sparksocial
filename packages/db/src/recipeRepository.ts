import type { RecipeStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/** `recipes` / `recipe_runs` / `recipe_outputs` backed by Postgres — Automation Recipes (plan §12 P5). Genome-scoped through `scoped.ts`. */
export function createRecipeRepository(db: Database): RecipeStore {
  return {
    async create({ genomeId, orgId, kind, name, config, intervalMinutes }) {
      const row = await scoped.createRecipe(
        db,
        { orgId, brandId: orgId, genomeId },
        { kind, name, config, ...(intervalMinutes ? { intervalMinutes } : {}) },
      );
      return toRecipe(row);
    },

    async get(id, genomeId, orgId) {
      const row = await scoped.getRecipe(db, { orgId, brandId: orgId, genomeId }, id);
      return row ? toRecipe(row) : undefined;
    },

    async list(genomeId, orgId) {
      const rows = await scoped.listRecipes(db, { orgId, brandId: orgId, genomeId });
      return rows.map(toRecipe);
    },

    async setStatus({ id, genomeId, orgId, status }) {
      const row = await scoped.setRecipeStatus(db, { orgId, brandId: orgId, genomeId }, { id, status });
      return row ? toRecipe(row) : undefined;
    },

    async delete(id, genomeId, orgId) {
      await scoped.deleteRecipe(db, { orgId, brandId: orgId, genomeId }, id);
    },

    async markRan(id, genomeId, orgId, at) {
      await scoped.markRecipeRan(db, { orgId, brandId: orgId, genomeId }, id, at);
    },

    async findDue(before) {
      const rows = await scoped.findDueRecipes(db, before);
      return rows.map((r) => ({ ...toRecipe(r), orgId: r.orgId }));
    },

    async recordRun({ genomeId, orgId, recipeId, status, outputCount, error, outputs }) {
      return scoped.recordRecipeRun(
        db,
        { orgId, brandId: orgId, genomeId },
        { recipeId, status, outputCount, ...(error ? { error } : {}), outputs },
      );
    },

    async listOutputs(genomeId, orgId, args) {
      const rows = await scoped.listRecipeOutputs(db, { orgId, brandId: orgId, genomeId }, args);
      return rows.map(toOutput);
    },

    async decideOutput({ id, genomeId, orgId, status, contentItemId }) {
      const row = await scoped.decideRecipeOutput(
        db,
        { orgId, brandId: orgId, genomeId },
        { id, status, ...(contentItemId ? { contentItemId } : {}) },
      );
      return row ? toOutput(row) : undefined;
    },
  };
}

function toRecipe(row: scoped.RecipeRow) {
  return {
    id: row.id,
    genomeId: row.genomeId,
    kind: row.kind,
    name: row.name,
    config: row.config,
    status: row.status as 'active' | 'paused',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.intervalMinutes ? { intervalMinutes: row.intervalMinutes } : {}),
    ...(row.lastRunAt ? { lastRunAt: row.lastRunAt } : {}),
  };
}

function toOutput(row: scoped.RecipeOutputRow) {
  return {
    id: row.id,
    recipeId: row.recipeId,
    runId: row.runId,
    genomeId: row.genomeId,
    status: row.status as 'pending_review' | 'approved' | 'rejected',
    preview: row.preview,
    createdAt: row.createdAt,
    ...(row.contentItemId ? { contentItemId: row.contentItemId } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
  };
}
