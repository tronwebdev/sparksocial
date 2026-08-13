import type { ApprovalMode, BrandGovernance, BrandGovernanceStore } from '@sparksocial/tools/defineTool';

/**
 * In-memory brand governance — the dev counterpart to
 * `packages/db/src/brandRepository.ts`.
 *
 * Seeds nothing. A brand appears the first time it is read, on the same
 * conservative default as the schema: `review_first_week`. Defaulting dev to
 * `autopublish` would make the approval ladder invisible locally and then
 * surprising in production, which is exactly the failure the hardcoded
 * governance had.
 */
/**
 * Matches the schema default. Three a week is the cadence the calendar's mix
 * engine was tuned against, so a dev brand nobody has configured produces the
 * same shape of plan as a real one.
 */
const DEFAULT_POSTS_PER_WEEK = 3;

export function createDevBrandStore(): BrandGovernanceStore & { size(): number } {
  const rows = new Map<string, BrandGovernance & { orgId: string }>();

  const upsert = (brandId: string, orgId: string, name?: string) => {
    const existing = rows.get(brandId);
    if (existing && existing.orgId === orgId) return existing;
    const created: BrandGovernance & { orgId: string } = {
      brandId,
      orgId,
      name: name ?? '',
      approvalMode: 'review_first_week' as ApprovalMode,
      // Backdated eight days so local development lands on the *graduated*
      // side of the first week by default. A dev environment permanently stuck
      // on day one would make every publish look gated for the wrong reason.
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      agentPaused: false,
      postsPerWeek: DEFAULT_POSTS_PER_WEEK,
    };
    rows.set(brandId, created);
    return created;
  };

  /**
   * Every method returns a COPY, never the stored row.
   *
   * Handing back the live object makes this store behave unlike Postgres in a
   * way that is invisible until it produces a wrong answer. `agent.frequency.set`
   * reads the brand, writes it, and reports the change:
   *
   *   const before = await db.brands.get(...);      // same object
   *   const after  = await db.brands.setFrequency(...);  // mutated in place
   *
   * With a shared reference `before.postsPerWeek` has already changed by the
   * time it is read, and the tool reports "6 → 6" for a change from 3. Caught
   * live, not by the unit tests — their fake store spreads into a new object on
   * every write, so it never had the aliasing to reproduce.
   *
   * Same class of bug as the missing `lookupIdempotent` in `memoryInvokeDeps`:
   * correct under Postgres, wrong in development, and therefore unfindable
   * until someone runs it.
   */
  const copy = (row: BrandGovernance & { orgId: string }): BrandGovernance => ({ ...row });

  return {
    size: () => rows.size,
    async get(brandId, orgId, name) {
      return copy(upsert(brandId, orgId, name));
    },
    async setApprovalMode(brandId, orgId, mode) {
      const row = upsert(brandId, orgId);
      row.approvalMode = mode;
      return copy({ ...row });
    },
    async setAgentPaused({ brandId, orgId, paused, by, reason }) {
      const row = upsert(brandId, orgId);
      row.agentPaused = paused;
      if (paused) {
        row.pausedAt = new Date();
        row.pausedBy = by;
        if (reason) row.pauseReason = reason;
      } else {
        // Cleared on resume, so a stale "paused by X" never sits next to a
        // running agent.
        delete row.pausedAt;
        delete row.pausedBy;
        delete row.pauseReason;
      }
      return copy({ ...row });
    },
    async setFrequency({ brandId, orgId, postsPerWeek }) {
      const row = upsert(brandId, orgId);
      row.postsPerWeek = postsPerWeek;
      return copy({ ...row });
    },
  };
}
