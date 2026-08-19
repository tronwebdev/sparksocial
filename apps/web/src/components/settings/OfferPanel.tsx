'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `genome.offer.set` — nothing in onboarding or the crawl ever asks for a
 * call-to-action, so `offer.primary_cta` sat at its schema default (`''`)
 * forever. Fourteen playbook `cta` beats source it directly
 * (`source: 'genome:offer.primary_cta'`, `packages/playbooks/src/records.ts`)
 * — not written by SPARK, pulled verbatim from what the business actually
 * says — so every one of those beats threw NOT_FOUND ("The genome has no
 * value at 'offer.primary_cta'") with no screen anywhere to fix it. This is
 * that screen.
 *
 * Set-only like `AvatarConfigPanel`: no tool currently returns a genome's
 * current offer, so this can record a change but not display what's active.
 */
export function OfferPanel() {
  const { genome } = useSelectedGenome();
  const [primaryCta, setPrimaryCta] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save() {
    if (!genome || !primaryCta.trim()) return;
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ genomeId: string; version: number }>('genome.offer.set', {
      genomeId: genome.genomeId,
      offer: { primary_cta: primaryCta.trim() },
    });
    setBusy(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: 'Saved.' });
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Offer</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        What you're actually asking someone to do — "Book now", "Try it free", "Call today". Most video and
        carousel posts end on this, in your own words, not a generated one.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-1 sm:max-w-sm">
        <label className="text-[12px] font-medium text-ink-muted" htmlFor="primary-cta">
          Primary call-to-action
        </label>
        <input
          id="primary-cta"
          value={primaryCta}
          onChange={(e) => setPrimaryCta(e.target.value)}
          placeholder="e.g. Book your appointment today"
          className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={busy || !genome || !primaryCta.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {message ? (
          <span className={`text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
