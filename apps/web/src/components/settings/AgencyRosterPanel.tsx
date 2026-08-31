'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { WhyPopover } from '@/components/explain/WhyPopover';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * THE AGENCY ROSTER — every brand, and which ones have gone quiet.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * `AgencyPanel` already listed the brands, because `genome.list` has been
 * org-scoped since P2. What it could not do is say anything *about* any of them:
 * every metrics read in the product takes a `genomeId`, so a roster could be a
 * directory and nothing more. An agency running forty clients opens this screen
 * to answer one question — which client has nobody posted for — and a directory
 * cannot answer it.
 *
 * `agency.roster` is the org-level roll-up that can. Aggregates keyed by brand,
 * never rows: a brand's content stays behind the genome predicate, and what
 * crosses to the org level is its volume and its outcome.
 *
 * ── Quiet first, and that ordering is the design ──────────────────────────
 *
 * The tool sorts quiet brands to the top and the screen keeps that order rather
 * than offering a column sort. A roster sorted by name is a directory; sorted by
 * silence it is a worklist. Putting the client nobody has posted for on page
 * three of an alphabetical list is how a roster stops being read.
 */

interface RosterBrand {
  genomeId: string;
  brandId: string;
  name: string;
  updatedAt: string;
  publishedCount: number;
  impressions: number;
  engagements: number;
  quiet: boolean;
}

interface Roster {
  windowDays: number;
  brands: RosterBrand[];
  totals: { brands: number; quiet: number; publishedCount: number; impressions: number; engagements: number };
  why: { summary: string; factors?: { label: string; detail?: string }[]; alternatives?: { option: string; rejectedBecause: string }[] };
}

const WINDOWS = [7, 30, 90] as const;

/** Thousands separated, and `—` for a brand with nothing to report rather than a bare 0. */
const num = (n: number) => (n === 0 ? '—' : n.toLocaleString('en'));

export function AgencyRosterPanel() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [data, setData] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void (async () => {
      const res = await invoke<Roster>('agency.roster', { windowDays });
      if (cancelled) return;
      if (res.status === 'succeeded') setData(res.output);
      else
        setError(
          res.status === 'failed'
            ? res.error.message
            : 'The roster is only visible to owners and admins of this workspace.',
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Every brand</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
            How much went out for each one, and how much came back. Quiet brands first.
          </p>
        </div>
        <div className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={windowDays === w}
              onClick={() => setWindowDays(w)}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] transition-colors',
                windowDays === w
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-ink-muted hover:bg-surface-muted',
              )}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="mt-4 text-[13px] text-ink-muted">{error}</p> : null}
      {data === null && !error ? <Skeleton className="mt-4 h-40 w-full rounded-lg" /> : null}

      {data ? (
        <>
          <p className="mt-4 text-[14px] text-ink">{data.why.summary}</p>
          <WhyPopover why={data.why} label="How this is counted" />

          {/* The org totals, so the header does not make the reader sum a column.
              Deliberately not a chart: five numbers do not need one, and the
              screen's job is to point at a row. */}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total label="Brands" value={String(data.totals.brands)} />
            <Total label="Quiet" value={String(data.totals.quiet)} tone={data.totals.quiet > 0 ? 'warn' : undefined} />
            <Total label="Posts out" value={num(data.totals.publishedCount)} />
            <Total label="Reactions" value={num(data.totals.engagements)} />
          </dl>

          {data.brands.length === 0 ? (
            <p className="mt-5 text-[13px] text-ink-muted">
              No brands yet. Add one from the roster below and it appears here.
            </p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Brand</th>
                    <th className="py-2 pr-3 font-medium">Posts out</th>
                    <th className="py-2 pr-3 font-medium">Reach</th>
                    <th className="py-2 pr-3 font-medium">Reactions</th>
                    <th className="py-2 font-medium">Last touched</th>
                  </tr>
                </thead>
                <tbody>
                  {data.brands.map((b) => (
                    <tr key={b.genomeId} className="border-b border-border/60">
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-ink">{b.name}</span>
                        {/*
                          The one label that matters on this screen. A zero in the
                          posts column is the same fact, but it reads as a data
                          gap; "quiet" reads as a state somebody should act on.
                        */}
                        {b.quiet ? (
                          <Badge className="mt-1 bg-warn/10 text-ink">Quiet</Badge>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-ink">{num(b.publishedCount)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-ink-muted">{num(b.impressions)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-ink-muted">{num(b.engagements)}</td>
                      <td className="py-2.5 text-ink-muted">
                        {new Date(b.updatedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/*
            Where to go from a quiet row. The roster diagnoses and the calendar is
            where it gets fixed, so the screen says so rather than leaving the
            reader to work out that they have to switch brands first.
          */}
          {data.totals.quiet > 0 ? (
            <p className="mt-4 text-[12px] text-ink-muted">
              A quiet brand usually needs either a campaign or a connected account. Switch to it with the
              brand picker, then open its <Link href="/calendar" className="underline underline-offset-2">calendar</Link>.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={cn('rounded-lg border p-3', tone === 'warn' ? 'border-warn/40 bg-warn/5' : 'border-border')}>
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
