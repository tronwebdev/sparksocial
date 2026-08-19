import { describe, expect, it } from 'vitest';
import { createDevBrandStore } from '../src/dev-brands.js';

/**
 * The dev brand store must behave like the Postgres one where it matters.
 *
 * These exist because of a bug found by running the product, not by running the
 * suite: the store returned its live row object, so a handler doing
 * read-then-write held one object that changed underneath it.
 * `agent.frequency.set` reported "6 → 6" for a change from 3.
 *
 * Every tool-level fake in the repo spreads into a new object on write, so none
 * of them could reproduce it. That is the whole lesson — a fake that is tidier
 * than the real implementation hides the bugs the real one has.
 */
describe('returns snapshots, not the live row', () => {
  it('a value read before a write does not change after it', async () => {
    const s = createDevBrandStore();
    const before = await s.get('brand_1', 'org_1');
    await s.setFrequency({ brandId: 'brand_1', orgId: 'org_1', postsPerWeek: 9, by: 'u' });

    // The exact assertion the live bug violated.
    expect(before.postsPerWeek).toBe(3);
  });

  it('holds for approval mode and the kill switch too', async () => {
    const s = createDevBrandStore();
    const before = await s.get('brand_1', 'org_1');

    await s.setApprovalMode('brand_1', 'org_1', 'autopublish');
    await s.setAgentPaused({ brandId: 'brand_1', orgId: 'org_1', paused: true, by: 'u' });

    expect(before.approvalMode).toBe('review_first_week');
    expect(before.agentPaused).toBe(false);
  });

  it('mutating a returned object does not corrupt the store', async () => {
    // The other direction. A caller that edits what it was handed must not be
    // silently rewriting governance for every later reader.
    const s = createDevBrandStore();
    const handed = await s.get('brand_1', 'org_1');
    handed.agentPaused = true;
    handed.postsPerWeek = 99;

    const fresh = await s.get('brand_1', 'org_1');
    expect(fresh.agentPaused).toBe(false);
    expect(fresh.postsPerWeek).toBe(3);
  });
});

describe('the defaults a brand is born with', () => {
  it('starts on the conservative rung, running, at three a week', async () => {
    const g = await createDevBrandStore().get('brand_new', 'org_1');
    expect(g.approvalMode).toBe('review_first_week');
    expect(g.agentPaused).toBe(false);
    expect(g.postsPerWeek).toBe(3);
  });

  it('keeps writes separate per brand', async () => {
    const s = createDevBrandStore();
    await s.setFrequency({ brandId: 'brand_1', orgId: 'org_1', postsPerWeek: 7, by: 'u' });

    expect((await s.get('brand_1', 'org_1')).postsPerWeek).toBe(7);
    expect((await s.get('brand_2', 'org_1')).postsPerWeek).toBe(3);
  });
});
