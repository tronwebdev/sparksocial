'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { invoke } from '@/lib/tools';

const PLAN_LABEL: Record<string, string> = {
  starter: 'Starter Plan',
  growth: 'Growth Plan',
  agency: 'Agency Plan',
};

/**
 * The pinned plan card — `SparkSocial Dashboard.dc.html`, 282×77 at
 * `left:21 top:1023`, i.e. bottom-anchored, which is what it becomes here.
 *
 * Rebuilt against the prototype, which has more in it than the version this
 * replaces: a 57px avatar with an online tick badged onto it, "Pro Plan" at
 * 18px/600, and the credits as a 112×26 pill on `#DCF2F6` in `#838383` — not a
 * shared `Badge`, whose fill is a different blue. The card itself has no
 * background at all, just a `rgba(131,131,131,0.2)` hairline ring; it was
 * filled with `surface-muted`, which reads as a pressed state next to the
 * transparent nav above it.
 *
 * "Renews monthly" is gone. The prototype's second line is the credits pill,
 * and the card is 77px tall — three lines do not fit without shrinking the type
 * below what the design uses.
 *
 * ── The numbers are real now ─────────────────────────────────────────────
 *
 * This used to read "Credits are still a placeholder until the credit ledger
 * exists (plan §9, P3). Wiring a real number now would mean inventing a source
 * for it, and this is a bad place to be approximately right about money." That
 * was the right call and it has expired: the ledger exists, `org.usage.get`
 * reports against it, and `/settings/credits` has been showing real spend for
 * some time. So the card was no longer declining to invent a number — it was
 * showing an invented one, 1,200 credits and a "Pro Plan" that is not even one
 * of the three tiers the schema has (`starter`, `growth`, `agency`), in the one
 * place a person glances at to see what is left.
 *
 * ── Why it can show nothing ──────────────────────────────────────────────
 *
 * Both reads are `scopes: ['owner', 'admin']`, deliberately — spend is
 * commercial information about the organisation, and an agency's client has no
 * business reading what the agency pays per video. The rail renders for every
 * role, so an editor or a viewer gets the avatar and no numbers. That is the
 * honest degradation: an empty slot says "not yours to see", where a fallback
 * number would say something false to exactly the people who cannot check it.
 *
 * One call, not two: `org.create` with no argument is the documented read for
 * "what plan is this org on", and it is what the Agency Portal already uses.
 *
 * ── The avatar is the person's ───────────────────────────────────────────
 *
 * It was the prototype's memoji for everyone, so a photo set on the profile
 * page never appeared here. It is Clerk's `imageUrl` now — the same image the
 * brands page's chip shows — with the memoji kept for an account that has never
 * set one. Clerk's user resource is shared, so an upload re-renders this too.
 *
 * And the chevron finally goes somewhere: the card is the plan and the balance,
 * so it opens the organisation's Billing & Credits.
 */
export function PlanCard() {
  const { user } = useUser();
  const [plan, setPlan] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      /*
       * Settled, not awaited in sequence: a viewer is refused both, and the
       * plan being readable while the balance is not (or the reverse) should
       * still show whichever half came back.
       */
      const [planRes, usageRes] = await Promise.all([
        invoke<{ plan: string }>('org.create', {}),
        invoke<{ remainingCredits: number }>('org.usage.get', {}),
      ]);
      if (planRes.status === 'succeeded') setPlan(planRes.output.plan);
      if (usageRes.status === 'succeeded') setCredits(usageRes.output.remainingCredits);
    })();
  }, []);

  return (
    <Link
      href="/organization/billing"
      aria-label="Plan and credits"
      className="mx-[21px] mb-6 block h-[77px] rounded-md transition-colors hover:bg-[rgba(131,131,131,0.05)] max-xl:hidden"
      style={{ boxShadow: '0 0 0 1px rgba(131,131,131,0.2)' }}
    >
      <div className="relative h-full">
        <span className="absolute left-3 top-[10px] block h-[57px] w-[57px]">
          <span
            className="block h-full w-full rounded-full"
            style={{
              background: `#F8F8F8 url('${user?.imageUrl && user.hasImage ? user.imageUrl : '/dashboard/pro-memoji.png'}') center / cover no-repeat`,
              boxShadow: 'inset 0 0 0 1.44px rgba(120,120,120,0.28)',
            }}
          />
          {/* The 17px tick, badged onto the avatar's lower right. */}
          <span
            className="absolute left-[28px] top-[26px] flex h-[17px] w-[17px] items-center justify-center rounded-full"
            style={{ background: '#13D711' }}
          >
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden>
              <path d="m1 3.5 2.3 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>

        <span className="absolute left-[85px] top-[11px] text-18 font-semibold leading-[1.28] text-ink">
          {plan ? (PLAN_LABEL[plan] ?? `${plan} Plan`) : 'Plan'}
        </span>

        {credits === null ? null : (
          <span
            className="absolute left-[85px] top-[39px] flex h-[26px] min-w-[112px] items-center rounded px-[9px] text-14 font-semibold"
            style={{ background: '#DCF2F6', color: '#838383' }}
          >
            {credits.toLocaleString()} credits
          </span>
        )}

        <svg
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="none"
          aria-hidden
          className="absolute left-[262px] top-[27px] block"
        >
          <path d="m1 1 5.5 6L1 13" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Link>
  );
}
