'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { CreditUsageSection } from './CreditUsageSection';
import { userMessage } from '@/lib/errorCopy';

/**
 * Buying credits, and what has happened to the ones already bought.
 *
 * ── Why the purchase panel is above the usage one ────────────────────────
 *
 * Somebody arriving here has one of two questions, and they are not equally
 * urgent: "where did the money go" can be answered by scrolling, "I have run
 * out and need more" cannot. The usage breakdown is the existing screen,
 * unchanged, mounted underneath.
 *
 * ── Why nothing here grants anything ─────────────────────────────────────
 *
 * The button opens Stripe's hosted page and that is all it does. No card
 * number reaches this product at any point. Credits arrive when Stripe tells
 * the API they have, over a signed webhook — `stripe-webhook.ts` — because the
 * redirect back is a URL the customer's own browser follows and anyone can
 * type it.
 *
 * Which is why `?purchase=done` says "payment received" and not "credits
 * added", and why the balance below is re-read rather than assumed: the
 * webhook usually lands first, and occasionally does not.
 */

interface Pack {
  id: string;
  label: string;
  credits: number;
  priceCents: number;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export function BillingSection() {
  const params = useSearchParams();
  const purchase = params.get('purchase');

  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [currency, setCurrency] = useState('usd');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ currency: string; packs: Pack[] }>('org.credits.packs', {});
    if (res.status !== 'succeeded') {
      /*
       * Not an error state. `org.credits.packs` is registered only when Stripe
       * is configured, so a refusal here most often means "this deployment
       * does not sell credits yet" — which is a sentence, not a failure.
       */
      setPacks([]);
      return;
    }
    setPacks(res.output.packs);
    setCurrency(res.output.currency);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy(packId: string) {
    setBusy(packId);
    setError(null);
    const res = await invoke<{ url: string }>('org.credits.checkout', { packId }, crypto.randomUUID());
    if (res.status !== 'succeeded') {
      setBusy(null);
      setError(
        res.status === 'failed' ? userMessage(res.error) : 'Only an owner can buy credits for this organisation.',
      );
      return;
    }
    /*
     * A full navigation, not a new tab. Stripe's page is the next step of this
     * flow rather than a reference, and a popup is the thing browsers block.
     * `busy` is left set: this window is leaving.
     */
    window.location.href = res.output.url;
  }

  return (
    <div className="flex flex-col gap-[28px]">
      {purchase === 'done' ? (
        <p
          className="rounded-[10px] px-[18px] py-[14px] text-15"
          style={{ background: 'rgba(19,215,17,0.12)', color: '#0F8A0E' }}
        >
          Payment received. Credits are added when Stripe confirms it &mdash; usually within a few seconds. If the
          balance below has not moved, refresh in a moment.
        </p>
      ) : null}
      {purchase === 'cancelled' ? (
        <p
          className="rounded-[10px] px-[18px] py-[14px] text-15 text-ink-muted"
          style={{ background: 'rgba(131,131,131,0.1)' }}
        >
          Checkout cancelled. Nothing was charged.
        </p>
      ) : null}

      <section>
        <h2 className="text-18 font-semibold text-ink">Buy credits</h2>
        {packs === null ? (
          <p className="mt-[10px] text-15 text-ink-muted">Loading…</p>
        ) : packs.length === 0 ? (
          <p className="mt-[10px] max-w-[62ch] text-15 text-ink-muted">
            Card payments are not configured for this deployment, so credits cannot be bought here yet. An owner
            can still be granted credits directly.
          </p>
        ) : (
          <>
            <p className="mt-[6px] max-w-[62ch] text-15 text-ink-muted">
              Credits are shared by every brand in this organisation. Payment is handled by Stripe &mdash; no card
              details reach SparkSocial.
            </p>
            <ul className="mt-[16px] flex flex-wrap gap-[12px]">
              {packs.map((p) => (
                <li
                  key={p.id}
                  className="flex min-w-[200px] flex-1 flex-col gap-[10px] rounded-[12px] bg-white p-[18px] shadow-[0_0_0_1px_rgba(131,131,131,0.18)]"
                >
                  <span className="text-20 font-semibold text-ink">{p.credits.toLocaleString()}</span>
                  <span className="text-14 text-ink-muted">credits</span>
                  <span className="text-16 font-medium text-ink">{money(p.priceCents, currency)}</span>
                  <Button className="mt-[4px]" disabled={busy !== null} onClick={() => void buy(p.id)}>
                    {busy === p.id ? 'Opening Stripe…' : 'Buy'}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error ? <p className="mt-[12px] text-14 text-destructive">{error}</p> : null}
      </section>

      {/*
        The existing Credit & Usage screen, unchanged and unmoved in code — it
        was always reading org-scoped data, it was simply filed under a brand.
      */}
      <section>
        <h2 className="text-18 font-semibold text-ink">Usage this month</h2>
        <div className="mt-[14px]">
          <CreditUsageSection />
        </div>
      </section>
    </div>
  );
}
