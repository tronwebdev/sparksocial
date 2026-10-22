import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { genomeGet } from '../src/get.js';

/**
 * `genome.get` — the tool a screen had been calling for a while.
 *
 * `AgentStep` invoked `'genome.get'` to decide whether to show an avatar and a
 * voice as already set. No such tool was registered, so every call returned
 * `NOT_FOUND`, the effect early-returned on a non-`succeeded` result, and the
 * step showed an empty state for a brand that had both. A hand-written
 * `invoke<T>` type parameter meant the compiler had nothing to say about it;
 * `scripts/check-tool-inputs.mjs` is what found it.
 *
 * The assertion that matters is the `constraints` passthrough — that is the
 * only reason the caller wanted this rather than `genome.list`.
 */

const GENOME = {
  genome_id: 'gen_1',
  workspace_id: 'brand_1',
  version: 4,
  identity: { business_name: 'Emeka Cuts' },
  dimensions: { objective: 'bookings' },
  offer: { primary_cta: 'Book a chair' },
  voice: { point_of_view: 'first_person_plural' },
  audience: { primary: 'local regulars' },
  constraints: {
    heygen_avatar_id: 'tp_abc',
    heygen_avatar_kind: 'talking_photo',
    elevenlabs_voice_id: 'voice_1',
  },
};

function ctx(get: (id: string, orgId: string) => Promise<unknown> = async () => GENOME): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    db: { genomes: { get } },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('genome.get', () => {
  it('returns the constraints, which is the whole reason it exists', async () => {
    const out = await genomeGet.handler({ genomeId: 'gen_1' }, ctx());

    expect(out.genome.constraints).toMatchObject({
      heygen_avatar_id: 'tp_abc',
      elevenlabs_voice_id: 'voice_1',
    });
  });

  /*
   * The repository hands back the PRD-shaped genome — `genome_id` and
   * `workspace_id`, not `id` and `brandId`. The first version of this tool
   * read the camelCase names and returned `undefined` for both, which
   * type-checked only until the real store type was applied.
   */
  /*
   * The hero on the Command Center has a slot labelled "Primary CTA" and
   * rendered an em dash in it for every brand, under a comment explaining that
   * no such field existed. It did: `genome.offer.set` writes `primary_cta` to
   * its own column and fourteen playbook `cta` beats read it verbatim. This
   * tool was the only thing in the way — it returned identity, dimensions and
   * constraints and dropped the rest of the row on the floor.
   */
  it('returns the offer, so a screen can show the call-to-action', async () => {
    const out = await genomeGet.handler({ genomeId: 'gen_1' }, ctx());

    expect(out.genome.offer).toMatchObject({ primary_cta: 'Book a chair' });
    expect(out.genome.voice).toMatchObject({ point_of_view: 'first_person_plural' });
    expect(out.genome.audience).toMatchObject({ primary: 'local regulars' });
  });

  /*
   * `learned` is the one column deliberately left off: accumulated rather than
   * authored, unbounded, and read directly by the tools that care. A read tool
   * that grows without limit is a different problem from one that omits a field.
   */
  it('leaves the learned state out', async () => {
    const out = await genomeGet.handler({ genomeId: 'gen_1' }, ctx());

    expect(out.genome).not.toHaveProperty('learned');
  });

  it('maps the stored keys to the ones callers use', async () => {
    const out = await genomeGet.handler({ genomeId: 'gen_1' }, ctx());

    expect(out.genome.genomeId).toBe('gen_1');
    expect(out.genome.brandId).toBe('brand_1');
    expect(out.genome.version).toBe(4);
  });

  it('is a read, so nothing about asking needs approval', () => {
    expect(genomeGet.effect).toBe('read');
    expect(genomeGet.autonomy).toBe('auto');
  });

  it('passes the caller’s org to the store rather than trusting the input alone', async () => {
    const seen: Array<[string, string]> = [];
    await genomeGet.handler(
      { genomeId: 'gen_1' },
      ctx(async (id, orgId) => {
        seen.push([id, orgId]);
        return GENOME;
      }),
    );

    expect(seen).toEqual([['gen_1', 'org_1']]);
  });

  it('reads a genome outside the org as absent, not forbidden', async () => {
    await expect(
      genomeGet.handler({ genomeId: 'gen_other' }, ctx(async () => undefined)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
