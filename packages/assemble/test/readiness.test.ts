import { describe, expect, it } from 'vitest';
import { PLAYBOOKS, requiredGenomePaths, resolve } from '@sparksocial/playbooks';
import { DESCRIBED_GENOME_PATHS, genomeRequirement, type AssetRole, type Genome } from '@sparksocial/shared';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { buildRenderPlan, parseBeatSource } from '../src/plan.js';

/**
 * THE GUARD THAT CLOSES THE CLASS: nothing the resolver calls ready can throw at
 * plan time for a fact the brand never supplied.
 *
 * ── The defect this exists for ────────────────────────────────────────────
 *
 * Fourteen playbooks source their closing beat from `genome:offer.primary_cta`.
 * `Preconditions` described everything a brand had to *own* — asset roles, a
 * minimum count, capture capability, filmable talent, a likeness licence — and
 * nothing it had to have *said*. So against a genome with no CTA the resolver
 * ranked all fourteen as ready, `planCampaign` counted them into `buildableNow`,
 * the calendar placed nine posts across a month, and the refusal arrived when
 * somebody opened one:
 *
 *     The genome has no value at "offer.primary_cta".
 *
 * `planBeat` was right to refuse — an empty CTA frame is worse than no post. It
 * refused in the wrong *place*: one week and three screens after the decision
 * that caused it, at which point the only available action is to close a dialog.
 *
 * ── Why a test and not a comment ──────────────────────────────────────────
 *
 * The requirement is derived from the beats rather than authored beside them,
 * precisely so it cannot be forgotten. But "derived correctly" is a property of
 * two functions in two packages agreeing — `requiredGenomePaths` in
 * `packages/playbooks` and `parseBeatSource` in `packages/assemble`, which cannot
 * import each other. The agreement is asserted here, in the package that can see
 * both.
 */

function genomeWithout(base: Genome, path: string): Genome {
  // Structural clone, then blank the one leaf. Mutating a shared fixture would
  // make the case order-dependent, which is the sort of test that passes alone
  // and fails in a suite.
  const clone = JSON.parse(JSON.stringify(base)) as Genome;
  const keys = path.split('.');
  const leaf = keys.pop()!;
  let node: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (const key of keys) node = node[key] as Record<string, unknown>;
  node[leaf] = '';
  return clone;
}

const ASSEMBLE_PLAYBOOKS = PLAYBOOKS.filter((p) => p.mode === 'assemble');

describe('derived genome requirements', () => {
  it('finds the playbooks it is guarding, so an empty list cannot pass silently', () => {
    const withPaths = PLAYBOOKS.filter((p) => requiredGenomePaths(p).length > 0);
    expect(withPaths.length).toBeGreaterThan(10);
  });

  it('agrees with the beat parser about which sources are genome sources', () => {
    /**
     * The two-package agreement. `requiredGenomePaths` matches the `genome:`
     * prefix by hand because `packages/playbooks` is built before
     * `packages/assemble` and cannot import `parseBeatSource`. That is one string
     * duplicated in two places, and this is what stops it drifting: if either
     * side changes its mind about what a genome source looks like, the derived
     * requirement stops matching what `planBeat` will actually read, and the
     * resolver goes back to calling things ready that throw.
     */
    for (const playbook of PLAYBOOKS) {
      const fromParser = playbook.structure.beats
        .filter((b) => b.source)
        .map((b) => parseBeatSource(b.source!))
        .filter((s) => s.kind === 'genome')
        .map((s) => (s as { kind: 'genome'; path: string }).path);

      expect(new Set(requiredGenomePaths(playbook))).toEqual(new Set(fromParser));
    }
  });

  it('has real words for every path any playbook actually reads', () => {
    // The fallback in `genomeRequirement` keeps a new path from producing a blank
    // screen, but its wording is deliberately poor. This is the reminder to write
    // the real line rather than ship the generated one.
    const used = new Set(PLAYBOOKS.flatMap((p) => requiredGenomePaths(p)));
    const undescribed = [...used].filter((p) => !DESCRIBED_GENOME_PATHS.includes(p));
    expect(
      undescribed,
      'These genome paths are read by a playbook beat and have no entry in `REQUIREMENTS` ' +
        '(`packages/shared/src/genomeRequirements.ts`), so the product would ask for them by their ' +
        `schema path. Add a label, a hint and the screen that fixes them.\n  ${undescribed.join('\n  ')}`,
    ).toEqual([]);
  });

  it('describes nothing no playbook reads', () => {
    const used = new Set(PLAYBOOKS.flatMap((p) => requiredGenomePaths(p)));
    const stale = DESCRIBED_GENOME_PATHS.filter((p) => !used.has(p));
    expect(stale, `Described but read by nothing: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('the resolver never calls a playbook ready that plan time would refuse', () => {
  /**
   * The real assertion, run against every golden brand and every requirement.
   *
   * For each described path, the brand's genome is emptied at that path and the
   * whole library re-resolved. Anything still marked ready is then actually
   * planned, and must not throw. Before the resolver checked genome facts this
   * failed on the first case with fourteen playbooks in the ready set.
   */
  for (const golden of GOLDEN_SET) {
    for (const path of DESCRIBED_GENOME_PATHS) {
      it(`${golden.label} with no ${genomeRequirement(path).label}`, () => {
        const genome = genomeWithout(golden.genome, path);
        const { ranked } = resolve(genome, golden.assets);
        const ready = ranked.filter((r) => !r.unlockable);

        // A ready playbook that reads the emptied path is the bug itself: it
        // would be counted, scheduled, and refused on open.
        for (const r of ready) {
          expect(
            requiredGenomePaths(r.playbook),
            `${r.playbook.playbook_id} is ready but reads ${path}, which this genome has not set`,
          ).not.toContain(path);
        }

        // And the planner agrees, for the ones it can plan at all.
        for (const r of ready) {
          if (r.playbook.mode !== 'assemble') continue;
          const assets = Object.entries(golden.assets).flatMap(([role, count]) =>
            Array.from({ length: count ?? 0 }, (_unused, i) => ({
              assetId: `${role}_${i}`,
              role: role as AssetRole,
              caption: null,
              score: 1 - i / 100,
            })),
          );
          expect(() => buildRenderPlan({ playbook: r.playbook, genome, assets })).not.toThrow(
            /has not set one yet/,
          );
        }
      });
    }
  }

  it('reports the missing fact rather than hiding the playbook', () => {
    // Rejecting it would leave somebody with a shorter list and no idea why. The
    // route has to come back, or the campaign cannot say what to fix.
    const golden = GOLDEN_SET[0]!;
    const genome = genomeWithout(golden.genome, 'offer.primary_cta');
    const { ranked } = resolve(genome, golden.assets);

    const blocked = ranked.filter((r) => r.missingGenomePaths.includes('offer.primary_cta'));
    expect(blocked.length).toBeGreaterThan(0);
    for (const r of blocked) {
      expect(r.unlockable).toBe(true);
      expect(r.unlockedBy).toBe('answer');
    }
  });

  it('prefers the answer route over filming when both are missing', () => {
    // Telling somebody to give up a Saturday while a one-line answer still blocks
    // the same post is advice that wastes their day.
    const golden = GOLDEN_SET[0]!;
    const genome = genomeWithout(golden.genome, 'offer.primary_cta');
    // An empty library, so the asset gap is real for everything too.
    const { ranked } = resolve(genome, {});

    const bothMissing = ranked.filter(
      (r) => r.missingGenomePaths.length > 0 && r.missingRoles.length > 0,
    );
    expect(bothMissing.length).toBeGreaterThan(0);
    for (const r of bothMissing) expect(r.unlockedBy).toBe('answer');
  });

  it('goes back to ready once the fact is supplied', () => {
    // The other direction, or the check above would pass on a resolver that
    // refused everything.
    const golden = GOLDEN_SET[0]!;
    const { ranked } = resolve(golden.genome, golden.assets);
    expect(ranked.some((r) => !r.unlockable)).toBe(true);
    for (const r of ranked) expect(r.missingGenomePaths).toEqual([]);
  });
});

describe('assemble playbooks are covered by this guard at all', () => {
  it('has assemble-mode playbooks that read the genome', () => {
    // Without this the `mode !== 'assemble'` skip above could silently make the
    // planner half of the assertion a no-op.
    const covered = ASSEMBLE_PLAYBOOKS.filter((p) => requiredGenomePaths(p).length > 0);
    expect(covered.length).toBeGreaterThan(0);
  });
});
