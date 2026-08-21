import { describe, expect, it, vi } from 'vitest';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { genomeCreate } from '../src/create.js';

/**
 * `genome.create` declares `idempotent: true`, and the thing worth testing is
 * whether the handler actually is.
 *
 * It wasn't: every call inserted another genome, so re-running onboarding —
 * routine after `genome.bootstrap_from_url` fails upstream — left one brand
 * with two genomes and a workspace switcher listing the same name twice with no
 * indication which was live. The registry flag only stops the invoke middleware
 * demanding an idempotency key; it never made the handler safe to replay. Found
 * against real rows, not in a unit test, which is why these exist.
 */

interface Over {
  listForOrg?: ScopedDb['genomes']['listForOrg'];
  createDraft?: ScopedDb['genomes']['createDraft'];
  patchIdentity?: ScopedDb['genomes']['patchIdentity'];
}

function ctx(over: Over = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: over.createDraft ?? (async () => ({ id: 'gen_new' })),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        patchIdentity: over.patchIdentity ?? (async ({ genomeId }) => ({ id: genomeId, version: 3 })),
        get: async () => undefined,
        listForOrg: over.listForOrg ?? (async () => []),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const input = {
  brandId: 'brand_1',
  businessName: 'Northside Barbers',
  category: 'business' as const,
  locale: 'en-GB',
  maxPages: 1,
};

describe('the registry contract', () => {
  it('is free — a business whose site blocked the crawler should not pay more to start', () => {
    expect(genomeCreate.estimateCents?.({ ...input })).toBe(0);
  });

  it('claims to be idempotent, which the tests below are what makes true', () => {
    expect(genomeCreate.idempotent).toBe(true);
  });
});

describe('genome.create — first time for a brand', () => {
  it('inserts a genome and returns it', async () => {
    const createDraft = vi.fn<ScopedDb['genomes']['createDraft']>(async () => ({ id: 'gen_new' }));

    const out = await genomeCreate.handler(input, ctx({ createDraft }));

    expect(out.draftGenomeId).toBe('gen_new');
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft.mock.calls[0]![0]).toMatchObject({ brandId: 'brand_1', orgId: 'org_1' });
  });

  it('leaves every routing dimension unresolved — nothing was inferred, so everything must be asked', async () => {
    const out = await genomeCreate.handler(input, ctx());
    expect(out.unresolved).toEqual(['proof_asset', 'capture_capability', 'objective', 'talent_availability']);
  });
});

describe('genome.create — replayed for a brand that already has a genome', () => {
  const existing = [
    { id: 'gen_live', brandId: 'brand_1', name: 'Northside Barbers', updatedAt: new Date('2026-08-21') },
  ];

  it('reuses the brand’s genome instead of inserting a second one', async () => {
    const createDraft = vi.fn<ScopedDb['genomes']['createDraft']>(async () => ({ id: 'gen_new' }));

    const out = await genomeCreate.handler(input, ctx({ listForOrg: async () => existing, createDraft }));

    expect(out.draftGenomeId).toBe('gen_live');
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('merges what the owner typed this time, so a retry that corrects the name takes effect', async () => {
    const patchIdentity = vi.fn<ScopedDb['genomes']['patchIdentity']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 3,
    }));

    await genomeCreate.handler(
      { ...input, businessName: 'Northside Barbers Ltd', oneLiner: 'Cuts since 1998' },
      ctx({ listForOrg: async () => existing, patchIdentity }),
    );

    expect(patchIdentity).toHaveBeenCalledWith({
      genomeId: 'gen_live',
      orgId: 'org_1',
      identity: {
        business_name: 'Northside Barbers Ltd',
        category: 'business',
        one_liner: 'Cuts since 1998',
        geography: { scope: 'local', locale: 'en-GB', radius_km: null },
        languages: ['en'],
      },
    });
  });

  it('does not reuse another brand’s genome — a second brand is a second brandId', async () => {
    const createDraft = vi.fn<ScopedDb['genomes']['createDraft']>(async () => ({ id: 'gen_new' }));

    const out = await genomeCreate.handler(
      { ...input, brandId: 'brand_2' },
      ctx({ listForOrg: async () => existing, createDraft }),
    );

    expect(out.draftGenomeId).toBe('gen_new');
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it('reports the same reason either way — a retry is not a different kind of event', async () => {
    const fresh = await genomeCreate.handler(input, ctx());
    const replayed = await genomeCreate.handler(input, ctx({ listForOrg: async () => existing }));

    expect(replayed.why).toEqual(fresh.why);
  });
});
