'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * `DASH-A-01` — Account Home, PRD §8.3 and §8.13.
 *
 *   *"Account Home: manage multiple brands + access agency portal and billing.
 *   Brands list + agency portal tiles + billing/trainings/settings."*
 *
 * ── Why there was no org-level surface at all ─────────────────────────────
 *
 * Every screen in the product was brand-scoped, reached through the workspace
 * switcher. The multi-brand roster and billing lived inside *brand* settings
 * (`AgencyPanel`), which is the wrong place for them by one level: an agency
 * operator adding client #4 had to first pick client #3 in order to find the
 * button. There was no route above a brand, and `/` redirected past this into
 * the Command Center.
 *
 * ── The agency portal tiles, and what is honestly behind them ─────────────
 *
 * §8.13 lists a website wizard, a lead/job finder, and trainings, and then says
 * outright that its outputs are *"defined by separate PRD if deeper"*. There is
 * no specification to build those three against, and inventing them would be
 * inventing product, not implementing it. So they appear as what they are —
 * named, and marked as not yet built — rather than as buttons that open
 * something improvised. Billing, plan and the brand roster are real and link to
 * the tools that already back them.
 */

interface Brand {
  genomeId: string;
  brandId: string;
  name: string;
  updatedAt: string;
}

/**
 * `org.create`'s output — the org's own settings, upsert-on-read, which is what
 * `AgencyPanel` reads too.
 *
 * The *spent* half of billing is deliberately absent. There is no read tool for
 * the credit ledger: a balance only ever comes back from `org.credits.grant`,
 * and calling a grant in order to display a number would be spending money to
 * render a dashboard. So this tile shows the plan and its cap — which are facts
 * about the org — and links to settings for the rest.
 */
interface OrgSettings {
  plan: string;
  monthlyCapCents: number;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function AccountHome() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [org, setOrg] = useState<OrgSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, settings] = await Promise.all([
        invoke<{ genomes: Brand[] }>('genome.list', {}),
        // `org.create` is upsert-on-read — the same call `AgencyPanel` uses to
        // load org settings, not a write. A failure leaves the billing tile
        // showing its fallback rather than failing the roster beside it.
        invoke<OrgSettings>('org.create', {}),
      ]);
      if (cancelled) return;
      setBrands(list.status === 'succeeded' ? list.output.genomes : []);
      if (settings.status === 'succeeded') setOrg(settings.output);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[18px] font-semibold text-ink">Brands</h2>
          {brands ? (
            <p className="text-[13px] text-ink-muted">
              {brands.length} workspace{brands.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>

        {brands === null ? (
          <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        ) : brands.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-muted">
            No brands yet. Finish onboarding to create the first one.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => (
              <li key={b.genomeId}>
                {/* Every brand-scoped screen resolves the selected brand from
                    the switcher, so this links to the brand's own home rather
                    than carrying an id in the URL. */}
                <Link
                  href="/agents"
                  className="block rounded-lg border border-border p-4 transition-colors hover:bg-surface-muted"
                >
                  <span className="block text-[14px] font-medium text-ink">{b.name || 'Untitled brand'}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-muted">
                    Updated{' '}
                    {new Date(b.updatedAt).toLocaleDateString('en', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-surface p-5">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">Plan</p>
          {org ? (
            <>
              <p className="mt-1 text-[22px] font-medium capitalize text-ink">{org.plan}</p>
              <p className="mt-0.5 text-[12px] tabular-nums text-ink-muted">
                {money(org.monthlyCapCents)} a month
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-ink-muted">Plan and credits are in settings.</p>
          )}
          <Link
            href="/settings"
            className="mt-3 inline-block text-[13px] font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            Billing and plan
          </Link>
        </section>

        <PortalTile
          title="Website wizard"
          note="Build a client site from their brand genome."
        />
        <PortalTile title="Lead finder" note="Find businesses that need this service." />
        <PortalTile title="Trainings" note="How to run SPARK for clients." />
      </div>
    </div>
  );
}

/**
 * An agency-portal capability §8.13 names and does not specify.
 *
 * Marked plainly as not built. The alternative — a tile that opens a stub — is
 * how a roadmap item gets mistaken for a feature, and this codebase's own rule
 * for unconfigured vendor seams is the same: say so, never fabricate.
 */
function PortalTile({ title, note }: { title: string; note: string }) {
  return (
    <section className="rounded-xl border border-dashed border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <Badge variant="neutral">Not built</Badge>
      </div>
      <p className="mt-1 text-[12px] text-ink-muted">{note}</p>
      <p className="mt-2 text-[11px] text-ink-muted">
        Named in the PRD §8.13, which leaves its behaviour to a separate spec.
      </p>
    </section>
  );
}
