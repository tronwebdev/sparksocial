import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { ToolError, Role } from '@sparksocial/shared/types';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';

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

  const clerk = deps.clerk ?? createClerkClient({ secretKey: requireEnv('CLERK_SECRET_KEY') });

  return async function clerkResolveCtx(req: Request): Promise<ToolCtx & { caller: 'user' | 'agent' }> {
    // 1. Verify the session. `authenticateRequest` handles both the Bearer token
    //    and the Clerk session cookie, and applies the audience check.
    const state = await clerk.authenticateRequest(req, { authorizedParties: deps.authorizedParties });
    if (!state.isSignedIn) {
      throw new ToolError('FORBIDDEN', 'Not signed in.', { reason: state.reason });
    }

    const claims = state.toAuth().sessionClaims as {
      sub?: string;
      org_id?: string;
      org_role?: string;
    };

    const userId = claims.sub;
    if (!userId) throw new ToolError('FORBIDDEN', 'Session has no subject.');

    // 2. Organisation. SparkSocial has no personal-account mode — every genome,
    //    asset and tool_call row is keyed by org — so a session without one is
    //    not a valid caller.
    //
    //    This `org_...` id is written into `genomes.org_id`, `assets.org_id` and
    //    `tool_calls.org_id`. It is a permanent external identifier from here on;
    //    changing identity providers later means migrating those columns.
    const orgId = claims.org_id;
    if (!orgId) {
      throw new ToolError('FORBIDDEN', 'No active organization on this session. Select one and retry.');
    }

    // 3. Role. Clerk custom organization roles carry an `org:` prefix.
    const role = parseRole(claims.org_role);

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
      budget: { remainingCents: 100_000, monthlyCapCents: 100_000 },
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
    }
    // No header → no genomeId. `genome.list` still works (it is org-scoped);
    // anything genome-scoped fails later in `assertScope`, which is correct.

    return ctx;
  };
}

/**
 * Clerk custom organization roles arrive as `org:<name>`. Anything unrecognised
 * becomes `viewer` — the least-privileged role — rather than throwing, so a role
 * added in the Clerk dashboard but not yet in `Role` degrades to read-only
 * instead of locking the user out entirely.
 *
 * `owner` is only ever granted by an explicit `org:owner`. It is never inferred.
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
