'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrganization } from '@clerk/nextjs';
import { toast } from 'sonner';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';

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
      <OrgName />

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
            Billing and usage for an organisation are visible to its owners and admins. Each brand&rsquo;s own
            settings open from that brand, on the brands page.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-18 font-semibold text-ink">What lives here</h2>
        <ul className="mt-[14px] flex flex-col gap-[10px]">
          <Row
            href="/organization/policies"
            title="Plan & policies"
            body="Your plan, and the approval, security and retention defaults every brand starts from."
          />
          <Row
            href="/organization/members"
            title="Members"
            body="Who is in this organisation, their role, and which brands each of them can reach."
          />
          <Row
            href="/organization/billing"
            title="Billing & Credits"
            body="The balance every brand draws on, what it has been spent on, and where to buy more."
          />
          <Row
            href="/organization/brands"
            title="Brands & budgets"
            body="Which brands are active, and a hard monthly limit per brand so one client cannot spend another's month."
          />
          <Row
            href="/organization/transfer"
            title="Move a brand"
            body="Take a brand to another account, or bring one in."
          />
          <Row
            href="/organization/audit"
            title="Audit log"
            body="Every recorded action across every brand, newest first."
          />
        </ul>
      </section>
    </div>
  );
}

/**
 * The organisation's name, and the one place it can be changed.
 *
 * It is typed once, in `OrgGuard`'s "Name your account", and there was no way
 * back to it — an agency that named its account after a founder could not
 * rename it. `org.rename` writes Clerk's record; `organization.reload()` then
 * refreshes the session's copy, so the account switcher on the brands page
 * reads the new name without a sign-out.
 */
function OrgName() {
  const { organization, isLoaded } = useOrganization();
  const current = organization?.name ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? current;
  const trimmed = value.trim();
  const dirty = draft !== null && trimmed !== current;

  async function save() {
    if (!dirty || !trimmed) return;
    setBusy(true);
    setError(null);
    const res = await invoke<{ name: string }>('org.rename', { name: trimmed });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(
        res.status === 'failed'
          ? userMessage(res.error)
          : 'Only an owner or admin can rename the organisation.',
      );
      return;
    }
    await organization?.reload();
    setDraft(null);
    toast.success(`Renamed to ${res.output.name}`);
  }

  return (
    <section>
      <h2 className="text-18 font-semibold text-ink">Name</h2>
      <p className="mt-[4px] max-w-[62ch] text-15 text-ink-muted">
        What the account is called — shown when you switch accounts and to everyone you invite.
      </p>
      <form
        className="mt-[14px] flex flex-wrap items-center gap-[12px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="sr-only" htmlFor="org-name">
          Organisation name
        </label>
        <input
          id="org-name"
          value={value}
          maxLength={80}
          disabled={!isLoaded || busy}
          placeholder={isLoaded ? 'Organisation name' : 'Loading…'}
          onChange={(e) => setDraft(e.target.value)}
          className="h-[48px] min-w-0 flex-1 basis-[260px] rounded-[10px] bg-white px-[16px] text-17 font-medium text-ink outline-none focus:shadow-[inset_0_0_0_1.4px_#838383] disabled:opacity-60"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
        />
        <button
          type="submit"
          disabled={!dirty || !trimmed || busy}
          className="h-[48px] rounded-[10px] bg-ink px-[22px] text-16 font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save name'}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-[8px] text-14 text-destructive">
          {error}
        </p>
      ) : null}
    </section>
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
