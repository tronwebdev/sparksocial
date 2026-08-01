import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import type { Role } from '@sparksocial/shared/types';
import { createDevStore } from './dev-store.js';

/**
 * DEVELOPMENT AUTH ONLY.
 *
 * Reads tenancy and role straight off request headers so the tool layer can be
 * exercised end to end before Clerk lands. This is forgeable by definition — any
 * caller can claim any `genomeId`, which is exactly the isolation bypass
 * `scoped.ts` exists to prevent — so `index.ts` refuses to boot with this in
 * production unless explicitly overridden for a throwaway environment.
 *
 * Replace with Clerk: Organizations → org, sub-orgs → brands, and read the role
 * from the membership claim.
 *
 * The header-trust problem is independent of which `ScopedDb` backs `ctx.db` —
 * a throwaway environment can run this resolver against real Postgres (to
 * exercise persistence) just as validly as against the in-memory dev store, so
 * the store is a parameter here rather than hardcoded.
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

/** One in-memory store per process, seeded with the golden set — the default for local dev. */
export const devResolveCtx = makeDevResolveCtx(createDevStore());

/** Permissive governance for local work. Real implementation reads `brands`/`autonomy_policies`. */
export async function devBrandGovernance(_orgId: string, _brandId?: string) {
  return {
    createdAt: new Date('2026-01-01T00:00:00Z'),
    approvalMode: 'autopublish' as const,
  };
}
