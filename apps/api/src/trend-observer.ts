import { invokeTool, type InvokeDeps, type ScopedDb } from '@sparksocial/tools';

/**
 * THE TREND OBSERVER — the clock behind PRD §8.9's *"metrics + time series"*.
 *
 * `trend.rank` and `trend.detail` already record what they read, which gives
 * good resolution whenever somebody is using the discovery feed and none at all
 * overnight. A gap in the middle of a series is worse than a coarse series,
 * because a chart cannot show that a flat stretch is missing data rather than a
 * flat trend — so the sampling interval has to be a decision, not a by-product
 * of traffic.
 *
 * Goes through `invokeTool('trend.observe', ...)` rather than calling the source
 * directly, for the same reason the publish and recipe schedulers go through the
 * registry: a scheduled sample and a manually triggered one must leave identical
 * `tool_calls` rows behind (P1's exit criterion).
 *
 * **This is the one scheduler with no tenant to run as.** The rows it writes are
 * measurements of the outside world, shared by every brand (see
 * `trend_observations` in `schema.ts`), so there is no genome to scope to and no
 * brand governance to load. It runs under a fixed system identity, and
 * `trend.observe` takes no `genomeId` precisely so that identity cannot be
 * mistaken for a tenant's. Note it does *not* go through `makeDevResolveCtx`
 * like `recipe-scheduler.ts` does: that path forges request headers to
 * impersonate a real org, which is the right shape when the work belongs to one,
 * and the wrong shape here — there is no org whose headers would be truthful.
 */

export interface TrendObserverDeps {
  db: ScopedDb;
  invoke: InvokeDeps;
  /**
   * The org the sampler books its `tool_calls` rows against. Deliberately not a
   * customer: attributing shared measurements to whichever tenant happened to be
   * first would put one brand's audit log in charge of everyone's chart.
   */
  systemOrgId?: string;
  limit?: number;
  now?: () => Date;
}

const SYSTEM_ORG_ID = 'system';
const DEFAULT_LIMIT = 100;

export function startTrendObserver(deps: TrendObserverDeps, intervalMs: number): { stop: () => void } {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[error] trend-observer: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runOnce(deps: TrendObserverDeps): Promise<void> {
  const orgId = deps.systemOrgId ?? SYSTEM_ORG_ID;
  const now = (deps.now ?? (() => new Date()))();

  const result = await invokeTool(
    {
      tool: 'trend.observe',
      input: { limit: deps.limit ?? DEFAULT_LIMIT },
      caller: 'agent',
      ctx: {
        orgId,
        role: 'admin',
        approvalMode: 'autopublish',
        /**
         * Not a real ledger read, because there is no org with a ledger here.
         * Safe only because `trend.observe` records no `cost_cents` — it calls
         * whatever the configured trend source is and writes rows. If a paid
         * source ever lands behind it, this becomes a budget the sampler can
         * exceed silently, and it has to be given a real cap at that point.
         */
        budget: { remainingCents: Number.MAX_SAFE_INTEGER, monthlyCapCents: Number.MAX_SAFE_INTEGER },
        db: deps.db,
        logger: {
          info: (m, meta) => console.log(`[info] ${m}`, meta ?? ''),
          warn: (m, meta) => console.warn(`[warn] ${m}`, meta ?? ''),
          error: (m, meta) => console.error(`[error] ${m}`, meta ?? ''),
        },
        trace: { span: async (_name, fn) => fn(), event: () => {} },
      },
      // Autopublish with no permissions: there is nothing here for a human to
      // approve, and no brand whose ladder would apply.
      brand: { createdAt: new Date(0), approvalMode: 'autopublish', agentPaused: false },
      // Hour-stamped, because the store buckets to the hour: two ticks inside
      // one hour are genuinely the same call, and should be recognised as such
      // rather than each writing a `tool_calls` row that looks like new work.
      idempotencyKey: `trend-observe:${now.toISOString().slice(0, 13)}`,
    },
    deps.invoke,
  );

  if (result.status === 'failed') {
    console.error('[error] trend-observer: trend.observe failed', { code: result.error.code, message: result.error.message });
  }
}
