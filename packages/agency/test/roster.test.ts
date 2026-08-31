import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { agencyRoster } from '../src/roster.js';

/**
 * `agency.roster` — the one org-level read in the product.
 *
 * ── What these guard ──────────────────────────────────────────────────────
 *
 * Not the arithmetic. What matters is the boundary: this tool exists because an
 * agency needs to compare forty clients, and every other read is genome-scoped
 * precisely so that one client's material never surfaces in another's. So the
 * assertions are about *shape* and *scope* — aggregates keyed by brand, owner and
 * admin only — and about the ordering, which is the difference between a
 * directory and a worklist.
 */

interface Brand {
  id: string;
  brandId: string;
  name: string;
  updatedAt: Date;
}

interface Roll {
  genomeId: string;
  publishedCount: number;
  impressions: number;
  engagements: number;
}

function ctx(brands: Brand[], rollup: Roll[], calls: unknown[] = []): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: { listForOrg: async (orgId: string) => { calls.push({ listForOrg: orgId }); return brands; } },
      analytics: {
        orgRollup: async (orgId: string, windowDays: number) => {
          calls.push({ orgRollup: orgId, windowDays });
          return rollup;
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const brand = (id: string, name: string): Brand => ({
  id,
  brandId: `brand_${id}`,
  name,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
});

describe('agency.roster', () => {
  it('lists every brand, including ones with no numbers at all', async () => {
    /**
     * A brand absent from the roll-up published nothing, which is the single most
     * important row on this screen — an inner join would have hidden exactly the
     * clients the agency opened the page to find.
     */
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx([brand('gen_a', 'Atlas'), brand('gen_b', 'Fish Harbour')], [
        { genomeId: 'gen_a', publishedCount: 12, impressions: 4000, engagements: 210 },
      ]),
    );

    expect(out.brands.map((b) => b.name).sort()).toEqual(['Atlas', 'Fish Harbour']);
    expect(out.brands.find((b) => b.name === 'Fish Harbour')!.publishedCount).toBe(0);
  });

  it('marks a brand with nothing published as quiet', async () => {
    // Called out rather than left as a zero: a zero reads as a data gap, and
    // "quiet" reads as a state somebody should act on.
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx([brand('gen_b', 'Fish Harbour')], []),
    );
    expect(out.brands[0]!.quiet).toBe(true);
  });

  it('puts quiet brands first, then the least published', async () => {
    /**
     * The ordering is the design. A roster sorted by name is a directory; sorted
     * by silence it is a worklist, and the client nobody has posted for is not on
     * page three.
     */
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx(
        [brand('gen_a', 'Busy'), brand('gen_b', 'Quiet'), brand('gen_c', 'Slow')],
        [
          { genomeId: 'gen_a', publishedCount: 20, impressions: 0, engagements: 0 },
          { genomeId: 'gen_c', publishedCount: 2, impressions: 0, engagements: 0 },
        ],
      ),
    );
    expect(out.brands.map((b) => b.name)).toEqual(['Quiet', 'Slow', 'Busy']);
  });

  it('returns aggregates only — no content field of any kind', async () => {
    /**
     * The boundary, asserted as a shape. This read crosses the genome scope; what
     * makes that safe is that it can only carry counts. A caption, a post id or a
     * message here would be the leak the genome predicate exists to prevent,
     * wearing a different name — so the key set is checked rather than trusted.
     */
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx([brand('gen_a', 'Atlas')], [{ genomeId: 'gen_a', publishedCount: 3, impressions: 10, engagements: 4 }]),
    );

    expect(Object.keys(out.brands[0]!).sort()).toEqual(
      ['brandId', 'engagements', 'genomeId', 'impressions', 'name', 'publishedCount', 'quiet', 'updatedAt'].sort(),
    );
  });

  it('totals the org without making the screen sum a column', async () => {
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx(
        [brand('gen_a', 'A'), brand('gen_b', 'B'), brand('gen_c', 'C')],
        [
          { genomeId: 'gen_a', publishedCount: 5, impressions: 100, engagements: 10 },
          { genomeId: 'gen_b', publishedCount: 3, impressions: 50, engagements: 6 },
        ],
      ),
    );
    expect(out.totals).toEqual({ brands: 3, quiet: 1, publishedCount: 8, impressions: 150, engagements: 16 });
  });

  it('reads the org once, not once per brand', async () => {
    /**
     * Two calls total, whatever the brand count. The obvious implementation is one
     * metrics read per brand, which is forty round trips on a page load — and
     * worse, forty slightly different window boundaries, so brands rendered later
     * would be compared against a later cutoff.
     */
    const calls: unknown[] = [];
    await agencyRoster.handler(
      { windowDays: 7 },
      ctx([brand('gen_a', 'A'), brand('gen_b', 'B'), brand('gen_c', 'C')], [], calls),
    );
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual({ orgRollup: 'org_1', windowDays: 7 });
  });

  it('is owner and admin only', async () => {
    /**
     * An `editor` assigned to two of forty brands has no business reading the other
     * thirty-eight's numbers, and `brand_members` is what says which two — a check
     * this tool would have to duplicate to be safe at a wider scope. Restricting is
     * the honest version; an agency roster is an administrator's screen.
     */
    expect(agencyRoster.scopes).toEqual(['owner', 'admin']);
    expect(agencyRoster.effect).toBe('read');
  });

  it('says how many are quiet rather than only that some are', async () => {
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx([brand('gen_a', 'A'), brand('gen_b', 'B')], [
        { genomeId: 'gen_a', publishedCount: 1, impressions: 0, engagements: 0 },
      ]),
    );
    expect(out.why.summary).toMatch(/1 of 2/);
  });

  it('says so plainly when every brand is active', async () => {
    const out = await agencyRoster.handler(
      { windowDays: 30 },
      ctx([brand('gen_a', 'A')], [{ genomeId: 'gen_a', publishedCount: 4, impressions: 0, engagements: 0 }]),
    );
    expect(out.why.summary).toMatch(/All 1 brands published/);
  });

  it('names the thing a reader would otherwise mis-read', async () => {
    // A brand with no connected account cannot publish and will read as quiet.
    // True, and a different problem from a brand that could publish and did not.
    const out = await agencyRoster.handler({ windowDays: 30 }, ctx([brand('gen_a', 'A')], []));
    expect(out.why.factors.some((f) => /connected account/i.test(f.detail ?? ''))).toBe(true);
  });
});
