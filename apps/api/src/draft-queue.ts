import { invokeTool, type CreditStore, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import type { UndraftedContentSource, UndraftedContentItem } from '@sparksocial/db';
import { makeDevResolveCtx } from './dev-auth.js';

/**
 * Writes a scheduled post's copy *before* it is due, so the render queue has
 * something to render.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * Three workers, each correct on its own, with a hole between them:
 *
 *   `calendar.generate`  writes the slots — playbook, pillar, time. Copy NULL.
 *   `scheduler.ts`       at due-time, drafts the copy if it is missing and
 *                        publishes it in the same tick.
 *   `render-queue.ts`    every 5 minutes, renders posts that have copy and no
 *                        render yet.
 *
 * A slot whose copy only ever arrives from the scheduler is therefore drafted
 * and published in one breath, minutes after the render queue last looked and
 * without ever satisfying its `copy IS NOT NULL` predicate. The post goes out as
 * a caption when the playbook called for a video. Nothing errors, nothing is
 * logged as wrong, and the calendar shows a published post — so the failure is
 * invisible unless you go and look at what was actually sent.
 *
 * The render queue reliably covered only the posts a human had already opened in
 * the Draft Panel, which is to say: the ones where somebody was watching.
 *
 * This loop writes the copy early. Nothing else changes — the scheduler keeps
 * its own draft-at-due-time path as the backstop for anything this missed, and
 * the render queue keeps its predicate.
 *
 * ── Why a separate worker rather than drafting in `calendar.generate` ────
 *
 * Drafting at generation time would mean one model call per slot, synchronously,
 * while somebody waits on the Activate button — ninety for a quarter's calendar,
 * paid for up front, for a plan the owner is most likely about to change. A loop
 * with a horizon spends that money a few days before it is needed instead, and
 * stops spending it the moment the campaign is paused.
 *
 * ── Why it goes through `invokeTool` ─────────────────────────────────────
 *
 * Same reason as the render queue: policy, cost and the audit row. A loop that
 * called the draft handler directly would write copy with no `tool_calls` row,
 * no budget check and no approval ladder — and `content.draft` spends money, so
 * all three matter.
 */
export interface DraftQueueDeps {
  source: UndraftedContentSource;
  db: ScopedDb;
  invoke: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<InvokeRequest['brand']>;
  /** The same ledger the other two loops read. */
  credits?: CreditStore;
  /** Injectable purely so a test can assert what this loop asks for. */
  invokeTool?: typeof invokeTool;
}

/**
 * How many posts one tick will draft.
 *
 * Three, against the render queue's two. A draft is one model call of a few
 * seconds where a render is tens of seconds of CPU, so the loop can run a little
 * further ahead without saturating anything — but it is still money per call,
 * and a campaign activating with ninety slots should feed in over minutes rather
 * than bill for the quarter at once.
 */
const BATCH_SIZE = 3;

export function startDraftQueue(
  deps: DraftQueueDeps,
  intervalMs: number,
  lookaheadMs: number,
): { stop: () => void } {
  let running = false;

  const tick = async () => {
    // Same re-entrancy guard as the render queue, for the same reason: a batch
    // of model calls can outlast a short interval, and a second tick beside it
    // would draft the same rows twice.
    if (running) return;
    running = true;
    try {
      await runOnce(deps, lookaheadMs);
    } catch (e) {
      console.error('[error] draft queue: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

/**
 * Slots this process has already failed to draft.
 *
 * ── Why this exists, and why it is only in memory ────────────────────────
 *
 * The batch is ordered by `scheduled_at` and limited, so an item that can never
 * be drafted — a playbook that no longer resolves, a genome missing something
 * its template needs — sits at the head of the queue and is retried on every
 * tick forever, while everything behind it waits. That is precisely the
 * head-of-line block `findUnrenderedContentItems` documents having already been
 * caused once by filtering in the loop instead of the query, and it is worse
 * here because each retry is a paid model call.
 *
 * In memory, not a column, because the alternative is a schema change to record
 * a fact that is usually transient. A restart retries everything once, which is
 * the right default: most causes (a vendor outage, a budget that has since
 * reset) are gone by then, and a genuinely broken slot simply fails once more
 * and goes back in the set. If a permanent marker is ever wanted, it belongs on
 * the item as a reviewable state, not as a silent skip.
 */
const failed = new Set<string>();

export async function runOnce(deps: DraftQueueDeps, lookaheadMs: number): Promise<void> {
  const before = new Date(Date.now() + lookaheadMs);
  /*
   * Over-fetch, then filter the skip set in the caller.
   *
   * The skipping has to happen somewhere, and the query cannot know about an
   * in-memory set. Asking for more than the batch size means a few stuck items
   * do not starve the tick — the batch still fills from the rows behind them.
   */
  const candidates = await deps.source.findUndrafted(before, BATCH_SIZE + failed.size);
  const pending = candidates.filter((item) => !failed.has(item.id)).slice(0, BATCH_SIZE);

  for (const item of pending) {
    try {
      await draftOne(item, deps);
    } catch (e) {
      failed.add(item.id);
      console.error('[error] draft queue: draft failed', {
        contentItemId: item.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function draftOne(item: UndraftedContentItem, deps: DraftQueueDeps): Promise<void> {
  if (!item.playbookId) {
    // Nothing to draft from. Not a failure worth retrying: a slot's playbook is
    // set when it is created and does not appear later.
    failed.add(item.id);
    return;
  }

  const genome = await deps.db.genomes.get(item.genomeId, item.orgId);
  if (!genome) {
    failed.add(item.id);
    console.warn('[warn] draft queue: no genome for this item', { contentItemId: item.id });
    return;
  }

  // The same clock-has-no-session ctx the render queue and the publish scheduler
  // build, and for the same reason — see `render-queue.ts`.
  const base = await makeDevResolveCtx(deps.db, deps.credits)(
    new Request('http://localhost/', {
      headers: {
        'x-org-id': item.orgId,
        'x-brand-id': genome.workspace_id,
        'x-genome-id': item.genomeId,
        'x-role': 'admin',
      },
    }),
  );
  const { userId: _drop, caller: _caller, ...ctx } = base;
  const brand = await deps.loadBrandGovernance(item.orgId, genome.workspace_id);

  const invoke = deps.invokeTool ?? invokeTool;
  const drafted = await invoke(
    {
      tool: 'content.draft',
      input: {
        genomeId: item.genomeId,
        playbookId: item.playbookId,
        contentItemId: item.id,
        intent: item.intent ?? '',
      },
      caller: 'agent',
      ctx,
      brand,
      /*
       * A stable per-item key, unlike the render queue's content hash.
       *
       * There is no content to hash — that is the whole point of this loop — and
       * the operation it guards is "give this empty slot its first copy", which
       * happens exactly once. The query's `copy IS NULL` already stops a second
       * attempt on a drafted slot, so the key is the belt to that braces: two
       * ticks racing the same row collapse onto one charge rather than paying a
       * model twice for words only one of them will keep.
       *
       * Distinct from the scheduler's `scheduled-draft:<id>` on purpose. Sharing
       * it would make a failed early draft return its cached failure to the
       * scheduler at due-time, turning this loop's bad day into a post that
       * never goes out — the opposite of a backstop.
       */
      idempotencyKey: `ahead-draft:${item.id}`,
    },
    deps.invoke,
  );

  if (drafted.status !== 'succeeded') {
    const why =
      drafted.status === 'failed'
        ? drafted.error.message
        : `Drafting was held by policy (${drafted.decision.kind}).`;
    /*
     * Logged and skipped, never marked on the item.
     *
     * A slot this loop could not draft is not a broken slot — the scheduler will
     * try again at due-time and publish it if it can, which is exactly the
     * behaviour that existed before this file. Writing a failure onto the row
     * would take a working post off the calendar because its *early* draft
     * failed, which is the opposite of what running ahead is for.
     *
     * It does go in the skip set: whatever refused it — a budget cap, an
     * approval gate, a playbook that will not resolve — refuses it identically
     * on the next tick, and this loop is not the place to argue.
     */
    failed.add(item.id);
    console.warn('[warn] draft queue: could not draft ahead', { contentItemId: item.id, why });
    return;
  }

  console.info('[info] draft queue: drafted ahead of schedule', {
    contentItemId: item.id,
    scheduledAt: item.scheduledAt?.toISOString(),
  });
}

/** Test seam: the skip set outlives a tick by design, so a test must clear it. */
export function __resetFailedForTest(): void {
  failed.clear();
}
