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
export function createDevBrandStore(): BrandGovernanceStore & { size(): number } {
  const rows = new Map<string, BrandGovernance & { orgId: string }>();

  const upsert = (brandId: string, orgId: string, name?: string) => {
    const existing = rows.get(brandId);
    if (existing && existing.orgId === orgId) return existing;
    const created = {
      brandId,
      orgId,
      name: name ?? '',
      approvalMode: 'review_first_week' as ApprovalMode,
      // Backdated eight days so local development lands on the *graduated*
      // side of the first week by default. A dev environment permanently stuck
      // on day one would make every publish look gated for the wrong reason.
      createdAt: new Date(Date.now() - 8 * 86_400_000),
    };
    rows.set(brandId, created);
    return created;
  };

  return {
    size: () => rows.size,
    async get(brandId, orgId, name) {
      return upsert(brandId, orgId, name);
    },
    async setApprovalMode(brandId, orgId, mode) {
      const row = upsert(brandId, orgId);
      row.approvalMode = mode;
      return row;
    },
  };
}
