'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * The Agency Portal — plan §6.9, §12 P6. Org-level plan/governance/SSO and
 * the multi-brand roster, in one panel: `org.create` doubles as the read
 * ("what plan are we on") since no separate `org.settings.get` exists — see
 * that tool's own comment — `org.billing.plan.set`/`org.governance.set`/
 * `org.security.sso.configure` write the three governance fields, and
 * `genome.list` (already org-scoped, already the brand switcher's source) is
 * the brand roster; `brand.create` adds to it.
 */

type Plan = 'starter' | 'growth' | 'agency';

interface OrgSettings {
  plan: Plan;
  defaultApprovalMode: string;
  ssoRequired: boolean;
  monthlyCapCents: number;
}

interface BrandRow {
  genomeId: string;
  brandId: string;
  name: string;
  updatedAt: string;
}

interface CreditsBalance {
  monthlyCapCents: number;
  spentCents: number;
}

const PLAN_LABEL: Record<Plan, string> = { starter: 'Starter', growth: 'Growth', agency: 'Agency' };

export function AgencyPanel() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNewBrand, setShowNewBrand] = useState(false);
  const [balance, setBalance] = useState<CreditsBalance | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [settingsRes, brandsRes] = await Promise.all([
      invoke<OrgSettings>('org.create', {}),
      invoke<{ genomes: BrandRow[] }>('genome.list', {}),
    ]);
    if (settingsRes.status === 'succeeded') setSettings(settingsRes.output);
    else setError(settingsRes.status === 'failed' ? settingsRes.error.message : 'That request was gated.');
    if (brandsRes.status === 'succeeded') setBrands(brandsRes.output.genomes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changePlan(plan: Plan) {
    if (busy) return;
    setBusy(true);
    const res = await invoke<OrgSettings>('org.billing.plan.set', { plan });
    setBusy(false);
    if (res.status === 'succeeded') setSettings(res.output);
  }

  async function changeGovernance(defaultApprovalMode: string) {
    if (busy) return;
    setBusy(true);
    const res = await invoke<OrgSettings>('org.governance.set', { defaultApprovalMode });
    setBusy(false);
    if (res.status === 'succeeded') setSettings(res.output);
  }

  async function toggleSso() {
    if (busy || !settings) return;
    setBusy(true);
    const res = await invoke<OrgSettings>('org.security.sso.configure', { required: !settings.ssoRequired });
    setBusy(false);
    if (res.status === 'succeeded') setSettings(res.output);
  }

  if (settings === null || brands === null) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Agency</h2>
      <p className="mt-1 text-[14px] text-ink-muted">Org plan, governance defaults, and every brand under this workspace.</p>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="text-[13px] font-medium text-ink-muted">Plan</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['starter', 'growth', 'agency'] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => void changePlan(p)}
                className={`rounded-full border px-3 py-1.5 text-[13px] disabled:opacity-50 ${
                  settings.plan === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface-muted'
                }`}
              >
                {PLAN_LABEL[p]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">Spend cap: ${(settings.monthlyCapCents / 100).toLocaleString()} / month</p>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="text-[13px] font-medium text-ink-muted">New brands start on</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['autopublish', 'review_first_week', 'review_everything'] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => void changeGovernance(m)}
                className={`rounded-full border px-3 py-1.5 text-[12px] capitalize disabled:opacity-50 ${
                  settings.defaultApprovalMode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface-muted'
                }`}
              >
                {m.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={settings.ssoRequired} disabled={busy} onChange={() => void toggleSso()} />
            Require SSO
          </label>
          {settings.ssoRequired ? (
            <p className="mt-1 text-[12px] text-ink-muted">This is a policy flag only — the actual SSO connection is set up in the Clerk dashboard.</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <CreditsCard cap={settings.monthlyCapCents} balance={balance} onGranted={setBalance} />
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-ink-muted">Brands ({brands.length})</p>
          <Button size="sm" variant="outline" onClick={() => setShowNewBrand((s) => !s)}>
            {showNewBrand ? 'Cancel' : 'Add brand'}
          </Button>
        </div>

        {showNewBrand ? (
          <NewBrandForm
            onCreated={() => {
              setShowNewBrand(false);
              void load();
            }}
          />
        ) : null}

        {brands.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-muted">No brands yet.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2">
            {brands.map((b) => (
              <li key={b.genomeId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">{b.name || 'Untitled brand'}</p>
                  <p className="text-[12px] text-ink-muted">
                    Updated {new Date(b.updatedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Badge variant="neutral" className="hidden shrink-0 sm:inline-flex">{b.brandId}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CreditsCard({
  cap,
  balance,
  onGranted,
}: {
  cap: number;
  balance: CreditsBalance | null;
  onGranted: (b: CreditsBalance) => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents <= 0 || !reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    // idempotent: false — a retried grant must not double the credit.
    const res = await invoke<{ granted: true; balance: CreditsBalance }>(
      'org.credits.grant',
      { amountCents: cents, reason },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onGranted(res.output.balance);
    setAmount('');
    setReason('');
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-[13px] font-medium text-ink-muted">Credits</p>
      {balance ? (
        <p className="mt-1 text-[14px] text-ink">
          ${(balance.spentCents / 100).toFixed(2)} spent of ${(balance.monthlyCapCents / 100).toLocaleString()} this month
        </p>
      ) : (
        <p className="mt-1 text-[12px] text-ink-muted">Cap: ${(cap / 100).toLocaleString()}/month. Grant a credit to see the current balance.</p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">Amount ($)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50.00"
            inputMode="decimal"
            className="h-9 w-28 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 flex-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">Reason</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Goodwill credit for a slow month"
            className="h-9 w-full rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <Button size="sm" variant="outline" disabled={busy || !amount || !reason.trim()} onClick={() => void grant()}>
          {busy ? 'Granting…' : 'Grant'}
        </Button>
      </div>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

function NewBrandForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !category.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await invoke('brand.create', { name, category }, crypto.randomUUID());
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onCreated();
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-border bg-surface-muted p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Brand name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Client name"
          className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
        />
      </div>
      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Category</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Barbershop"
          className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
        />
      </div>
      <Button size="sm" disabled={busy || !name.trim() || !category.trim()} onClick={() => void create()}>
        {busy ? 'Creating…' : 'Create'}
      </Button>
      {error ? <p className="text-[13px] text-destructive sm:col-span-3">{error}</p> : null}
    </div>
  );
}
