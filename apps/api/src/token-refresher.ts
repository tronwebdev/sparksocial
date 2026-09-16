import {
  REFRESHABLE_PLATFORMS,
  refreshSocialToken,
  splitScopedToken,
  joinScopedToken,
  type Platform,
} from '@sparksocial/publish';
import type { ScopedDb } from '@sparksocial/tools/defineTool';

/**
 * THE TOKEN REFRESHER — the repair the connection watcher could only report.
 *
 * `connection-watcher.ts` answers *"tell someone this is about to break"*. This
 * answers *"stop it breaking"*, and until now nothing did: `exchangeSocialCode`
 * stored a `refresh_token` for every provider that returned one, and no code
 * path anywhere ever spent it.
 *
 * The consequence was not a slow leak. Google issues an access token good for
 * one hour and X for two, so a brand that connected YouTube at nine could not
 * publish at eleven, every native connection sat permanently amber behind a
 * seven-day warning threshold it would never reach, and the only repair the
 * product offered was a human pressing Reconnect — hourly, forever.
 *
 * ── Why a clock and not only a publish-time refresh ────────────────────────
 *
 * `publish.now` refreshes lazily too (see `packages/publish/src/tool.ts`), and
 * that is the one that guarantees a post goes out. This exists for the other
 * three quarters of the day:
 *
 *   - A brand that publishes twice a week would otherwise hold a dead token for
 *     days, and every screen that reads `integration.health` — Settings, the
 *     campaign wizard's account picker, SPARK itself — would call the account
 *     broken because, until something publishes, it is.
 *   - A refresh token is not immortal either. X's rotates on every use and TikTok's
 *     expires; refreshing only at publish time means a quiet fortnight ends with
 *     a connection that cannot be repaired without a human.
 *
 * ── Only the platforms that can actually be refreshed ──────────────────────
 *
 * `REFRESHABLE_PLATFORMS` is TikTok, X and YouTube — the providers implementing
 * the `refresh_token` grant, and exactly the ones with hour-scale tokens.
 * Instagram and LinkedIn are absent by design, not omission: Meta returns no
 * refresh token and LinkedIn gates them behind its partner programme, so both
 * issue ~60-day tokens that a person renews by reconnecting. Selecting them here
 * would retry, every tick, a failure that is never going to change.
 */

export interface TokenRefresherDeps {
  db: ScopedDb;
  /** Per-platform app credentials — the same maps the OAuth callback is built from. */
  clientIds: Partial<Record<Platform, string>>;
  clientSecrets: Partial<Record<Platform, string>>;
  /** Injected so tests reach no vendor. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const BATCH_SIZE = 25;

/**
 * How far ahead of expiry to renew.
 *
 * Deliberately NOT `EXPIRY_WARNING_MS` (seven days), which is the *human*
 * warning window. A one-hour token is inside seven days from the instant it is
 * minted, so sharing that threshold would refresh every connection on every
 * tick and spend a provider's rate limit on work with nothing to do.
 *
 * ── Why this is derived from the interval and not a flat number ───────────
 *
 * It was fifteen minutes, flat, against a fifteen-minute tick — a lead exactly
 * equal to the gap between attempts, which is a margin of zero. A token became
 * eligible on the last tick before it died, so one slow tick, one restart at the
 * wrong moment, or one provider timeout and it expired anyway. That is what
 * "tokens are still expiring" looked like: the refresher was running and doing
 * nothing wrong, with no room to be unlucky in.
 *
 * `leadFor` gives at least three ticks of margin, so two consecutive failures
 * are survivable, with a twenty-minute floor for the case where somebody sets a
 * very short interval. Bounded above by an hour: beyond that a one-hour token
 * would be permanently inside its own refresh window and renewed on every tick.
 */
export const MIN_REFRESH_LEAD_MS = 20 * 60 * 1000;
export const MAX_REFRESH_LEAD_MS = 60 * 60 * 1000;

export function leadFor(intervalMs: number): number {
  return Math.min(MAX_REFRESH_LEAD_MS, Math.max(MIN_REFRESH_LEAD_MS, intervalMs * 3));
}

export function startTokenRefresher(deps: TokenRefresherDeps, intervalMs: number): { stop: () => void } {
  const leadMs = leadFor(intervalMs);
  let running = false;

  const tick = async () => {
    // Same re-entrancy guard as the watcher: a slow provider must not let two
    // ticks refresh the same connection concurrently, which on a provider that
    // rotates refresh tokens would leave one of the two results dead.
    if (running) return;
    running = true;
    try {
      await runOnce(deps, leadMs);
    } catch (e) {
      console.error('[error] token-refresher: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runOnce(
  deps: TokenRefresherDeps,
  leadMs: number = MIN_REFRESH_LEAD_MS,
): Promise<{ refreshed: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const before = new Date(now.getTime() + leadMs);

  // Only platforms this deployment has credentials for. An operator who has not
  // configured X cannot refresh an X token, and asking the database for rows
  // nothing can act on is how a log fills with unfixable errors.
  const providers = REFRESHABLE_PLATFORMS.filter((p) => deps.clientIds[p] && deps.clientSecrets[p]);
  if (providers.length === 0) return { refreshed: 0, failed: 0 };

  const due = await deps.db.oauthConnections.findRefreshable({ before, providers, limit: BATCH_SIZE });

  let refreshed = 0;
  let failed = 0;
  for (const conn of due) {
    try {
      await refreshOne(conn, deps);
      refreshed += 1;
    } catch (e) {
      failed += 1;
      /*
       * Logged, not latched, and never rethrown: one tenant's revoked token must
       * not stop the other twenty-four refreshes in this batch. The connection
       * stays selected, so the next tick tries again — and if it keeps failing,
       * the token expires on schedule and `connection-watcher` tells the brand
       * to reconnect, which is the correct end state for a token the user
       * revoked at the provider.
       */
      console.error('[error] token-refresher: refresh failed', {
        connectionId: conn.id,
        provider: conn.provider,
        genomeId: conn.genomeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (refreshed || failed) {
    console.log(`[info] token-refresher: refreshed ${refreshed}, failed ${failed}`);
  }
  return { refreshed, failed };
}

async function refreshOne(
  conn: Awaited<ReturnType<ScopedDb['oauthConnections']['findRefreshable']>>[number],
  deps: TokenRefresherDeps,
): Promise<void> {
  const provider = conn.provider as Platform;
  const clientId = deps.clientIds[provider];
  const clientSecret = deps.clientSecrets[provider];
  if (!clientId || !clientSecret || !conn.refreshToken) return;

  const fresh = await refreshSocialToken(provider, {
    clientId,
    clientSecret,
    refreshToken: conn.refreshToken,
    fetchImpl: deps.fetchImpl ?? fetch,
  });

  /*
   * Instagram and LinkedIn pack an account id into the stored token as
   * `{id}:{token}` (see `scopedToken.ts`). Neither is refreshable, so this
   * cannot currently fire — but writing a bare token over a scoped one would
   * silently strip the id and break publishing in a way that only shows up at
   * the next post, so the prefix is carried across rather than assumed absent.
   */
  const [scopeId] = splitScopedToken(conn.accessToken);
  const accessToken = scopeId ? joinScopedToken(scopeId, fresh.accessToken) : fresh.accessToken;

  await deps.db.oauthConnections.save({
    genomeId: conn.genomeId,
    orgId: conn.orgId,
    provider: conn.provider,
    accessToken,
    /*
     * Keep the existing refresh token when the provider does not return a new
     * one. Google does exactly that — it reuses the original — and spreading an
     * absent value would blank the column, making the first successful refresh
     * the last one this connection ever gets.
     */
    refreshToken: fresh.refreshToken ?? conn.refreshToken,
    ...(fresh.expiresAt ? { expiresAt: fresh.expiresAt } : {}),
    // Attribution stays with the person who authorised the connection. The
    // refresher is not a connecting user and must not overwrite them.
    connectedBy: conn.connectedBy,
    ...(fresh.scopes?.length ? { scopes: fresh.scopes } : conn.scopes ? { scopes: conn.scopes } : {}),
    ...(conn.accountLabel ? { accountLabel: conn.accountLabel } : {}),
    ...(conn.accountId ? { accountId: conn.accountId } : {}),
  });
  // `save` clears `expiryNotifiedAt`, which re-arms the watcher — correct here:
  // the new expiry is a genuinely new fact, and if it later expires anyway the
  // brand should be told again rather than silenced by an old latch.
}
