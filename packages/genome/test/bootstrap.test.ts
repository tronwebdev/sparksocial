import { describe, expect, it, vi } from 'vitest';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeGenomeBootstrap } from '../src/bootstrap.js';

/**
 * One genome per brand — the rule `genome.create` states, and the one this tool
 * did not follow.
 *
 * It always called `createDraft`, so a brand that already had a genome ended up
 * with two and every later `listForOrg` lookup picked whichever sorted first.
 * That became reachable on the first run the moment onboarding started minting a
 * brand for each new business: `brand.create` pairs an empty genome with the
 * brand, and the crawl then wrote a second one holding everything it had learned.
 *
 * Found in a live database, not here — a bakery's genome had been replaced by a
 * bicycle workshop's because both were keyed to the same brand id.
 */

const PAGES = [{ url: 'https://rowanvale.test/', title: 'Home', text: 'We build wheels by hand.' }];

const INFERRED = {
  identity: {
    businessName: 'Rowan & Vale Cyclery',
    category: 'trades',
    oneLiner: 'An independent bicycle workshop.',
    geography: { scope: 'local' as const, locale: 'en-GB', radiusKm: 10 },
    languages: ['en'],
    priceTier: 'mid' as const,
  },
  dimensions: { objective: 'bookings' as const },
  voice: { tone: 'plain' },
  chips: [{ field: 'category', value: 'trades', confidence: 0.8, editable: true }],
  unresolved: ['talent_availability'],
  factors: [],
  alternatives: [],
};

interface Over {
  listForOrg?: ScopedDb['genomes']['listForOrg'];
  createDraft?: ScopedDb['genomes']['createDraft'];
  patchIdentity?: ScopedDb['genomes']['patchIdentity'];
  patchDimensions?: ScopedDb['genomes']['patchDimensions'];
  patchVoice?: ScopedDb['genomes']['patchVoice'];
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
        patchIdentity: over.patchIdentity ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
        patchDimensions: over.patchDimensions ?? (async ({ genomeId }) => ({ id: genomeId, version: 3 })),
        patchVoice: over.patchVoice ?? (async ({ genomeId }) => ({ id: genomeId, version: 4 })),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        get: async () => undefined,
        listForOrg: over.listForOrg ?? (async () => []),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const tool = () =>
  makeGenomeBootstrap({
    crawl: async () => ({ pages: PAGES, failure: undefined, reason: undefined }),
    infer: { async infer() { return INFERRED; } },
  } as never);

const input = { url: 'https://rowanvale.test/', brandId: 'brand_1', maxPages: 5 };

describe('genome.bootstrap_from_url — one genome per brand', () => {
  it('creates a genome for a brand that has none', async () => {
    const createDraft = vi.fn(async () => ({ id: 'gen_new' }));
    const res = await tool().handler(input, ctx({ createDraft } as Over));

    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(res.draftGenomeId).toBe('gen_new');
  });

  it('patches the brand’s existing genome instead of adding a second', async () => {
    const createDraft = vi.fn(async () => ({ id: 'gen_new' }));
    const patchIdentity = vi.fn(async ({ genomeId }: { genomeId: string }) => ({ id: genomeId, version: 2 }));
    const patchDimensions = vi.fn(async ({ genomeId }: { genomeId: string }) => ({ id: genomeId, version: 3 }));
    const patchVoice = vi.fn(async ({ genomeId }: { genomeId: string }) => ({ id: genomeId, version: 4 }));

    const res = await tool().handler(
      input,
      ctx({
        listForOrg: (async () => [{ id: 'gen_existing', brandId: 'brand_1' }]) as never,
        createDraft,
        patchIdentity,
        patchDimensions,
        patchVoice,
      } as Over),
    );

    expect(createDraft).not.toHaveBeenCalled();
    expect(res.draftGenomeId).toBe('gen_existing');
    // All three parts the crawl produces, onto the genome the brand already has.
    expect(patchIdentity).toHaveBeenCalledTimes(1);
    expect(patchDimensions).toHaveBeenCalledTimes(1);
    expect(patchVoice).toHaveBeenCalledTimes(1);
  });

  it('leaves another brand’s genome alone', async () => {
    const createDraft = vi.fn(async () => ({ id: 'gen_new' }));
    const res = await tool().handler(
      input,
      ctx({
        listForOrg: (async () => [{ id: 'gen_other', brandId: 'brand_2' }]) as never,
        createDraft,
      } as Over),
    );

    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(res.draftGenomeId).toBe('gen_new');
  });

  /**
   * A crawl can suggest there is a person to film and can never establish that
   * they licensed their likeness, so the avatar stays off until the questions
   * screen says otherwise.
   */
  it('never turns the avatar on from a crawl', async () => {
    const patchDimensions = vi.fn(async ({ genomeId }: { genomeId: string }) => ({ id: genomeId, version: 3 }));
    await tool().handler(
      input,
      ctx({
        listForOrg: (async () => [{ id: 'gen_existing', brandId: 'brand_1' }]) as never,
        patchDimensions,
      } as Over),
    );

    expect(patchDimensions.mock.calls[0]![0]).toMatchObject({ avatarEnabled: false });
  });

  it('returns the same shape whichever genome it landed on', async () => {
    const fresh = await tool().handler(input, ctx());
    const reused = await tool().handler(
      input,
      ctx({ listForOrg: (async () => [{ id: 'gen_existing', brandId: 'brand_1' }]) as never } as Over),
    );

    expect(Object.keys(fresh).sort()).toEqual(Object.keys(reused).sort());
    expect(reused.chips).toHaveLength(1);
    expect(reused.why.summary).toContain('rowanvale.test');
  });
});
