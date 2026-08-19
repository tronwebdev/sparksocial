import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { genomeOfferSet } from '../src/offer.js';

/**
 * `genome.offer.set` — the tool that fills `offer.primary_cta`. Nothing else
 * in onboarding or the crawl ever sets it, and fourteen playbook `cta` beats
 * source it directly (`source: 'genome:offer.primary_cta'`) — without this
 * tool, every one of those beats throws NOT_FOUND for every genome, always.
 */

function ctx(over: { patchOffer?: ScopedDb['genomes']['patchOffer'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        patchIdentity: async () => ({ id: 'g', version: 1 }),
        patchOffer: over.patchOffer ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('the registry contract', () => {
  it('is a write, not human_only — setting your own CTA is routine, not a governance decision', () => {
    expect(genomeOfferSet.effect).toBe('write');
    expect(genomeOfferSet.autonomy).toBe('auto');
  });
});

describe('genome.offer.set', () => {
  it('sends only the fields supplied, unchanged', async () => {
    const patchOffer = vi.fn<ScopedDb['genomes']['patchOffer']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 2,
    }));

    const out = await genomeOfferSet.handler(
      { genomeId: 'gen_1', offer: { primary_cta: 'Book now' } },
      ctx({ patchOffer }),
    );

    expect(out).toEqual({ genomeId: 'gen_1', version: 2 });
    expect(patchOffer).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      offer: { primary_cta: 'Book now' },
    });
  });

  it('sends products and primary_cta together in one call', async () => {
    const patchOffer = vi.fn<ScopedDb['genomes']['patchOffer']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 3,
    }));

    await genomeOfferSet.handler(
      {
        genomeId: 'gen_1',
        offer: { primary_cta: 'Try it free', products: [{ name: 'Starter plan' }] },
      },
      ctx({ patchOffer }),
    );

    expect(patchOffer).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      offer: { primary_cta: 'Try it free', products: [{ name: 'Starter plan' }] },
    });
  });

  it('strips a field the genome schema does not have, rather than saving it', () => {
    const parsed = genomeOfferSet.input.safeParse({ genomeId: 'gen_1', offer: { not_a_real_field: 'x' } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.offer).toEqual({});
  });

  it('accepts an empty patch — a no-op correction is not an error', () => {
    expect(genomeOfferSet.input.safeParse({ genomeId: 'gen_1', offer: {} }).success).toBe(true);
  });

  it('propagates NOT_FOUND for an unknown or out-of-scope genome', async () => {
    const patchOffer: ScopedDb['genomes']['patchOffer'] = async () => {
      throw new ToolError('NOT_FOUND', 'No genome.');
    };
    await expect(
      genomeOfferSet.handler({ genomeId: 'gen_x', offer: { primary_cta: 'x' } }, ctx({ patchOffer })),
    ).rejects.toThrow(ToolError);
  });
});
