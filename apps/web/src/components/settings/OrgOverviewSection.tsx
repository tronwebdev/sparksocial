'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { invoke } from '@/lib/tools';

/**
 * The organisation, as a page rather than as an assumption.
 *
 * ── What it is answering ─────────────────────────────────────────────────
 *
 * "Account Settings" on the brands page opened `/settings`, which is one
 * *brand's* settings. The two had been conflated because there was no third
 * scope: the prototype draws `Settings PS *` for a person and `Settings WS *`
 * for a workspace, and nothing for the organisation that owns both — even
 * though the plan, the credit balance and the audit trail are all org-scoped
 * in the stores that hold them.
 *
 * So this is deliberately thin. It is the landing page of a scope, not a pile
 * of settings invented to justify one: the facts about the organisation, and
 * the way through to the three things it actually owns.
 */

interface Usage {
  plan?: string;
  remainingCents: number;
  monthlyCapCents: number;
  spentCents: number;
}

export function OrgOverviewSection() {
  const [brands, setBrands] = useState<number | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, use, org] = await Promise.all([
        invoke<{ genomes: Array<{ brandId: string }> }>('genome.list', {}),
        invoke<Usage>('org.usage.get', {}),
        invoke<{ plan: string }>('org.create', {}),
      ]);
      if (cancelled) return;

      if (list.status === 'succeeded') {
        // Brands, not genomes — a brand can hold more than one.
        setBrands(new Set(list.output.genomes.map((g) => g.brandId)).size);
      }
      if (use.status === 'succeeded') setUsage(use.output);
      if (org.status === 'succeeded') setPlan(org.output.plan);

      /*
       * `org.usage.get` and `org.create` are both owner/admin. A refusal is
       * not an error here — it is a member looking at a page that is mostly
       * not theirs — so it shows nothing rather than an alarming message.
       */
      setRefused(use.status !== 'succeeded' && org.status !== 'succeeded');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex flex-col gap-[28px]">
      <section>
        <h2 className="text-18 font-semibold text-ink">This organisation</h2>
        <dl className="mt-[14px] flex flex-wrap gap-[12px]">
          <Fact label="Plan" value={plan ? plan.replace(/^\w/, (c) => c.toUpperCase()) : '—'} />
          <Fact label="Brands" value={brands === null ? '—' : String(brands)} />
          <Fact
            label="Credit left this month"
            value={usage ? money(usage.remainingCents) : '—'}
          />
          <Fact label="Monthly cap" value={usage ? money(usage.monthlyCapCents) : '—'} />
        </dl>
        {refused ? (
          <p className="mt-[12px] max-w-[62ch] text-15 text-ink-muted">
            Billing and usage for an organisation are visible to its owners and admins. Your own settings are
            under Personal, and the brands you work on are under Brand.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-18 font-semibold text-ink">What lives here</h2>
        <ul className="mt-[14px] flex flex-col gap-[10px]">
          <Row
            href="/settings/org/billing"
            title="Billing & Credits"
            body="The balance every brand draws on, what it has been spent on, and where to buy more."
          />
          <Row
            href="/settings/org/brands"
            title="Brand budgets"
            body="A hard monthly limit per brand, so one client cannot spend another client's month."
          />
          <Row
            href="/settings/org/audit"
            title="Audit log"
            body="Every recorded action across every brand, newest first."
          />
        </ul>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[160px] flex-1 rounded-[12px] p-[16px]" style={{ background: 'rgba(131,131,131,0.06)' }}>
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className="mt-[6px] text-20 font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Row({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-[12px] bg-white p-[16px] shadow-[0_0_0_1px_rgba(131,131,131,0.18)] transition-colors hover:bg-[#FAFAFA]"
      >
        <span className="block text-16 font-semibold text-ink">{title}</span>
        <span className="mt-[4px] block max-w-[62ch] text-14 text-ink-muted">{body}</span>
      </Link>
    </li>
  );
}
