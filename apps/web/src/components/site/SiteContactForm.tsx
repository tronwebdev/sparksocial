'use client';

import { useActionState } from 'react';
import { Busy } from '@/components/brand/SparkLoader';

export interface SiteFormState {
  status: 'idle' | 'sent' | 'error';
  message?: string;
}

const FIELD =
  'h-[52px] w-full rounded-[12px] bg-white px-[16px] text-16 text-ink outline-none placeholder:text-ink-placeholder focus:shadow-[inset_0_0_0_1.5px_var(--site-primary)]';
const RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' };

/**
 * The agency website's contact form. Posts through a server action, so the
 * visitor's browser only ever talks to the page's own origin; the action calls
 * the API's public lead endpoint server-to-server. Works without JavaScript.
 */
export function SiteContactForm({
  action,
  ctaLabel,
}: {
  action: (prev: SiteFormState, form: FormData) => Promise<SiteFormState>;
  ctaLabel: string;
}) {
  const [state, submit, pending] = useActionState(action, { status: 'idle' });

  if (state.status === 'sent') {
    return (
      <div className="rounded-[16px] p-[28px]" style={{ background: 'rgba(19,215,17,0.08)', boxShadow: 'inset 0 0 0 1px rgba(19,167,17,0.3)' }}>
        <p className="text-20 font-semibold text-ink">Thanks — your message is in.</p>
        <p className="mt-[8px] text-16 text-ink-muted">We&rsquo;ll be in touch soon.</p>
      </div>
    );
  }

  return (
    <form action={submit} className="grid gap-[14px] rounded-[16px] bg-[#F7F8FA] p-[22px] sm:grid-cols-2">
      <label className="grid gap-[6px] text-14 font-medium text-ink">
        Your name
        <input name="name" required maxLength={200} autoComplete="name" className={FIELD} style={RING} />
      </label>
      <label className="grid gap-[6px] text-14 font-medium text-ink">
        Email
        <input name="email" type="email" required maxLength={320} autoComplete="email" className={FIELD} style={RING} />
      </label>
      <label className="grid gap-[6px] text-14 font-medium text-ink">
        Business
        <input name="company" maxLength={200} autoComplete="organization" className={FIELD} style={RING} />
      </label>
      <label className="grid gap-[6px] text-14 font-medium text-ink">
        Phone
        <input name="phone" type="tel" maxLength={50} autoComplete="tel" className={FIELD} style={RING} />
      </label>
      <label className="grid gap-[6px] text-14 font-medium text-ink sm:col-span-2">
        How can we help?
        <textarea
          name="message"
          maxLength={2000}
          rows={4}
          className="w-full resize-y rounded-[12px] bg-white px-[16px] py-[12px] text-16 text-ink outline-none"
          style={RING}
        />
      </label>
      {/* A field people never see. A bot that fills every input fills this too. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-[14px] sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-[52px] items-center rounded-[12px] px-[26px] text-16 font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: 'var(--site-primary)', color: 'var(--site-on-primary)' }}
        >
          {pending ? <Busy>Sending…</Busy> : ctaLabel}
        </button>
        {state.status === 'error' ? (
          <p role="alert" className="text-15 text-destructive">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
