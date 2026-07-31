import { describe, expect, it } from 'vitest';
import { GOLDEN_SET, lagosBarbershop, torontoSaas, manilaFreelancer, logisticsBroker } from '../src/golden.js';
import { PLAYBOOKS } from '../src/records.js';
import { resolve } from '../src/resolver.js';
import { classifyProfile, coldStartWeights, deriveMix, PROMOTIONAL_CEILING } from '../src/mix.js';
import { avatarDefault } from '@sparksocial/shared';

/**
 * THE ACCEPTANCE EVAL — engine spec §13, master plan §11.
 *
 * "Fit is the product" (§0). Everything else in this repo is checkable by reading
 * it; whether the engine produces *correct content for an arbitrary business* is
 * not, so it gets measured here instead.
 *
 * The bars, taken verbatim from plan §11:
 *   - Playbook resolution: **zero anti-pattern selections** on the golden set.
 *   - Mix correctness: within **±10 points** per pillar of the expert-authored
 *     table, and **never above 35% promotional**.
 *
 * The tell that the architecture works, per §13: the barbershop's month is mostly
 * footage SPARK told the owner how to film, and the SaaS month is mostly education
 * that mentions the product twice — **out of the same engine, un-tuned**.
 */

const TOP_N = 8;

/**
 * The ceiling is written here as a literal, deliberately. Asserting against the
 * imported PROMOTIONAL_CEILING would be a tautology — raise the constant and the
 * test raises with it. This number comes from plan §11 and outcomes Rule 2, and
 * the implementation has to meet it, not define it.
 */
const SPEC_PROMOTIONAL_CEILING = 0.35;

describe('§13 — zero anti-pattern selections', () => {
  it.each(GOLDEN_SET.map((c) => [c.label, c] as const))(
    '%s never selects a format that would get it cancelled',
    (_label, testCase) => {
      const { ranked } = resolve(testCase.genome, testCase.assets);
      const selected = ranked.slice(0, TOP_N).map((r) => r.playbook.playbook_id);

      for (const anti of testCase.antiPatterns) {
        expect(
          selected,
          `"${anti}" was selected for ${testCase.label}. This is the failure the ` +
            `product exists to prevent — a barbershop getting an AI avatar, or a ` +
            `SaaS getting a motivational quote card.`,
        ).not.toContain(anti);
      }
    },
  );

  it.each(GOLDEN_SET.filter((c) => c.expectTop.length).map((c) => [c.label, c] as const))(
    '%s surfaces the format a competent marketer would expect',
    (_label, testCase) => {
      const { ranked } = resolve(testCase.genome, testCase.assets);
      const producible = ranked.map((r) => r.playbook.playbook_id);
      const unlockable = ranked.filter((r) => r.unlockable).map((r) => r.playbook.playbook_id);

      for (const expected of testCase.expectTop) {
        expect(
          [...producible, ...unlockable],
          `${testCase.label} should reach "${expected}".`,
        ).toContain(expected);
      }
    },
  );

  it('every golden case resolves to something — no business is left with an empty month', () => {
    for (const c of GOLDEN_SET) {
      const { ranked } = resolve(c.genome, c.assets);
      expect(ranked.length, `${c.label} resolved zero playbooks.`).toBeGreaterThan(0);
    }
  });
});

describe('§6 — the capture loop is reachable, not discarded', () => {
  it('craft capture is the barbershop\'s TOP format, outranking everything producible today', () => {
    const { ranked } = resolve(lagosBarbershop.genome, lagosBarbershop.assets);

    // §5.2: direct_finish playbooks whose assets are missing are NOT discarded —
    // they come back unlockable and feed the capture loop. Asserting on *rank*
    // rather than mere presence is the point: if unlockable work is merely
    // present but ranks below a generic quote card, the local segment gets a
    // month of filler and the moat is gone.
    expect(ranked[0]?.playbook.playbook_id).toBe('pb_craft_capture');
    expect(ranked[0]?.unlockable).toBe(true);
  });

  it('Direct+Finish is the MAJORITY of the barbershop\'s month', () => {
    // §13's tell: "the barbershop's month is ~50% haircut footage SPARK told the
    // owner how to film."
    const top = resolve(lagosBarbershop.genome, lagosBarbershop.assets).ranked.slice(0, TOP_N);
    const direct = top.filter((r) => r.playbook.mode === 'direct_finish').length;
    expect(direct / top.length).toBeGreaterThanOrEqual(0.5);
  });

  it('the SaaS never films anything', () => {
    const saas = resolve(torontoSaas.genome, torontoSaas.assets).ranked.slice(0, TOP_N);
    expect(saas.filter((r) => r.playbook.mode === 'direct_finish')).toEqual([]);
  });

  it('the workflow clip is the SaaS\'s top format', () => {
    // "Highest intent-to-trial conversion of anything they can post, and
    // under-produced everywhere." (outcomes §1.1)
    const { ranked } = resolve(torontoSaas.genome, torontoSaas.assets);
    expect(ranked[0]?.playbook.playbook_id).toBe('pb_workflow_clip');
  });

  it('the SaaS leans on Assemble — the under-built, highest-converting path', () => {
    const { ranked } = resolve(torontoSaas.genome, torontoSaas.assets);
    const top = ranked.slice(0, 5);
    expect(top.filter((r) => r.playbook.mode === 'assemble').length).toBeGreaterThanOrEqual(3);
  });

  it('a business that can show nothing still resolves — via what it knows', () => {
    // The logistics broker has capture_capability ['nothing']. If the engine
    // cannot serve this, the long tail is lost.
    const { ranked } = resolve(logisticsBroker.genome, logisticsBroker.assets);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((r) => r.playbook.mode !== 'direct_finish')).toBe(true);
  });
});

describe('§10 — avatar is never a default', () => {
  it.each(GOLDEN_SET.map((c) => [c.label, c] as const))(
    '%s only reaches likeness formats when the proof asset really is a person',
    (_label, testCase) => {
      const { ranked } = resolve(testCase.genome, testCase.assets);
      const usesLikeness = ranked.filter((r) => r.playbook.preconditions.requires_likeness_license);

      if (!testCase.genome.constraints.avatar_enabled) {
        expect(
          usesLikeness.map((r) => r.playbook.playbook_id),
          `${testCase.label} has avatar_enabled=false but reached a cloning format.`,
        ).toEqual([]);
      }
    },
  );

  it('the freelancer DOES get the avatar — this is where it earns its keep', () => {
    const { ranked } = resolve(manilaFreelancer.genome, manilaFreelancer.assets);
    expect(ranked.map((r) => r.playbook.playbook_id)).toContain('pb_avatar_pov');
  });

  it('the §10 gate holds even when a likeness asset EXISTS', () => {
    // The weaker version of this test passes for the wrong reason: a barbershop
    // has no talent_likeness, so avatar formats fall out on asset availability
    // and the avatar rule is never exercised. Hand it a likeness and the gate is
    // the only thing left standing between a barbershop and an AI avatar telling
    // people to book an appointment.
    const withLikeness = { ...lagosBarbershop.assets, talent_likeness: 1 };
    const { ranked } = resolve(lagosBarbershop.genome, withLikeness);
    const ids = ranked.map((r) => r.playbook.playbook_id);

    for (const anti of lagosBarbershop.antiPatterns) {
      expect(ids, `"${anti}" resolved for a barbershop holding a likeness asset.`).not.toContain(anti);
    }
  });

  it('avatarDefault is false for a craft business however willing its staff are', () => {
    expect(avatarDefault(lagosBarbershop.genome.dimensions)).toBe(false);
    expect(avatarDefault({ proof_asset: ['physical_craft'], talent_availability: 'yes_licensed' })).toBe(false);
    expect(avatarDefault({ proof_asset: ['person'], talent_availability: 'yes_licensed' })).toBe(true);
    expect(avatarDefault({ proof_asset: ['person'], talent_availability: 'yes_unlicensed' })).toBe(false);
  });
});

describe('§7.1 — mix correctness', () => {
  it('classifies profile from dimensions alone, never from the category label', () => {
    expect(classifyProfile(lagosBarbershop.genome.dimensions)).toBe('local_business');
    expect(classifyProfile(torontoSaas.genome.dimensions)).toBe('b2b_saas');
    expect(classifyProfile(manilaFreelancer.genome.dimensions)).toBe('freelancer');

    // The proof: scramble every human-readable label and nothing changes.
    const disguised = {
      ...torontoSaas.genome,
      identity: { ...torontoSaas.genome.identity, category: 'barbershop', business_name: 'Emeka Cuts' },
    };
    expect(classifyProfile(disguised.dimensions)).toBe('b2b_saas');
  });

  it.each(GOLDEN_SET.map((c) => [c.label, c] as const))(
    '%s never exceeds 35%% promotional',
    (_label, testCase) => {
      const mix = deriveMix(testCase.genome);
      expect(mix.weights.product ?? 0).toBeLessThanOrEqual(SPEC_PROMOTIONAL_CEILING);
    },
  );

  it.each(GOLDEN_SET.map((c) => [c.label, c] as const))('%s mix sums to 1', (_label, testCase) => {
    const mix = deriveMix(testCase.genome);
    const total = Object.values(mix.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('the implementation ceiling matches the spec', () => {
    expect(PROMOTIONAL_CEILING).toBe(SPEC_PROMOTIONAL_CEILING);
  });

  it('a local business sits near 20% promotional, not 100%', () => {
    // "The most common way an AI social tool fails is posting 100% promotional
    // content." (outcomes doc Rule 2)
    const mix = deriveMix(lagosBarbershop.genome);
    expect(mix.weights.product).toBeCloseTo(0.2, 2);
  });

  it('derived mix stays within ±10 points of the expert-authored table', () => {
    for (const c of GOLDEN_SET) {
      const profile = classifyProfile(c.genome.dimensions);
      const expected = coldStartWeights(profile);
      const actual = deriveMix(c.genome).weights;

      for (const [pillar, want] of Object.entries(expected) as [keyof typeof expected, number][]) {
        const got = actual[pillar] ?? 0;
        expect(
          Math.abs(got - want),
          `${c.label} / ${pillar}: expected ~${want}, got ${got}`,
        ).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('defers to cold-start defaults until learned confidence clears 0.4', () => {
    const shaky = {
      ...torontoSaas.genome,
      learned: {
        ...torontoSaas.genome.learned,
        confidence: 0.3,
        mix_weights_override: { product: 0.9, educational: 0.1 },
      },
    };
    expect(deriveMix(shaky).source).toBe('cold_start');
    expect(deriveMix(shaky).weights.product).not.toBeCloseTo(0.9, 2);

    const confident = { ...shaky, learned: { ...shaky.learned, confidence: 0.55 } };
    expect(deriveMix(confident).source).toBe('learned');
  });

  it('a learned override is still capped at the promotional ceiling', () => {
    // The sampler optimises for engagement; left alone it would happily discover
    // that promos convert and drive the account to 90% offers. The ceiling is not
    // negotiable by the learning loop.
    const greedy = {
      ...torontoSaas.genome,
      learned: {
        ...torontoSaas.genome.learned,
        confidence: 0.9,
        mix_weights_override: { product: 0.9, educational: 0.1 },
      },
    };
    const mix = deriveMix(greedy);
    expect(mix.weights.product ?? 0).toBeLessThanOrEqual(SPEC_PROMOTIONAL_CEILING);
    expect(Object.values(mix.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('§13 — the tell', () => {
  it('barbershop and SaaS get visibly different months from one un-tuned engine', () => {
    const barberTop = resolve(lagosBarbershop.genome, lagosBarbershop.assets).ranked.slice(0, TOP_N);
    const saasTop = resolve(torontoSaas.genome, torontoSaas.assets).ranked.slice(0, TOP_N);

    const barberIds = new Set(barberTop.map((r) => r.playbook.playbook_id));
    const saasIds = new Set(saasTop.map((r) => r.playbook.playbook_id));
    const shared = [...barberIds].filter((id) => saasIds.has(id));

    // Some overlap is fine and expected (offers, local context). Wholesale overlap
    // would mean the engine is not actually reading the genome.
    expect(shared.length).toBeLessThan(TOP_N / 2);

    // And the pillar emphasis differs the way the spec says it should.
    const barberMix = deriveMix(lagosBarbershop.genome).weights;
    const saasMix = deriveMix(torontoSaas.genome).weights;
    expect(barberMix.community ?? 0).toBeGreaterThan(saasMix.community ?? 0);
    expect(saasMix.educational ?? 0).toBeGreaterThan(barberMix.educational ?? 0);
  });
});

describe('library hygiene', () => {
  it('no playbook branches on a niche, category, or industry name', () => {
    // CLAUDE.md invariant 5, checked mechanically. Preconditions may only mention
    // dimension values and asset roles.
    for (const p of PLAYBOOKS) {
      const keys = Object.keys(p.preconditions);
      expect(keys.every((k) => !/category|niche|industry|segment/i.test(k))).toBe(true);
    }
  });

  it('playbook ids are unique', () => {
    const ids = PLAYBOOKS.map((p) => p.playbook_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all three production modes', () => {
    const modes = new Set(PLAYBOOKS.map((p) => p.mode));
    expect(modes).toEqual(new Set(['synthesize', 'assemble', 'direct_finish']));
  });

  it('every playbook declares fit for at least one objective', () => {
    for (const p of PLAYBOOKS) {
      expect(Object.keys(p.objective_fit).length, `${p.playbook_id} has no objective_fit`).toBeGreaterThan(0);
    }
  });
});
