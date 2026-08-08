import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET, resolve, type ResolvedPlaybook } from '@sparksocial/playbooks';
import { eligibleSubstitutes, fallbackDegrade } from '../src/fallback.js';

/**
 * §6.5: *"Fallbacks are mandatory … the calendar must never go empty because a
 * human did not film."*
 *
 * A missed week is the normal case for a local business, not an edge case, so
 * the behaviour under test is what happens on the owner's worst day.
 */

const saas = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!;
const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!;

/**
 * `notFound` is an explicit flag rather than `genome: undefined`, because
 * "caller passed nothing, use the default" and "the scoped repository found
 * nothing" are different situations that `undefined` cannot tell apart — and
 * conflating them makes the out-of-scope test silently assert nothing.
 */
function ctx(over: { genome?: unknown; inventory?: Record<string, number>; notFound?: boolean } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_gen_saas',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        get: async () => (over.notFound ? undefined : (over.genome ?? saas.genome)),
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => over.inventory ?? saas.assets,
        retrieve: async () => [],
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('eligibleSubstitutes', () => {
  const ranked = (over: Partial<ResolvedPlaybook> & { id: string; mode: string; unlockable: boolean }) =>
    ({
      playbook: { playbook_id: over.id, name: over.id, mode: over.mode, content_pillar: 'product' },
      score: over.score ?? 0.5,
      unlockable: over.unlockable,
      missingRoles: [],
      factors: [],
    }) as unknown as ResolvedPlaybook;

  it('excludes the playbook that was missed', () => {
    const out = eligibleSubstitutes(
      [ranked({ id: 'pb_missed', mode: 'assemble', unlockable: false })],
      'pb_missed',
    );
    expect(out).toHaveLength(0);
  });

  it('excludes anything that still needs filming', () => {
    // A direct_finish substitute answers "you didn't film" with "then film
    // something else" — the same empty calendar with extra steps.
    const out = eligibleSubstitutes(
      [
        ranked({ id: 'pb_other_shoot', mode: 'direct_finish', unlockable: false }),
        ranked({ id: 'pb_buildable', mode: 'assemble', unlockable: false }),
      ],
      'pb_missed',
    );
    expect(out.map((r) => r.playbook.playbook_id)).toEqual(['pb_buildable']);
  });

  it('excludes unlockable playbooks, whose assets do not exist yet', () => {
    const out = eligibleSubstitutes(
      [ranked({ id: 'pb_needs_assets', mode: 'assemble', unlockable: true })],
      'pb_missed',
    );
    expect(out).toHaveLength(0);
  });

  it('keeps synthesize as well as assemble', () => {
    const out = eligibleSubstitutes(
      [
        ranked({ id: 'pb_synth', mode: 'synthesize', unlockable: false }),
        ranked({ id: 'pb_asm', mode: 'assemble', unlockable: false }),
      ],
      'pb_missed',
    );
    expect(out).toHaveLength(2);
  });

  it('preserves the resolver’s ranking rather than re-scoring', () => {
    // A second ranking implementation would drift from the first, and then
    // "what SPARK posts" and "what SPARK posts when you're busy" would answer
    // to different rules.
    const out = eligibleSubstitutes(
      [
        ranked({ id: 'first', mode: 'assemble', unlockable: false, score: 0.9 }),
        ranked({ id: 'second', mode: 'assemble', unlockable: false, score: 0.8 }),
      ],
      'pb_missed',
    );
    expect(out.map((r) => r.playbook.playbook_id)).toEqual(['first', 'second']);
  });
});

describe('direct.fallback.degrade', () => {
  it('is read-effect and idempotent — choosing a substitute posts nothing', () => {
    expect(fallbackDegrade.effect).toBe('read');
    expect(fallbackDegrade.idempotent).toBe(true);
  });

  it('substitutes something buildable for a SaaS genome with real assets', async () => {
    const out = await fallbackDegrade.handler(
      { genomeId: 'gen_saas', missedPlaybookId: 'pb_craft_capture' },
      ctx(),
    );

    expect(out.substitute).not.toBeNull();
    expect(['assemble', 'synthesize']).toContain(out.substitute!.mode);
    expect(out.substitute!.playbookId).not.toBe('pb_craft_capture');
    expect(out.why.summary).toMatch(/instead/i);
  });

  it('never returns the missed playbook, even when it ranks first', async () => {
    // The resolver's own top pick for this genome must not come back as its own
    // replacement.
    const top = resolve(saas.genome, saas.assets).ranked[0]!;
    const out = await fallbackDegrade.handler(
      { genomeId: 'gen_saas', missedPlaybookId: top.playbook.playbook_id },
      ctx(),
    );
    expect(out.substitute?.playbookId).not.toBe(top.playbook.playbook_id);
  });

  it('returns null with an explanation, not an error, when nothing can run', async () => {
    // A brand-new barbershop: no assets at all. There is genuinely nothing to
    // post, and saying so is the correct answer — throwing would make a normal
    // week look like a system fault.
    const out = await fallbackDegrade.handler(
      { genomeId: 'gen_barber', missedPlaybookId: 'pb_craft_capture' },
      ctx({ genome: barber.genome, inventory: {} }),
    );

    expect(out.substitute).toBeNull();
    expect(out.why.summary).toMatch(/without new footage/i);
    expect(out.why.alternatives[0]?.rejectedBecause).toMatch(/existing assets/i);
  });

  it('reports an out-of-scope genome as NOT_FOUND, never another brand’s substitute', async () => {
    // The scoped repository returns undefined for a genome outside the caller's
    // org. That must surface as absent, not be read as "no genome data, carry
    // on" — which would hand back a substitute derived from nothing.
    const err = await fallbackDegrade
      .handler({ genomeId: 'gen_other_org', missedPlaybookId: 'pb_x' }, ctx({ notFound: true }))
      .catch((e: unknown) => e as ToolError);

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('names the missed brief in the why, so the swap is legible', async () => {
    const out = await fallbackDegrade.handler(
      { genomeId: 'gen_saas', missedPlaybookId: 'pb_craft_capture' },
      ctx(),
    );
    expect(out.missedPlaybookId).toBe('pb_craft_capture');
    expect(out.why.factors.some((f) => f.detail === 'pb_craft_capture')).toBe(true);
  });

  it('reads the inventory scoped to the caller’s org', async () => {
    const inventory = vi.fn(async () => saas.assets);
    const c = ctx();
    (c.db.assets as { inventory: unknown }).inventory = inventory;

    await fallbackDegrade.handler({ genomeId: 'gen_saas', missedPlaybookId: 'pb_x' }, c);

    expect(inventory).toHaveBeenCalledWith('gen_saas', 'org_1');
  });
});
