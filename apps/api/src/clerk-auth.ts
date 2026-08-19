import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { ToolError, Role } from '@sparksocial/shared/types';
import type { CreditStore, ScopedDb, ToolCtx } from '@sparksocial/tools';
import { readBudget } from './budget.js';

/**
 * CLERK → `ToolCtx`. This is the tenancy boundary.
 *
 * Everything downstream trusts `ctx.orgId` and `ctx.genomeId` absolutely:
 * `packages/db/src/scoped.ts` turns them straight into the SQL predicate that
 * separates one client's assets from another's. So exactly two things may
 * establish them:
 *
 *   - `userId`, `orgId`, `role` — from a **cryptographically verified session**.
 *   - `genomeId`, `brandId`     — from a **database lookup against that orgId**.
 *
 * A third check gates brandId once it's resolved: for anyone below
 * owner/admin, the `brand_members` row `team.permission.set` writes has to
 * actually exist for this brand, or the request is refused. Org membership
 * alone used to be enough to reach any brand in the org — see the
 * "Brand-level access" block below for why that was a real gap, not a
 * missing nice-to-have.
 *
 * Nothing here reads a value off the request and trusts it. That is the whole
 * difference from `dev-auth.ts`, which takes `x-genome-id` at face value and is
 * therefore forgeable by any caller.
 *
 * Note the inverted failure mode: the dev resolver defaults an unknown role to
 * `owner`; this one defaults to `viewer`. A bug here should cost someone access,
 * never grant it.
 */

export interface ClerkResolveDeps {
  db: ScopedDb;
  /** Spend, per plan §9. Omitted in tests that only exercise identity. */
  credits?: CreditStore;
  /** Injected for testing; defaults to a client built from `CLERK_SECRET_KEY`. */
  clerk?: ClerkClient;
  /**
   * Origins allowed to mint the tokens we accept. Required with no default on
   * purpose: it is the audience check that stops a token issued for a *different*
   * Clerk application being replayed against this API, and a default would let it
   * be forgotten silently.
   */
  authorizedParties: string[];
}

export function makeClerkResolveCtx(deps: ClerkResolveDeps) {
  if (!deps.authorizedParties.length) {
    throw new Error(
      'authorizedParties is empty. Set CLERK_AUTHORIZED_PARTIES to the origins allowed to call this API ' +
        '(e.g. https://app.sparksocial.ai). Without it, a token minted for any other Clerk app is accepted.',
    );
  }

  // Both keys. `authenticateRequest` needs the publishable key to resolve the
  // instance's frontend API for the handshake — without it, every request fails
  // with "Publishable key is missing" no matter how valid the token is.
  const clerk =
    deps.clerk ??
    createClerkClient({
      secretKey: requireEnv('CLERK_SECRET_KEY'),
      publishableKey: requireEnv('CLERK_PUBLISHABLE_KEY'),
    });

  return async function clerkResolveCtx(req: Request): Promise<ToolCtx & { caller: 'user' | 'agent' }> {
    // 1. Verify the session. `authenticateRequest` handles both the Bearer token
    //    and the Clerk session cookie, and applies the audience check.
    const state = await clerk.authenticateRequest(req, { authorizedParties: deps.authorizedParties });
    if (!state.isSignedIn) {
      throw new ToolError('FORBIDDEN', 'Not signed in.', { reason: state.reason });
    }

    const claims = state.toAuth().sessionClaims as SessionClaims;

    const userId = claims.sub;
    if (!userId) throw new ToolError('FORBIDDEN', 'Session has no subject.');

    // 2. Organisation. SparkSocial has no personal-account mode — every genome,
    //    asset and tool_call row is keyed by org — so a session without one is
    //    not a valid caller.
    //
    //    This `org_...` id is written into `genomes.org_id`, `assets.org_id` and
    //    `tool_calls.org_id`. It is a permanent external identifier from here on;
    //    changing identity providers later means migrating those columns.
    const { orgId, orgRole } = activeOrganization(claims);
    if (!orgId) {
      throw new ToolError(
        'NO_ORGANIZATION',
        'No active organization on this session. Select one and retry.',
      );
    }

    // 3. Role. Clerk custom organization roles carry an `org:` prefix.
    const role = parseRole(orgRole);

    const ctx: ToolCtx & { caller: 'user' | 'agent' } = {
      orgId,
      userId,
      role,
      // 5. Always 'user'. An `x-caller: agent` header is deliberately NOT
      //    honoured: SPARK's calls originate in `packages/spark` with a ctx built
      //    server-side, never over this HTTP surface. Trusting the header would
      //    let a browser forge the single field the P1 exit criterion says is the
      //    only difference between a UI action and an agent action.
      caller: 'user',
      approvalMode: 'autopublish',
      /**
       * Real spend, read per request from the ledger (plan §9).
       *
       * This was `{ remainingCents: 100_000 }` hardcoded, which made
       * `policy.ts` rule 4 — fully implemented and tested since P1 — impossible
       * to trigger. Every `estimateCents` in the codebase was computed,
       * recorded on the audit row, and compared against a constant.
       *
       * One extra query per request, deliberately not cached: a stale balance
       * is a balance that permits a call the org cannot afford, and the cache
       * invalidation story for "how much money is left" is the one nobody wins.
       */
      budget: await readBudget(deps.credits, orgId),
      db: deps.db,
      logger: {
        info: (m, meta) => console.log(`[info] ${m}`, meta ?? ''),
        warn: (m, meta) => console.warn(`[warn] ${m}`, meta ?? ''),
        error: (m, meta) => console.error(`[error] ${m}`, meta ?? ''),
      },
      trace: {
        span: async (_name, fn) => fn(),
        event: () => {},
      },
    };

    // 4. Genome. The load-bearing step.
    //
    //    The header is a *claim*, not a fact. `db.genomes.get` already filters on
    //    orgId and returns undefined on mismatch, so a genome belonging to another
    //    org is indistinguishable from one that doesn't exist — and either way the
    //    caller is refused rather than served someone else's data.
    //
    //    `brandId` is read off the verified row. It is never taken from the
    //    request: an `x-brand-id` header is ignored entirely.
    const claimedGenomeId = req.headers.get('x-genome-id');
    if (claimedGenomeId) {
      const genome = await deps.db.genomes.get(claimedGenomeId, orgId);
      if (!genome) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not in your organization.', {
          genomeId: claimedGenomeId,
          orgId,
        });
      }
      ctx.genomeId = claimedGenomeId;
      ctx.brandId = genome.workspace_id;

      // Brand-level access — agency isolation (plan §6.9). Being in the org
      //    is not being scoped to every brand in it: `team.permission.set`
      //    writes a `brand_members` row per (user, brand), and until this
      //    check existed nothing ever read it back, so any org member could
      //    reach any brand in the org regardless of their assignment — a real
      //    gap `docs/GAPS.md` tracked under "Agency / team isolation".
      //
      //    `owner`/`admin` are the org's administrators everywhere else this
      //    codebase draws that line (they are the only roles that can call
      //    `team.permission.set` itself) — they administer every brand in
      //    their org by construction, the same reasoning `brand.oauth.*` and
      //    `org.*` already scope to `['owner', 'admin']`. Every other role
      //    needs an explicit row for *this* brand, or is refused exactly like
      //    a genome from another org: absent rather than forbidden, so
      //    probing a genome id cannot confirm a brand exists that the caller
      //    just isn't assigned to.
      if (role !== 'owner' && role !== 'admin') {
        const memberships = await deps.db.brandMembers.listForUser(orgId, userId);
        const assigned = memberships.some((m) => m.brandId === ctx.brandId);
        if (!assigned) {
          throw new ToolError('ISOLATION_VIOLATION', 'You are not assigned to this brand.', {
            genomeId: claimedGenomeId,
            brandId: ctx.brandId,
          });
        }
      }
    }
    // No header → no genomeId. `genome.list` still works (it is org-scoped);
    // anything genome-scoped fails later in `assertScope`, which is correct.

    return ctx;
  };
}

/**
 * Both shapes Clerk uses for the active organization.
 *
 * `v1` (no `v` claim) puts it flat: `org_id`, `org_role`. **`v2` (`v: 2`) nests
 * it** under `o: { id, rol }` and types `org_id` as `never`. Which one an
 * instance issues is a Clerk-side setting, not something the app controls.
 *
 * Reading only `org_id` meant a v2 instance looked exactly like a session with
 * no organization: the user creates one, Clerk activates it, `useAuth()`
 * reports it client-side, and every tool call still comes back
 * `NO_ORGANIZATION`. Nothing in the app is wrong and nothing in Clerk is wrong
 * — the two are simply describing the same fact in different words.
 *
 * Both are read rather than picking one, because the version can change under
 * us and this is not a difference worth a redeploy.
 */
interface SessionClaims {
  sub?: string;
  /** v1 */
  org_id?: string;
  org_role?: string;
  /** v2 */
  v?: number;
  o?: { id?: string; rol?: string; slg?: string };
}

export function activeOrganization(claims: SessionClaims): { orgId?: string; orgRole?: string } {
  const orgId = claims.o?.id ?? claims.org_id;
  const orgRole = claims.o?.rol ?? claims.org_role;

  return {
    ...(orgId ? { orgId } : {}),
    ...(orgRole ? { orgRole } : {}),
  };
}

/**
 * Clerk custom organization roles arrive as `org:<name>` in v1 and bare in v2
 * (`admin`, not `org:admin`). Stripping an optional prefix handles both.
 *
 * Anything unrecognised becomes `viewer` — the least-privileged role — rather
 * than throwing, so a role added in the Clerk dashboard but not yet in `Role`
 * degrades to read-only instead of locking the user out entirely.
 *
 * `owner` is only ever granted by an explicit `owner` role. It is never inferred.
 */
function parseRole(orgRole: string | undefined): Role {
  if (!orgRole) return 'viewer';
  const parsed = Role.safeParse(orgRole.replace(/^org:/, ''));
  return parsed.success ? parsed.data : 'viewer';
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Clerk auth cannot start without it.`);
  return v;
}
