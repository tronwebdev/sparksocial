import { invokeTool, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import { makeDevResolveCtx } from './dev-auth.js';

/**
 * THE RECIPE SCHEDULER — the "unattended" half of §12 P5's exit line: *"a
 * recipe runs unattended for two weeks producing on-brand, non-duplicate
 * output within budget."* Without this, `recipe.schedule` + an
 * `intervalMinutes` would only ever mean "remember the interval" — the same
 * gap `scheduler.ts`'s own comment describes for `content.schedule` before
 * it existed, and the same poll-loop trade-off applies here for the same
 * reason (no Trigger.dev wiring yet).
 *
 * Goes through `invokeTool('recipe.run', ...)` rather than calling the
 * runner directly, for the same reason the publish scheduler goes through
 * `invokeTool('publish.now', ...)`: the same action performed by clicking
 * "Run now" and by the clock arriving must produce identical `tool_calls`
 * rows (P1's exit criterion), not a second, untracked code path.
 */

export interface RecipeSchedulerDeps {
  db: ScopedDb;
  invoke: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<InvokeRequest['brand']>;
  now?: () => Date;
}

const BATCH_SIZE = 10;

export function startRecipeScheduler(deps: RecipeSchedulerDeps, intervalMs: number): { stop: () => void } {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[error] recipe-scheduler: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runOnce(deps: RecipeSchedulerDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const due = (await deps.db.recipes.findDue(now)).slice(0, BATCH_SIZE);

  for (const recipe of due) {
    try {
      await runOne(recipe, deps);
    } catch (e) {
      console.error('[error] recipe-scheduler: run failed', {
        recipeId: recipe.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function runOne(
  recipe: Awaited<ReturnType<ScopedDb['recipes']['findDue']>>[number],
  deps: RecipeSchedulerDeps,
): Promise<void> {
  const genome = await deps.db.genomes.get(recipe.genomeId, recipe.orgId);
  if (!genome) {
    console.warn('[warn] recipe-scheduler: genome not found, skipping', { recipeId: recipe.id });
    return;
  }

  const base = await makeDevResolveCtx(deps.db)(
    new Request('http://localhost/', {
      headers: {
        'x-org-id': recipe.orgId,
        'x-brand-id': genome.workspace_id,
        'x-genome-id': recipe.genomeId,
        'x-role': 'admin',
      },
    }),
  );
  const { userId: _drop, caller: _caller, ...ctx } = base;
  const brand = await deps.loadBrandGovernance(recipe.orgId, genome.workspace_id);

  const result = await invokeTool(
    {
      tool: 'recipe.run',
      input: { id: recipe.id, genomeId: recipe.genomeId },
      caller: 'agent',
      ctx,
      brand,
      idempotencyKey: `scheduled:${recipe.id}:${(deps.now ?? (() => new Date()))().toISOString().slice(0, 16)}`,
    },
    deps.invoke,
  );

  if (result.status === 'failed') {
    console.error('[error] recipe-scheduler: recipe.run failed', { recipeId: recipe.id, code: result.error.code, message: result.error.message });
  }
}
