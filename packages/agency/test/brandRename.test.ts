import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { brandSettingsPatch } from '../src/brand.js';

/**
 * A rename that said "Saved" and wrote nothing.
 *
 * `brands.get(brandId, orgId, name)` takes a name, and that argument is the
 * name to *insert* with — `get` returns an existing row before it is ever
 * read. `brand.settings.patch` called it and returned `input.name`, so on any
 * brand that already existed, which is all of them, the write was a no-op and
 * the response echoed back what it had been handed. The screen agreed with the
 * tool because neither had asked the database.
 *
 * Reported as: "it shows saved, but it does not reflect ... it still go on to
 * show the previous name/details anywhere it appears".
 */
function ctx(over: { rename?: ReturnType<typeof vi.fn>; list?: unknown[]; patchIdentity?: ReturnType<typeof vi.fn> } = {}) {
  const rename = over.rename ?? vi.fn(async (brandId: string, _orgId: string, name: string) => ({ brandId, name }));
  const patchIdentity = over.patchIdentity ?? vi.fn(async () => ({ id: 'gen_1', version: 2 }));
  return {
    ctx: {
      orgId: 'org_1',
      role: 'owner',
      db: {
        brands: { rename, get: vi.fn(async () => ({ brandId: 'b1', name: 'STALE' })) },
        genomes: {
          listForOrg: vi.fn(async () => over.list ?? [{ id: 'gen_1', brandId: 'b1', name: 'Old', updatedAt: new Date() }]),
          patchIdentity,
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    } as unknown as ToolCtx,
    rename,
    patchIdentity,
  };
}

describe('brand.settings.patch', () => {
  it('writes the name instead of echoing it', async () => {
    const { ctx: c, rename } = ctx();

    await brandSettingsPatch.handler({ brandId: 'b1', name: 'Clientforce' }, c);

    expect(rename).toHaveBeenCalledWith('b1', 'org_1', 'Clientforce');
  });

  /*
   * The returned name is the stored one, not the requested one. They agree on
   * the happy path and the difference is the whole point: a response built
   * from the input cannot report a write that did not happen.
   */
  it('answers with what the store holds', async () => {
    const rename = vi.fn(async () => ({ brandId: 'b1', name: 'Clientforce' }));
    const { ctx: c } = ctx({ rename });

    const out = await brandSettingsPatch.handler({ brandId: 'b1', name: 'Clientforce' }, c);

    expect(out).toEqual({ brandId: 'b1', name: 'Clientforce' });
  });

  /*
   * The other half of "it does not reflect". The name lives twice — governance
   * and `identity.business_name` — and the switcher, the workspaces grid and
   * the agent's byline all read the genome.
   */
  it('relabels the brand\u2019s genomes too', async () => {
    const { ctx: c, patchIdentity } = ctx();

    await brandSettingsPatch.handler({ brandId: 'b1', name: 'Clientforce' }, c);

    expect(patchIdentity).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      identity: { business_name: 'Clientforce' },
    });
  });

  it('leaves other brands\u2019 genomes alone', async () => {
    const { ctx: c, patchIdentity } = ctx({
      list: [
        { id: 'gen_1', brandId: 'b1', name: 'Mine', updatedAt: new Date() },
        { id: 'gen_2', brandId: 'b2', name: 'Someone else', updatedAt: new Date() },
      ],
    });

    await brandSettingsPatch.handler({ brandId: 'b1', name: 'Clientforce' }, c);

    expect(patchIdentity).toHaveBeenCalledTimes(1);
    expect(patchIdentity.mock.calls[0]![0]).toMatchObject({ genomeId: 'gen_1' });
  });

  /*
   * A relabel that fails must not undo a rename that happened. The brand is
   * renamed; one genome keeping an old `business_name` is a smaller wrong than
   * a rename reported as failed after it was written.
   */
  it('keeps the rename when a genome cannot be relabelled', async () => {
    const patchIdentity = vi.fn(async () => {
      throw new Error('nope');
    });
    const { ctx: c } = ctx({ patchIdentity });

    const out = await brandSettingsPatch.handler({ brandId: 'b1', name: 'Clientforce' }, c);

    expect(out.name).toBe('Clientforce');
  });
});
