import type { Database } from './client.js';
import { findGenomesByAccount } from './scoped.js';

/**
 * Platform account id → tenant, for inbound webhooks.
 *
 * Deliberately **not** part of `ScopedDb`, for the reason
 * `schedulerRepository.ts` and `outcomeRepository.ts` give: every `ScopedDb`
 * accessor is genome-scoped because a tool handler acts for exactly one tenant,
 * and this read is cross-tenant by necessity. Putting it on `ScopedDb` would
 * hand every handler in the registry a way to ask "which other genomes exist",
 * which is the question the scoped layer exists to refuse.
 *
 * It is the one read in the system that runs *before* a tenant is known. Every
 * other route learns its genome from a Clerk session or a forged system header;
 * an inbound platform webhook has neither and knows only which account the event
 * happened on. Its answer is therefore the trust boundary for everything the
 * webhook does next — see `apps/api/src/engage-webhook.ts`.
 */
export interface AccountLookup {
  /**
   * Every tenant that has this account connected under this provider.
   *
   * Returns a list rather than one row on purpose. More than one match is a real
   * possibility (an agency connecting the same client twice) and there is no
   * defensible way to choose between them — see {@link findGenomesByAccount}.
   */
  byAccount(args: { provider: string; accountId: string }): Promise<Array<{ orgId: string; genomeId: string }>>;
}

export function createAccountLookup(db: Database): AccountLookup {
  return {
    byAccount: (args) => findGenomesByAccount(db, args),
  };
}
