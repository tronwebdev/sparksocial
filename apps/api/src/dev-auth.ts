import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import type { Role } from '@sparksocial/shared/types';

/**
 * DEVELOPMENT AUTH ONLY. The real one is `clerk-auth.ts`.
 *
 * Reads tenancy and role straight off request headers, so it is forgeable by
 * definition — any caller can claim any `genomeId`, which is precisely the
 * isolation bypass `scoped.ts` exists to prevent. `index.ts` refuses to boot with
 * this in production unless explicitly overridden for a throwaway environment.
 *
 * It survives Clerk landing because it is what makes local development work with
 * no `CLERK_SECRET_KEY` and no `DATABASE_URL` — a `curl` against the tool surface
 * shouldn't require a browser session. Delete it when the golden-set dev store
 * goes (P3+).
 *
 * The header-trust problem is independent of which `ScopedDb` backs `ctx.db`, so
 * the store is a parameter rather than a module-level singleton — that also keeps
 * a second seeded store from being constructed when the caller already made one.
 */
export function makeDevResolveCtx(db: ScopedDb) {
  return async function devResolveCtx(req: Request): Promise<ToolCtx & { caller: 'user' | 'agent' }> {
    const h = req.headers;
    return {
      orgId: h.get('x-org-id') ?? 'org_dev',
      brandId: h.get('x-brand-id') ?? 'brand_dev',
      genomeId: h.get('x-genome-id') ?? 'gen_dev',
      ...(h.get('x-user-id') ? { userId: h.get('x-user-id')! } : {}),
      ...(h.get('x-run-id') ? { runId: h.get('x-run-id')! } : {}),
      role: (h.get('x-role') ?? 'owner') as Role,
      caller: h.get('x-caller') === 'agent' ? 'agent' : 'user',
      approvalMode: 'autopublish',
      budget: { remainingCents: 100_000, monthlyCapCents: 100_000 },
      db,
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
  };
}


/**
 * Brand governance, read from the store rather than hardcoded.
 *
 * This used to return a constant `autopublish`, which meant the approval ladder
 * in `policy.ts` was fully implemented, fully tested, and completely inert in a
 * running system: no brand could actually *be* on `review_first_week`, so
 * §6.8 Step 5's recommendation had nothing to set.
 *
 * A brand with no row upserts on first read at the schema's conservative
 * default. Defaulting to the permissive rung would mean a misconfiguration
 * silently grants unattended publishing — the wrong direction for the one
 * setting that stands between the agent and someone's public feed.
 */
export function makeBrandGovernance(db: ScopedDb) {
  return async function loadBrandGovernance(orgId: string, brandId?: string) {
    if (!brandId) {
      // No brand selected means nothing publish-effect can run anyway; the
      // conservative answer costs nothing and avoids inventing a row.
      return { createdAt: new Date(), approvalMode: 'review_everything' as const };
    }
    const governance = await db.brands.get(brandId, orgId);
    return { createdAt: governance.createdAt, approvalMode: governance.approvalMode };
  };
}
