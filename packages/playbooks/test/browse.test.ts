import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { PLAYBOOKS } from '../src/records.js';
import { resolve } from '../src/resolver.js';
import { lagosBarbershop } from '../src/golden.js';
import { playbookList, playbookGet, playbookExplain } from '../src/browse.js';

/**
 * `playbook.list` / `.get` / `.explain` — direct browsing of the static
 * library `playbook.resolve` has always read from but never exposed.
 * `.explain`'s assertions are cross-checked against a real `resolve()` call
 * rather than a hand-picked fixture, so a future change to the resolver
 * can't silently drift the tool out of sync with what it wraps.
 */

function ctx(over: { genome?: unknown } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: { get: async () => ('genome' in over ? over.genome : lagosBarbershop.genome) },
      assets: { inventory: async () => lagosBarbershop.assets },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('playbook.list', () => {
  it('lists the full active library, matching PLAYBOOKS exactly', async () => {
    const out = await playbookList.handler({ activeOnly: true }, ctx());
    const expectedCount = PLAYBOOKS.filter((p) => p.is_active).length;
    expect(out.total).toBe(expectedCount);
    expect(out.playbooks).toHaveLength(expectedCount);
  });

  it('every entry names a real playbook_id findable by playbook.get', async () => {
    const out = await playbookList.handler({ activeOnly: true }, ctx());
    for (const p of out.playbooks) {
      expect(PLAYBOOKS.some((real) => real.playbook_id === p.playbookId)).toBe(true);
    }
  });

  it('needs no genome — the same call for every caller, static catalog', () => {
    expect(playbookList.input.safeParse({}).success).toBe(true);
  });
});

describe('playbook.get', () => {
  it('returns the real record for a known playbook', async () => {
    const out = await playbookGet.handler({ playbookId: 'pb_craft_capture' }, ctx());
    expect(out.playbookId).toBe('pb_craft_capture');
    expect(out.mode).toBe('direct_finish');
    expect(out.beatCount).toBeGreaterThan(0);
  });

  it('throws NOT_FOUND for a made-up id', async () => {
    await expect(playbookGet.handler({ playbookId: 'pb_does_not_exist' }, ctx())).rejects.toThrow(ToolError);
  });
});

describe('playbook.explain', () => {
  it('agrees with a direct resolve() call for a ranked (producible or unlockable) playbook', async () => {
    const { ranked } = resolve(lagosBarbershop.genome, lagosBarbershop.assets);
    const sample = ranked[0]!;

    const out = await playbookExplain.handler({ genomeId: 'gen_1', playbookId: sample.playbook.playbook_id }, ctx());

    expect(out.unlockable).toBe(sample.unlockable);
    expect(out.producible).toBe(!sample.unlockable);
    expect(out.missingRoles).toEqual(sample.missingRoles);
    expect(out.score).toBeCloseTo(sample.score, 4);
  });

  it('reports an unlockable playbook honestly — producible false, unlockable true, missing roles named', async () => {
    const { ranked } = resolve(lagosBarbershop.genome, lagosBarbershop.assets);
    const unlockable = ranked.find((r) => r.unlockable);
    if (!unlockable) return; // nothing unlockable for this fixture right now — not this test's job to force one

    const out = await playbookExplain.handler({ genomeId: 'gen_1', playbookId: unlockable.playbook.playbook_id }, ctx());

    expect(out.producible).toBe(false);
    expect(out.unlockable).toBe(true);
    expect(out.missingRoles.length).toBeGreaterThan(0);
    expect(out.why.summary).toContain('film a capture brief');
  });

  it('agrees with resolve() for a playbook rejected outright on dimensions', async () => {
    const { rejected } = resolve(lagosBarbershop.genome, lagosBarbershop.assets);
    if (rejected.length === 0) return; // this genome has nothing rejected — nothing to assert

    const sample = rejected[0]!;
    const out = await playbookExplain.handler({ genomeId: 'gen_1', playbookId: sample.playbook_id }, ctx());

    expect(out.producible).toBe(false);
    expect(out.unlockable).toBe(false);
    expect(out.why.summary).toContain(sample.because);
  });

  it('throws NOT_FOUND for a playbook id that does not exist at all', async () => {
    await expect(
      playbookExplain.handler({ genomeId: 'gen_1', playbookId: 'pb_does_not_exist' }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('throws NOT_FOUND for an unknown genome', async () => {
    await expect(
      playbookExplain.handler({ genomeId: 'gen_missing', playbookId: 'pb_craft_capture' }, ctx({ genome: undefined })),
    ).rejects.toThrow(ToolError);
  });
});
