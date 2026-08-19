import { describe, expect, it } from 'vitest';
import { evaluate } from '@sparksocial/tools';
import type { ScopedDb } from '@sparksocial/tools';
import { makeBrandGovernance } from '../src/dev-auth.js';
import { createDevBrandStore } from '../src/dev-brands.js';

/**
 * The seam between the brand store and the policy engine.
 *
 * This is where the kill switch was broken, and it is the one place the
 * tool-level tests cannot reach: they read `agentPaused` from the store and
 * hand it to `evaluate()` themselves, so a loader that silently drops the field
 * still passes every one of them. That was the original bug — `policy.ts` read
 * `brand.agentPaused`, nothing carried it, and the field was permanently
 * undefined however many times somebody clicked Pause.
 */

const publishAsAgent = (brand: Awaited<ReturnType<ReturnType<typeof makeBrandGovernance>>>, subject?: { platform?: string }) => ({
  tool: { name: 'publish.now', effect: 'publish' as const, autonomy: 'auto' as const, scopes: ['owner' as const] },
  caller: 'agent' as const,
  role: 'owner' as const,
  now: new Date(),
  brand,
  ...(subject ? { subject } : {}),
  budget: { remainingCents: 10_000, estimatedCents: 0 },
});

function harness() {
  const brands = createDevBrandStore();
  const db = { brands } as unknown as ScopedDb;
  return { brands, load: makeBrandGovernance(db) };
}

describe('makeBrandGovernance', () => {
  it('carries agentPaused through to the policy engine', async () => {
    const { brands, load } = harness();
    await brands.setAgentPaused({ brandId: 'brand_1', orgId: 'org_1', paused: true, by: 'user_1' });

    const governance = await load('org_1', 'brand_1');
    expect(governance.agentPaused).toBe(true);

    // The assertion that matters: the *loaded* governance denies the call.
    const decision = evaluate(publishAsAgent(governance));
    expect(decision.kind).toBe('deny');
    expect(decision.kind === 'deny' && decision.ruleId).toBe('agent.paused');
  });

  it('carries a resumed brand through as running', async () => {
    const { brands, load } = harness();
    await brands.setAgentPaused({ brandId: 'brand_1', orgId: 'org_1', paused: true, by: 'u' });
    await brands.setAgentPaused({ brandId: 'brand_1', orgId: 'org_1', paused: false, by: 'u' });

    const governance = await load('org_1', 'brand_1');
    expect(governance.agentPaused).toBe(false);
    expect(evaluate(publishAsAgent(governance))).toEqual({ kind: 'allow' });
  });

  it('defaults a brand nobody has touched to running', async () => {
    // A brand appearing for the first time must not be born paused — the
    // product would look broken on day one.
    const { load } = harness();
    const governance = await load('org_1', 'brand_new');
    expect(governance.agentPaused).toBe(false);
  });

  it('treats a session with no brand as not-paused but review-everything', async () => {
    // Nothing publish-effect can run without a brand anyway. The conservative
    // approval mode is the guard there; inventing a pause would be misleading.
    const { load } = harness();
    const governance = await load('org_1', undefined);
    expect(governance.agentPaused).toBe(false);
    expect(governance.approvalMode).toBe('review_everything');
  });

  it('does not leak one brand’s pause onto another', async () => {
    // Per brand, not per org: an agency freezing all forty clients because one
    // misbehaved is an outage, not a kill switch.
    const { brands, load } = harness();
    await brands.setAgentPaused({ brandId: 'brand_1', orgId: 'org_1', paused: true, by: 'u' });

    expect((await load('org_1', 'brand_1')).agentPaused).toBe(true);
    expect((await load('org_1', 'brand_2')).agentPaused).toBe(false);
  });
});

/**
 * `approval.policy.set`'s five fields — same class of bug as `agentPaused`
 * above, and caught the same way: `policy.ts` has read `restrictedPlatforms`
 * / `familyOverrides` / etc. since P1, but until `setPolicy` and this loader
 * update existed, nothing ever wrote or forwarded them, so every branch that
 * reads them was live in the unit tests and dead in production.
 */
describe('makeBrandGovernance — approval.policy.set fields', () => {
  it('carries restrictedPlatforms through to a real approval-required decision', async () => {
    const { brands, load } = harness();
    await brands.setPolicy({ brandId: 'brand_1', orgId: 'org_1', patch: { restrictedPlatforms: ['tiktok'] } });

    const governance = await load('org_1', 'brand_1');
    expect(governance.restrictedPlatforms).toEqual(['tiktok']);

    const decision = evaluate(publishAsAgent(governance, { platform: 'tiktok' }));
    expect(decision.kind).toBe('approval');
    expect(decision.kind === 'approval' && decision.ruleId).toBe('brand.restricted_platform');

    // An unrestricted platform on the same brand is unaffected.
    expect(evaluate(publishAsAgent(governance, { platform: 'instagram' })).kind).toBe('allow');
  });

  it('a brand nobody has configured carries every policy field as undefined, not a stale default', async () => {
    const { load } = harness();
    const governance = await load('org_1', 'brand_new');
    expect(governance.restrictedPlatforms).toBeUndefined();
    expect(governance.familyOverrides).toBeUndefined();
    expect(governance.quietWindows).toBeUndefined();
    expect(governance.permissions).toBeUndefined();
  });

  it('does not leak one brand’s restricted platforms onto another', async () => {
    const { brands, load } = harness();
    await brands.setPolicy({ brandId: 'brand_1', orgId: 'org_1', patch: { restrictedPlatforms: ['tiktok'] } });

    expect((await load('org_1', 'brand_1')).restrictedPlatforms).toEqual(['tiktok']);
    expect((await load('org_1', 'brand_2')).restrictedPlatforms).toBeUndefined();
  });
});
