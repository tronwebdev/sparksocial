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


/** Permissive governance for local work. Real implementation reads `brands`/`autonomy_policies`. */
export async function devBrandGovernance(_orgId: string, _brandId?: string) {
  return {
    createdAt: new Date('2026-01-01T00:00:00Z'),
    approvalMode: 'autopublish' as const,
  };
}
