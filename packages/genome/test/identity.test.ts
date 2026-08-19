import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { genomeIdentitySet } from '../src/identity.js';

/**
 * `genome.identity.set` — the tool `ChipReview`'s "Looks right" step was
 * missing (§ONB-02). What matters here: only the fields supplied are sent
 * through, a bad shape is rejected before it reaches the store, and a
 * store-level NOT_FOUND propagates rather than being swallowed.
 */

function ctx(over: { patchIdentity?: ScopedDb['genomes']['patchIdentity'] } = {}): ToolCtx {
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
        patchIdentity: over.patchIdentity ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
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
  it('is a write, not human_only — correcting an inferred fact is routine, not a governance decision', () => {
    expect(genomeIdentitySet.effect).toBe('write');
    expect(genomeIdentitySet.autonomy).toBe('auto');
  });
});

describe('genome.identity.set', () => {
  it('sends only the fields supplied, unchanged', async () => {
    const patchIdentity = vi.fn<ScopedDb['genomes']['patchIdentity']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 2,
    }));

    const out = await genomeIdentitySet.handler(
      { genomeId: 'gen_1', identity: { business_name: 'Tronweb' } },
      ctx({ patchIdentity }),
    );

    expect(out).toEqual({ genomeId: 'gen_1', version: 2 });
    expect(patchIdentity).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      identity: { business_name: 'Tronweb' },
    });
  });

  it('sends multiple corrected fields in one call', async () => {
    const patchIdentity = vi.fn<ScopedDb['genomes']['patchIdentity']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 3,
    }));

    await genomeIdentitySet.handler(
      { genomeId: 'gen_1', identity: { business_name: 'Tronweb', category: 'software' } },
      ctx({ patchIdentity }),
    );

    expect(patchIdentity).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      identity: { business_name: 'Tronweb', category: 'software' },
    });
  });

  it('strips a field the genome schema does not have, rather than saving it', () => {
    // Zod object parsing strips unrecognised keys by default — this is the
    // guarantee `patchIdentity`'s own regex backstop leans on: whatever
    // reaches the repository already only has real GenomeIdentity keys.
    const parsed = genomeIdentitySet.input.safeParse({ genomeId: 'gen_1', identity: { not_a_real_field: 'x' } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.identity).toEqual({});
  });

  it('accepts an empty patch — a no-op correction is not an error', () => {
    expect(genomeIdentitySet.input.safeParse({ genomeId: 'gen_1', identity: {} }).success).toBe(true);
  });

  it('propagates NOT_FOUND for an unknown or out-of-scope genome', async () => {
    const patchIdentity: ScopedDb['genomes']['patchIdentity'] = async () => {
      throw new ToolError('NOT_FOUND', 'No genome.');
    };
    await expect(
      genomeIdentitySet.handler({ genomeId: 'gen_x', identity: { business_name: 'x' } }, ctx({ patchIdentity })),
    ).rejects.toThrow(ToolError);
  });
});
