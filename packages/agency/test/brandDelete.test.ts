import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import { brandDelete, brandDeletionPreview } from '../src/brand.js';

/**
 * `brand.delete` — the one irreversible button in the product.
 *
 * Three things are worth a test here, and they are not the handler's happy
 * path:
 *
 *   1. the typed name is checked *in the tool*, not only in the dialog;
 *   2. an unknown brand id cannot be confirmed by typing anything, which is a
 *      real hazard because `brands.get` upserts rather than returning
 *      undefined;
 *   3. the registry flags are what route this through an approval — they are
 *      the whole safety story, and a one-word edit to either silently removes
 *      it.
 */

const COUNTS = { assets: 148, contentItems: 32, campaigns: 4, recipes: 2, genomes: 1 };
const ZERO = { assets: 0, contentItems: 0, campaigns: 0, recipes: 0, genomes: 0 };

function db(over: { name?: string; deleteCascade?: () => Promise<typeof COUNTS> } = {}) {
  const deleteCascade = vi.fn(over.deleteCascade ?? (async () => COUNTS));
  return {
    deleteCascade,
    store: {
      brands: {
        get: async (brandId: string) => ({
          brandId,
          name: over.name ?? 'Acme Barbers',
          approvalMode: 'autopublish',
          createdAt: new Date(),
          agentPaused: false,
          postsPerWeek: 3,
        }),
        rename: async () => ({}) as never,
        countContents: async () => COUNTS,
        deleteCascade,
      },
    },
  };
}

function ctx(store: unknown): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: store as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('the registry contract is the safety story', () => {
  it('is destructive, which policy routes to approval even for an owner', () => {
    expect(brandDelete.effect).toBe('destructive');

    /*
     * The tool's own registered flags are fed to the real `evaluate`, rather
     * than a hand-written copy of them. A copy would keep passing after
     * somebody changed `effect` on the tool, which is precisely the edit this
     * test exists to catch.
     */
    const decision = evaluate({
      caller: 'user',
      role: 'owner',
      tool: {
        name: brandDelete.name,
        effect: brandDelete.effect,
        autonomy: brandDelete.autonomy,
        scopes: brandDelete.scopes,
      },
      brand: { approvalMode: 'autopublish', agentPaused: false },
      budget: { estimatedCents: 0, remainingCents: 10_000 },
    } as unknown as Parameters<typeof evaluate>[0]);

    expect(decision.kind).toBe('approval');
    expect(decision.kind === 'approval' && decision.ruleId).toBe('effect.destructive');
  });

  it('is human_only — SPARK does not get to propose erasing a client', () => {
    expect(brandDelete.autonomy).toBe('human_only');
  });

  it('does not let an approver release it, only an owner or admin', () => {
    expect(brandDelete.scopes).toEqual(['owner', 'admin']);
  });
});

describe('the typed name', () => {
  it('deletes when it matches', async () => {
    const { store, deleteCascade } = db();
    const out = await brandDelete.handler(
      { brandId: 'brand_1', confirmName: 'Acme Barbers' },
      ctx(store),
    );

    expect(out.deleted).toBe(true);
    expect(out.counts).toEqual(COUNTS);
    expect(deleteCascade).toHaveBeenCalledWith('brand_1', 'org_1');
  });

  it('ignores case and surrounding space — the point is reading which brand, not typing it perfectly', async () => {
    const { store, deleteCascade } = db();
    await brandDelete.handler({ brandId: 'brand_1', confirmName: '  acme barbers ' }, ctx(store));
    expect(deleteCascade).toHaveBeenCalled();
  });

  it('refuses a near miss, and deletes nothing', async () => {
    const { store, deleteCascade } = db();
    await expect(
      brandDelete.handler({ brandId: 'brand_1', confirmName: 'Acme Barber' }, ctx(store)),
    ).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });

    expect(deleteCascade).not.toHaveBeenCalled();
  });

  it('names the brand in the refusal, so the dialog can say what to type', async () => {
    const { store } = db();
    await expect(
      brandDelete.handler({ brandId: 'brand_1', confirmName: 'wrong' }, ctx(store)),
    ).rejects.toThrow(/Acme Barbers/);
  });

  /*
   * The hazard this guards: `brands.get` upserts on first read, so an id that
   * was never a brand comes back as a real-looking row with a blank name.
   * Without the empty-name check, `confirmName: ' '` would fail `min(1)` but
   * anything else would be compared against `''` — and a blank-vs-blank match
   * is one normalisation bug away from deleting whatever that id touches.
   */
  it('refuses a brand id that does not exist rather than upserting one to delete', async () => {
    const { store, deleteCascade } = db({ name: '' });
    await expect(
      brandDelete.handler({ brandId: 'brand_ghost', confirmName: 'anything' }, ctx(store)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(deleteCascade).not.toHaveBeenCalled();
  });
});

describe('brand.deletion.preview', () => {
  it('reads the counts without deleting', async () => {
    const { store, deleteCascade } = db();
    const out = await brandDeletionPreview.handler({ brandId: 'brand_1' }, ctx(store));

    expect(out.name).toBe('Acme Barbers');
    expect(out.counts).toEqual(COUNTS);
    expect(deleteCascade).not.toHaveBeenCalled();
  });

  it('is a read, so nothing about asking the question needs approval', () => {
    expect(brandDeletionPreview.effect).toBe('read');
  });
});

describe('replay', () => {
  it('declares itself idempotent, and a second delete reports nothing left', async () => {
    expect(brandDelete.idempotent).toBe(true);

    const { store } = db({ deleteCascade: async () => ZERO });
    const out = await brandDelete.handler(
      { brandId: 'brand_1', confirmName: 'Acme Barbers' },
      ctx(store),
    );
    expect(out.counts).toEqual(ZERO);
  });
});

describe('ToolError, not a bare throw', () => {
  it('throws ToolError so the agent can read the code', async () => {
    const { store } = db();
    await expect(
      brandDelete.handler({ brandId: 'brand_1', confirmName: 'no' }, ctx(store)),
    ).rejects.toBeInstanceOf(ToolError);
  });
});
