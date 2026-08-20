import { invokeTool, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import { EXPIRY_WARNING_MS } from '@sparksocial/publish';
import { makeDevResolveCtx } from './dev-auth.js';

/**
 * THE CONNECTION WATCHER — the "alerts" half of PRD §10.
 *
 *   *"Risk: integration failures cause silent misses.
 *   Mitigation: connection health indicators + alerts + retry flows."*
 *
 * `integration.health` was the indicator, and it only ever spoke when somebody
 * opened the Connections panel and looked. Nothing told anyone. That is the
 * silent miss the risk names, arriving by its most likely route: a token expires
 * quietly, the calendar still shows a week of posts going out, and they stop.
 *
 * Goes through `invokeTool('human.notify', ...)` rather than writing to
 * `humanLoop` directly, for the same reason every other scheduler in this
 * directory goes through the registry: the alert has to appear in the Command
 * Center next to everything else SPARK said, carry a `tool_calls` row, and be
 * subject to the same governance. An out-of-band notification path would be a
 * second inbox nobody knows to check.
 *
 * ── Why it warns once, not every tick ─────────────────────────────────────
 * `oauth_connections.expiry_notified_at` latches the warning; `save()` clears
 * it, so reconnecting re-arms the alert for the *new* token's expiry. Without
 * the latch this would post the same message every five minutes for a week, and
 * an alert channel that cries wolf is worse than no alert channel — the owner
 * learns to skip the one message that mattered.
 */

export interface ConnectionWatcherDeps {
  db: ScopedDb;
  invoke: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<InvokeRequest['brand']>;
  now?: () => Date;
}

const BATCH_SIZE = 25;

export function startConnectionWatcher(deps: ConnectionWatcherDeps, intervalMs: number): { stop: () => void } {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[error] connection-watcher: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runOnce(deps: ConnectionWatcherDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  // The same seven-day window `integration.health` calls `expiring`, so the
  // badge on the screen and the message in the inbox never disagree about
  // whether a connection is in trouble.
  const before = new Date(now.getTime() + EXPIRY_WARNING_MS);

  const expiring = await deps.db.oauthConnections.findExpiring({ before, limit: BATCH_SIZE });

  for (const conn of expiring) {
    try {
      await notifyOne(conn, deps, now);
    } catch (e) {
      // One tenant's broken genome must not stop the other twenty-four alerts
      // in this batch. Not latched, so it is retried on the next tick.
      console.error('[error] connection-watcher: could not warn about a connection', {
        connectionId: conn.id,
        provider: conn.provider,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function notifyOne(
  conn: Awaited<ReturnType<ScopedDb['oauthConnections']['findExpiring']>>[number],
  deps: ConnectionWatcherDeps,
  now: Date,
): Promise<void> {
  const genome = await deps.db.genomes.get(conn.genomeId, conn.orgId);
  if (!genome) {
    // A connection whose brand is gone has nobody to warn. Latched anyway,
    // because it will be just as unwarnable on every future tick and leaving it
    // unlatched means re-reading it forever.
    await deps.db.oauthConnections.markExpiryNotified({ id: conn.id, orgId: conn.orgId, at: now });
    return;
  }

  const base = await makeDevResolveCtx(deps.db)(
    new Request('http://localhost/', {
      headers: {
        'x-org-id': conn.orgId,
        'x-brand-id': genome.workspace_id,
        'x-genome-id': conn.genomeId,
        'x-role': 'admin',
      },
    }),
  );
  const { userId: _drop, caller: _caller, ...ctx } = base;
  const brand = await deps.loadBrandGovernance(conn.orgId, genome.workspace_id);

  const result = await invokeTool(
    {
      tool: 'human.notify',
      input: { message: expiryMessage(conn, now), urgency: 'high' },
      caller: 'agent',
      ctx,
      brand,
      // Keyed on the connection and its expiry, not on the clock: a token whose
      // expiry has not moved is the same warning however many ticks pass, and
      // this is the backstop for the case where the latch write fails after the
      // notification has already gone out.
      idempotencyKey: `connection-expiry:${conn.id}:${conn.expiresAt?.toISOString() ?? 'none'}`,
    },
    deps.invoke,
  );

  if (result.status === 'failed') {
    // Deliberately not latched: the warning did not reach anybody, so it is not
    // "already sent". Next tick tries again.
    console.error('[error] connection-watcher: human.notify failed', {
      connectionId: conn.id,
      code: result.error.code,
      message: result.error.message,
    });
    return;
  }

  await deps.db.oauthConnections.markExpiryNotified({ id: conn.id, orgId: conn.orgId, at: now });
  console.log('[info] connection-watcher: warned about an expiring connection', {
    orgId: conn.orgId,
    provider: conn.provider,
    expiresAt: conn.expiresAt?.toISOString(),
  });
}

/**
 * Written as the thing the owner has to do, not as the state of a database row.
 * "Instagram token expiring" is a status; "reconnect Instagram or Tuesday's
 * posts will not go out" is a reason to open the app.
 */
function expiryMessage(
  conn: Awaited<ReturnType<ScopedDb['oauthConnections']['findExpiring']>>[number],
  now: Date,
): string {
  const label = conn.accountLabel ?? conn.provider;
  if (!conn.expiresAt || conn.expiresAt.getTime() <= now.getTime()) {
    return `Your ${label} connection has expired — anything scheduled for it will fail until you reconnect it in Settings → Connections.`;
  }
  const days = Math.max(1, Math.round((conn.expiresAt.getTime() - now.getTime()) / 86_400_000));
  return `Your ${label} connection expires in ${days} day${days === 1 ? '' : 's'}. Reconnect it in Settings → Connections so scheduled posts keep going out.`;
}
