import { invokeTool, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import type { OutcomeCandidateRow, OutcomeCandidateSource } from '@sparksocial/db';
import { makeDevResolveCtx } from './dev-auth.js';

/**
 * THE OUTCOME OBSERVER — the clock that closes PRD §6.7's learning loop.
 *
 * ── The gap this fills ────────────────────────────────────────────────────
 *
 * `analytics.sync` and `learning.record_outcome` were both built, tested, and
 * registered. Nothing ever called either one. The mix engine's Thompson-sampling
 * arms therefore sat at their `alpha: 1, beta: 1` cold-start priors forever, and
 * `learning.reweight` had nothing to reweight from — so every "SPARK is learning
 * your brand" claim in the product was, in the literal sense, untrue.
 *
 * Nothing was broken. There was simply no clock, and both tools need one: a post
 * publishes, and the thing worth knowing about it happens over the following
 * days, when no user action is going to trigger a tool call.
 *
 * ── Two phases, in this order, on one clock ───────────────────────────────
 *
 * 1. **Sync** the metrics of published posts whose numbers have gone stale, on a
 *    cadence that widens with the post's age (`findMetricsSyncDue` explains
 *    why a fixed interval is wrong in both directions at once).
 * 2. **Score** posts that have had time to mature and have at least one metrics
 *    snapshot, recording one outcome each against their pillar's arm.
 *
 * Sync runs first in the same tick so a post that crosses its maturation
 * threshold is scored against numbers read moments ago rather than numbers from
 * the previous cycle. The ordering is the only coupling between the phases;
 * either can find nothing and the other still runs.
 *
 * ── Why the maturation window is the important part ───────────────────────
 *
 * The naive version of this file scores each post as it publishes. That would be
 * worse than not having a learning loop at all: engagement is near-zero minutes
 * after publishing, so every post would be recorded as a *failure*, and the mix
 * engine would confidently learn to avoid whatever was posted most recently. The
 * arms would fill with real-looking observations pointing the wrong way. The
 * window, and the requirement that a snapshot exists at all, are what make the
 * numbers mean anything — see `findOutcomeRecordDue`.
 *
 * ── Why it goes through invokeTool ────────────────────────────────────────
 *
 * Same reason as the publish, recipe and trend schedulers: a metrics pull the
 * clock triggered and one an analyst triggered by hand must leave identical
 * `tool_calls` rows behind (P1's exit criterion), including cost. `analytics.sync`
 * spends real money on a vendor call, so it also has to pass through the same
 * budget check a user-initiated call does — which is the other thing calling the
 * handler directly would have quietly skipped.
 *
 * Unlike the trend observer, this work belongs to a tenant: every candidate row
 * carries its own `orgId`/`genomeId` and is invoked under that tenant's own
 * governance, the same shape `recipe-scheduler.ts` uses.
 */

export interface OutcomeObserverDeps {
  source: OutcomeCandidateSource;
  db: ScopedDb;
  invoke: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<InvokeRequest['brand']>;
  /** Posts per phase per tick. Bounded so one org's backlog cannot monopolise a tick. */
  batchSize?: number;
  /** Stop polling a post's metrics after this many days. See `findMetricsSyncDue`. */
  trackingDays?: number;
  /** How long a post accumulates before it is scored. See `findOutcomeRecordDue`. */
  maturationHours?: number;
  now?: () => Date;
}

const BATCH_SIZE = 25;

/**
 * Latched per process, not per tick.
 *
 * `analytics.sync` is only registered when a metrics vendor is configured, so on
 * an instance without one every candidate would produce an identical `NOT_FOUND`
 * every tick, forever. Once is worth saying; thousands of times buries whatever
 * else is in the log.
 */
let syncUnavailableLogged = false;

export function startOutcomeObserver(deps: OutcomeObserverDeps, intervalMs: number): { stop: () => void } {
  let running = false;

  const tick = async () => {
    // A tick that overruns its interval must not start a second one: the phases
    // are ordered, and two concurrent passes would sync and score the same
    // posts against each other.
    if (running) return;
    running = true;
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[error] outcome-observer: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runOnce(deps: OutcomeObserverDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const limit = deps.batchSize ?? BATCH_SIZE;

  await syncPhase(deps, now, limit);
  await scorePhase(deps, now, limit);
}

/* ── phase one: refresh what the platforms know ──────────────────────────── */

async function syncPhase(deps: OutcomeObserverDeps, now: Date, limit: number): Promise<void> {
  const due = await deps.source.findMetricsDue({
    now,
    limit,
    ...(deps.trackingDays !== undefined ? { trackingDays: deps.trackingDays } : {}),
  });
  if (due.length === 0) return;

  let synced = 0;
  for (const item of due) {
    try {
      const outcome = await invokeOne(deps, item, 'analytics.sync', {
        genomeId: item.genomeId,
        contentItemId: item.id,
      }, syncKey(item, now));

      if (outcome === 'unavailable') return; // No vendor: the rest of the batch would say the same.
      if (outcome === 'ok') synced++;
    } catch (e) {
      // One tenant's broken genome must not cost the other twenty-four posts in
      // this batch their sync. Not latched: the cadence read will offer this
      // post again on the next tick, which is the right retry.
      console.error('[error] outcome-observer: metrics sync failed', {
        contentItemId: item.id,
        genomeId: item.genomeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (synced > 0) console.log('[info] outcome-observer: synced metrics', { posts: synced, considered: due.length });
}

/* ── phase two: score what has had time to settle ────────────────────────── */

async function scorePhase(deps: OutcomeObserverDeps, now: Date, limit: number): Promise<void> {
  const due = await deps.source.findOutcomesDue({
    now,
    limit,
    ...(deps.maturationHours !== undefined ? { maturationHours: deps.maturationHours } : {}),
  });
  if (due.length === 0) return;

  let scored = 0;
  for (const item of due) {
    try {
      const outcome = await invokeOne(deps, item, 'learning.record_outcome', {
        genomeId: item.genomeId,
        contentItemId: item.id,
        // Permanent, not time-bucketed, unlike the sync key: a post has exactly
        // one outcome for its whole life, which is what the unique index on
        // `learning_outcomes.content_item_id` already says.
      }, `learning-outcome:${item.id}`);

      if (outcome === 'ok') scored++;
    } catch (e) {
      console.error('[error] outcome-observer: could not score a post', {
        contentItemId: item.id,
        genomeId: item.genomeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (scored > 0) console.log('[info] outcome-observer: recorded outcomes', { posts: scored, considered: due.length });
}

/* ── the shared invoke ──────────────────────────────────────────────────── */

type InvokeOutcome = 'ok' | 'failed' | 'unavailable';

/**
 * One tool call, under the candidate's own tenant.
 *
 * Returns rather than throws for the two expected non-successes, so a caller can
 * tell "this post failed" from "this whole capability is absent" — only the
 * second is a reason to abandon the batch.
 */
async function invokeOne(
  deps: OutcomeObserverDeps,
  item: OutcomeCandidateRow,
  tool: 'analytics.sync' | 'learning.record_outcome',
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<InvokeOutcome> {
  const genome = await deps.db.genomes.get(item.genomeId, item.orgId);
  if (!genome) {
    // A post whose brand is gone has nobody to learn on behalf of.
    console.warn('[warn] outcome-observer: genome not found, skipping', { contentItemId: item.id });
    return 'failed';
  }

  const base = await makeDevResolveCtx(deps.db)(
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

  const result = await invokeTool(
    {
      tool,
      input,
      caller: 'agent',
      ctx,
      brand,
      idempotencyKey,
    },
    deps.invoke,
  );

  if (result.status === 'failed') {
    if (result.error.code === 'NOT_FOUND' && result.error.message.startsWith('No tool named')) {
      if (!syncUnavailableLogged) {
        syncUnavailableLogged = true;
        console.warn(
          `[warn] outcome-observer: ${tool} is not registered — no metrics vendor is configured, so the ` +
            'learning loop has nothing to learn from. Set AYRSHARE_API_KEY to close it.',
        );
      }
      return 'unavailable';
    }

    console.warn('[warn] outcome-observer: tool call failed', {
      tool,
      contentItemId: item.id,
      code: result.error.code,
      message: result.error.message,
    });
    return 'failed';
  }

  return 'ok';
}

/**
 * Hour-bucketed, so two ticks inside the same hour are recognised as the same
 * call rather than each writing a `tool_calls` row that looks like new work — and
 * each one paying the vendor again. Safe against skipping a genuinely due sync
 * because the tightest cadence in `findMetricsSyncDue` is three hours.
 */
function syncKey(item: OutcomeCandidateRow, now: Date): string {
  return `analytics-sync:${item.id}:${now.toISOString().slice(0, 13)}`;
}

/** Reset between tests, which each need the once-per-process warning to fire. */
export function resetOutcomeObserverWarnings(): void {
  syncUnavailableLogged = false;
}
