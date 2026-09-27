import { invokeTool, type CreditStore, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import { byId, PLAYBOOKS } from '@sparksocial/playbooks';
import { ResolvedBeat } from '@sparksocial/generate';
import { autoIllustrate } from './auto-illustrate.js';
import type { UnrenderedContentSource } from '@sparksocial/db';
import { createHash } from 'node:crypto';
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
   * Embeddings, for matching the brand's own pictures against a post's words.
   *
   * Absent turns auto-illustration off rather than failing: a deployment with
   * no embedder still renders, it just renders on the brand's flat ground the
   * way everything did before.
   */
  embed?: { embed(text: string): Promise<number[]> };
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

  /*
   * Give it pictures first.
   *
   * Before the renderer, deliberately: `compose.render` draws whatever the
   * beats hold, so a post reaching it with nothing but words produces a
   * caption on a flat ground — correct, and indistinguishable from a
   * placeholder. Illustrating here means every render in a campaign gets the
   * brand's own photographs where they exist, and something made where they
   * do not.
   *
   * Its failures are its own. A post that could not be illustrated is still a
   * post, and it renders exactly as it would have before this existed.
   */
  if (deps.embed) {
    try {
      const beats = ResolvedBeat.array().safeParse(item.copy);
      if (beats.success) {
        const { beats: illustrated, result } = await autoIllustrate({
          beats: beats.data,
          playbook,
          contentItemId: item.id,
          genomeId: item.genomeId,
          ctx,
          brand,
          deps: {
            db: deps.db,
            invoke: deps.invoke,
            embed: deps.embed,
            ...(deps.invokeTool ? { invokeTool: deps.invokeTool } : {}),
          },
        });
        if (result.fromAssets || result.generated) {
          /*
           * Written back before rendering, and this is the step that undoes
           * what the generators did: both of them *replace* the beat they are
           * given, so the row at this moment holds a picture where the copy
           * used to be. Re-saving the beats this function holds puts the words
           * back with the backdrop attached.
           */
          await deps.db.content.updateDraft({
            id: item.id,
            genomeId: item.genomeId,
            orgId: item.orgId,
            copy: illustrated,
            why: { summary: 'Illustrated before rendering.', factors: [], evidence: [], alternatives: [] },
          });
        }
      }
    } catch (e) {
      console.warn('[warn] render queue: auto-illustration failed', {
        contentItemId: item.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const invoke = deps.invokeTool ?? invokeTool;
  const rendered = await invoke(
    {
      tool: 'compose.render',
      input: { genomeId: item.genomeId, contentItemId: item.id },
      caller: 'agent',
      ctx,
      brand,
      /*
       * Keyed on the post's *content*, not just its id.
       *
       * A stable per-item key deadlocks, and did: the idempotency record
       * outlives the render row, so once a row is gone — retention, cleanup, a
       * failed upload — every later tick gets the cached success back, writes
       * nothing, and finds the same item again. A loop that reports "rendered"
       * forever while rendering nothing, and with a batch of two it blocks
       * everything behind it. Watched it happen: four `render queue: rendered`
       * lines against zero rows in the table.
       *
       * Hashing the copy also makes the key mean the right thing. A post whose
       * words changed — most obviously the moment auto-illustration attaches a
       * backdrop — is a different post and deserves a new render. A genuine
       * retry of unchanged copy still collapses onto one charge, which is what
       * the key was for.
       */
      idempotencyKey: `queued-render:${item.id}:${fingerprint(item.copy)}`,
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

  /*
   * Did the render actually survive?
   *
   * `invokeTool` returns the *recorded* result for a key it has seen, without
   * re-running the tool. So an item whose render rows have gone — retention, a
   * cleanup, a restore — gets a cached success back, writes nothing, and is
   * found again by the very next tick. The queue then reports "rendered"
   * forever while rendering nothing, and with a batch of two it blocks
   * everything behind it. Observed exactly that: four success lines against an
   * empty table.
   *
   * Hashing the copy into the key fixes the common case, where the post
   * changed. It cannot fix this one, where the post is identical and only the
   * output is missing — so the outcome is checked rather than assumed, and one
   * cache-busting attempt is made. Bounded to a single extra call: if that also
   * produces nothing, something is wrong that a retry loop will not mend, and
   * saying so once beats billing for it every five minutes.
   */
  const existing = await deps.db.content.listRenders(item.id, item.genomeId, item.orgId).catch(() => []);
  if (existing.length === 0) {
    const retried = await invoke(
      {
        tool: 'compose.render',
        input: { genomeId: item.genomeId, contentItemId: item.id },
        caller: 'agent',
        ctx,
        brand,
        idempotencyKey: `queued-render:${item.id}:${fingerprint(item.copy)}:recovered`,
      },
      deps.invoke,
    );
    if (retried.status !== 'succeeded') {
      console.warn('[warn] render queue: reported success but stored nothing, and the retry failed', {
        contentItemId: item.id,
      });
      return;
    }
  }

  console.info('[info] render queue: rendered', {
    contentItemId: item.id,
    playbookId: playbook.playbook_id,
    mediaType: playbook.output.media_type,
  });
}

/**
 * A short, stable fingerprint of a post's copy.
 *
 * Only needs to change when the content does, so a cheap non-cryptographic
 * digest is the right tool — this decides whether to spend a render, not
 * whether to trust anything.
 */
function fingerprint(copy: unknown): string {
  return createHash('sha1').update(JSON.stringify(copy ?? null)).digest('hex').slice(0, 12);
}
