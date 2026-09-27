import { invokeTool, type CreditStore, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import { byId, PLAYBOOKS } from '@sparksocial/playbooks';
import type { UnrenderedContentSource } from '@sparksocial/db';
import { makeDevResolveCtx } from './dev-auth.js';

/**
 * THE RENDER QUEUE — makes the pixels a campaign promised.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * Drafting writes the script. `compose.render` makes the file, and nothing
 * called it: it was reachable from exactly one place, a button in the Draft
 * Panel. So activating a thirty-day campaign produced eleven scripts and zero
 * pixels. The calendar said "video", the campaign said "video", every post was
 * a script, and nothing anywhere said so — the owner had to notice.
 *
 * ── Why a poll loop and not a call at activation ──────────────────────────
 *
 * Activation is the wrong moment. `calendar.generate` writes *slots* — playbook,
 * pillar and date, no copy — and the copy arrives later, from the scheduler or
 * from somebody opening the post. Rendering at activation would render nothing,
 * because at activation there is nothing to render.
 *
 * So this watches for the state that actually matters — a post in a live
 * campaign that has words and no file — and is therefore right whether the copy
 * arrived at activation, an hour later from the scheduler, or a week later from
 * a person. It is also the same poll-loop trade the publish and recipe
 * schedulers already make, for the reasons `index.ts` gives about env flags
 * being one more thing to forget.
 *
 * ── Why it goes through `invokeTool` ──────────────────────────────────────
 *
 * Same reason the publish scheduler does. Rendering spends money, and
 * `compose.render` records `cost_cents` and passes through the policy engine.
 * Calling the composer directly would be a spend path with no ledger and no
 * budget ceiling, which is precisely the path nobody is watching.
 */

export interface RenderQueueDeps {
  source: UnrenderedContentSource;
  db: ScopedDb;
  invoke: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<InvokeRequest['brand']>;
  /** The same ledger the publish scheduler reads — see its comment on why this matters. */
  credits?: CreditStore;
  /**
   * The tool invoker, injectable purely so a test can assert what this loop
   * asks for.
   *
   * Without it the only observable behaviour is "did it reach the network",
   * and the cases worth pinning here are all about what it decides *not* to
   * render — which a test can only distinguish from a broken loop by seeing
   * the positive case work too.
   */
  invokeTool?: typeof invokeTool;
}

/**
 * How many posts one tick will render.
 *
 * Small, and smaller than the publish batch. A render is tens of seconds of CPU
 * and real money, where a publish is an HTTP call; a campaign activating with
 * eleven drafted posts should feed the queue over several minutes rather than
 * saturate the box and bill for all of it at once.
 */
const BATCH_SIZE = 2;

export function startRenderQueue(deps: RenderQueueDeps, intervalMs: number): { stop: () => void } {
  let running = false;

  const tick = async () => {
    // A render can outlast the interval comfortably, so overlap is the normal
    // case rather than the exception — without this guard a slow batch would
    // have a second tick rendering the same rows beside it.
    if (running) return;
    running = true;
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[error] render queue: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

/**
 * Playbooks that produce no pixels, computed once from the library.
 *
 * Passed to the query so they never enter a batch. They used to be skipped
 * inside the loop instead, which is where the queue quietly died: the batch is
 * two, ordered oldest first, so two old text posts held the front of the line
 * and nothing behind them was ever rendered.
 */
const NO_PIXELS = PLAYBOOKS.filter((p) => p.output.media_type === 'text').map((p) => p.playbook_id);

export async function runOnce(deps: RenderQueueDeps): Promise<void> {
  const pending = await deps.source.findUnrendered(BATCH_SIZE, NO_PIXELS);

  for (const item of pending) {
    try {
      await renderOne(item, deps);
    } catch (e) {
      console.error('[error] render queue: render failed', {
        contentItemId: item.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function renderOne(
  item: Awaited<ReturnType<UnrenderedContentSource['findUnrendered']>>[number],
  deps: RenderQueueDeps,
): Promise<void> {
  /*
   * A text post has no pixels, and asking the composer for some would spend a
   * render to produce a picture of a caption nobody wants. The media type is
   * the playbook's, so an item whose playbook no longer resolves is skipped
   * rather than guessed at.
   */
  const playbook = item.playbookId ? byId(item.playbookId) : undefined;
  if (!playbook || playbook.output.media_type === 'text') return;

  const genome = await deps.db.genomes.get(item.genomeId, item.orgId);
  if (!genome) return;

  const base = await makeDevResolveCtx(deps.db, deps.credits)(
    new Request('http://localhost/', {
      headers: {
        'x-org-id': item.orgId,
        'x-brand-id': genome.workspace_id,
        // Same reason the publish scheduler sets this: without it the ctx
        // carries the dev default and every cross-genome check refuses.
        'x-genome-id': item.genomeId,
        'x-role': 'admin',
      },
    }),
  );
  const { userId: _drop, caller: _caller, ...ctx } = base;
  const brand = await deps.loadBrandGovernance(item.orgId, genome.workspace_id);

  const invoke = deps.invokeTool ?? invokeTool;
  const rendered = await invoke(
    {
      tool: 'compose.render',
      input: { genomeId: item.genomeId, contentItemId: item.id },
      caller: 'agent',
      ctx,
      brand,
      /*
       * Keyed on the item, not on the attempt. `compose.render` declares itself
       * non-idempotent because a *deliberate* re-render is a new render — but a
       * queue that retried a transient failure without a stable key would bill
       * twice for one post, and the query that feeds this loop already stops
       * once a render exists.
       */
      idempotencyKey: `queued-render:${item.id}`,
    },
    deps.invoke,
  );

  if (rendered.status !== 'succeeded') {
    const why =
      rendered.status === 'failed'
        ? rendered.error.message
        : `Rendering was held by policy (${rendered.decision.kind}).`;
    /*
     * Logged, not marked on the item. A post that failed to render is still a
     * perfectly good post — it has its copy, and `publish.now` can send a
     * caption without a file. Blocking it here would take a working post off
     * the calendar because its optional half failed, which is the opposite of
     * what this loop is for.
     */
    console.warn('[warn] render queue: could not render this item', { contentItemId: item.id, why });
    return;
  }

  console.info('[info] render queue: rendered', {
    contentItemId: item.id,
    playbookId: playbook.playbook_id,
    mediaType: playbook.output.media_type,
  });
}
