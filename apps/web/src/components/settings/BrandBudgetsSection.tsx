'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';

/**
 * One hard monthly limit per brand.
 *
 * ── What it is for ───────────────────────────────────────────────────────
 *
 * `credit_ledger` has carried `brand_id` on every row since it was written, so
 * an agency could always see which client had eaten the month. It could not
 * stop the next one: the only ceiling was the organisation's, and the first
 * brand to spend it spent everybody's.
 *
 * ── Hard, and what that costs ────────────────────────────────────────────
 *
 * A brand that reaches its limit stops. Its agent refuses to draft, render or
 * publish until the month turns or the number goes up — `policy.ts` denies the
 * call with `budget.brand_exceeded`, the same way it denies one that would
 * cross the org's cap.
 *
 * That is deliberate and it is stated on the screen, because the failure mode
 * is quiet: a capped brand does not announce itself, it simply stops posting.
 * Somebody setting one of these should know that before they do, not at 3am
 * when a campaign goes silent.
 *
 * ── No limit is the default, and clearing one is not setting zero ────────
 *
 * A brand with no row is bounded only by the organisation, which is every
 * brand until somebody decides otherwise. Zero is a different instruction —
 * "this brand spends nothing" — and the two stay distinguishable from this
 * form down to the column, because a Clear button that wrote zero would freeze
 * the brand it was meant to free.
 */

interface Brand {
  genomeId: string;
  brandId: string;
  name: string;
}

interface Cap {
  brandId: string;
  monthlyCapCents: number;
  spentCents: number;
  remainingCents: number;
  exhausted: boolean;
}

const pounds = (cents: number) => (cents / 100).toFixed(2);

export function BrandBudgetsSection() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [caps, setCaps] = useState<Map<string, Cap>>(new Map());
  /** Per brand, what is typed in the box — kept apart from what is stored. */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, budgets] = await Promise.all([
      invoke<{ genomes: Brand[] }>('genome.list', {}),
      invoke<{ brands: Cap[] }>('brand.budget.list', {}),
    ]);

    if (list.status !== 'succeeded') {
      setError(list.status === 'failed' ? userMessage(list.error) : 'You cannot read this organisation.');
      setBrands([]);
      return;
    }

    /*
     * One row per *brand*, not per genome. A brand can hold more than one
     * genome and the cap is on the brand, so listing genomes would show the
     * same limit twice under two names and let somebody set it in one place
     * and wonder why it changed in the other.
     */
    const seen = new Set<string>();
    const unique = list.output.genomes.filter((g) => {
      if (seen.has(g.brandId)) return false;
      seen.add(g.brandId);
      return true;
    });
    setBrands(unique);

    if (budgets.status === 'succeeded') {
      setCaps(new Map(budgets.output.brands.map((b) => [b.brandId, b])));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(brandId: string, cents: number | null) {
    setBusy(brandId);
    setError(null);
    const res = await invoke<{ brandId: string }>(
      'brand.budget.set',
      { brandId, monthlyCapCents: cents },
      crypto.randomUUID(),
    );
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(
        res.status === 'failed'
          ? userMessage(res.error)
          : 'Only an owner can set a spending limit.',
      );
      return;
    }
    // Re-read rather than patch local state: the spend figure moves on its own
    // and a screen that computed it from what was just typed would drift.
    setDrafts((d) => {
      const next = new Map(d);
      next.delete(brandId);
      return next;
    });
    await load();
  }

  if (brands === null) return <p className="text-16 text-ink-muted">Loading…</p>;

  if (brands.length === 0) {
    return <p className="text-16 text-ink-muted">{error ?? 'This organisation has no brands yet.'}</p>;
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <p className="max-w-[72ch] text-15 text-ink-muted">
        A limit here is <b className="font-semibold text-ink">hard</b>. When a brand reaches it, its agent stops
        drafting, rendering and publishing until the month turns or you raise the number &mdash; it does not warn
        and continue. Brands with no limit are bounded only by the organisation&rsquo;s monthly cap.
      </p>

      <ul className="flex flex-col gap-[12px]">
        {brands.map((b) => {
          const cap = caps.get(b.brandId);
          const draft = drafts.get(b.brandId);
          const shown = draft ?? (cap ? String(cap.monthlyCapCents / 100) : '');
          const used = cap && cap.monthlyCapCents > 0 ? Math.min(1, cap.spentCents / cap.monthlyCapCents) : 0;

          return (
            <li key={b.brandId} className="rounded-[12px] bg-white p-[16px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)]">
              <div className="flex flex-wrap items-end justify-between gap-[14px]">
                <div className="min-w-[180px] flex-1">
                  <p className="text-16 font-semibold text-ink">{b.name}</p>
                  {cap ? (
                    <p className="mt-[4px] text-13 text-ink-muted">
                      {pounds(cap.spentCents)} of {pounds(cap.monthlyCapCents)} spent this month
                      {cap.exhausted ? (
                        <b className="ml-[6px] font-semibold text-destructive">&mdash; stopped</b>
                      ) : null}
                    </p>
                  ) : (
                    <p className="mt-[4px] text-13 text-ink-muted">No limit &mdash; uses the organisation&rsquo;s cap.</p>
                  )}

                  {cap ? (
                    <div
                      aria-hidden
                      className="mt-[8px] h-[6px] w-full overflow-hidden rounded-full"
                      style={{ background: 'rgba(131,131,131,0.2)' }}
                    >
                      <div
                        className="h-full rounded-full transition-[width]"
                        style={{
                          width: `${Math.round(used * 100)}%`,
                          background: cap.exhausted ? 'var(--ss-destructive, #F35525)' : 'var(--ss-purple)',
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex items-end gap-[10px]">
                  <label className="grid gap-[6px]">
                    <span className="text-13 font-medium text-ink">Monthly limit</span>
                    <Input
                      value={shown}
                      inputMode="decimal"
                      placeholder="No limit"
                      aria-label={`Monthly limit for ${b.name}`}
                      onChange={(e) =>
                        setDrafts((d) => new Map(d).set(b.brandId, e.target.value))
                      }
                      className="w-[140px]"
                    />
                  </label>
                  <Button
                    size="sm"
                    disabled={busy === b.brandId || draft === undefined}
                    onClick={() => {
                      const n = Number(draft);
                      if (!Number.isFinite(n) || n < 0) {
                        setError('A limit has to be a number, or empty to remove it.');
                        return;
                      }
                      // Empty box means "no limit" — null, never zero.
                      void save(b.brandId, draft?.trim() === '' ? null : Math.round(n * 100));
                    }}
                  >
                    {busy === b.brandId ? 'Saving…' : 'Save'}
                  </Button>
                  {cap ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === b.brandId}
                      onClick={() => void save(b.brandId, null)}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error ? <p className="text-14 text-destructive">{error}</p> : null}
    </div>
  );
}
