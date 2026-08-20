import Link from 'next/link';
import { BrandPanel } from '@/components/auth/BrandPanel';
import { Button } from '@/components/ui/button';

/**
 * `AUTH-01` — "Start Trial / Get Started (from pricing plan)", PRD §8.1.
 *
 *   *"Users enter via pricing/plan selection and create an organization account.
 *   Inputs/Config: Selected plan (trial vs paid)."*
 *
 * ── Why this route exists ─────────────────────────────────────────────────
 *
 * There was no pricing entry at all, so the plan a person chose before signing
 * up was never carried into the account they created. §8.1 lists it as an input
 * to authentication and `org.billing.plan.set` has always accepted the three
 * plans — the two ends existed and nothing joined them.
 *
 * The plan travels as a query parameter to sign-up, which forwards it to the
 * org's first `org.billing.plan.set` call once a session exists. It is a
 * *preference*, not an entitlement: nothing here charges anybody, and the
 * backend re-validates the plan name against its own enum, so a hand-edited URL
 * selects a plan the org is then billed for normally rather than granting
 * anything.
 *
 * The prices are the three plan tiers `org.billing.plan.set` already accepts.
 * They carry no monetary figures, because none exist in the PRD or in the code
 * and inventing them here would put a number in front of a customer that no
 * part of the system agrees with.
 */

interface PlanCard {
  /** Matches `Plan` in `packages/agency/src/org.ts` — the enum the backend validates against. */
  id: 'starter' | 'growth' | 'agency';
  name: string;
  who: string;
  features: string[];
  featured?: boolean;
}

const PLANS: PlanCard[] = [
  {
    id: 'starter',
    name: 'Starter',
    who: 'One brand, run by the person who owns it.',
    features: ['One brand workspace', 'SPARK plans and posts for you', 'Review before publishing, or not'],
  },
  {
    id: 'growth',
    name: 'Growth',
    who: 'A brand that has outgrown posting by hand.',
    features: ['Everything in Starter', 'Trend discovery and repurposing', 'Automation recipes', 'Engagement intelligence'],
    featured: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    who: 'Running social for other people.',
    features: ['Everything in Growth', 'Unlimited brand workspaces', 'Teams, roles and approvals', 'White-label review links'],
  },
];

export default function PricingPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr]">
      <BrandPanel />

      <main className="flex items-center justify-center bg-bg p-8">
        <div className="w-full max-w-4xl">
          <header className="text-center">
            <h1 className="text-[28px] font-medium tracking-tight text-ink">Pick where to start</h1>
            <p className="mx-auto mt-2 max-w-prose text-[15px] text-ink-muted">
              Every plan starts as a trial. You can move between them later without losing anything.
            </p>
          </header>

          <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => (
              <li
                key={plan.id}
                className={
                  plan.featured
                    ? 'flex flex-col rounded-xl border-2 border-primary bg-surface p-6'
                    : 'flex flex-col rounded-xl border border-border bg-surface p-6'
                }
              >
                <h2 className="text-[18px] font-semibold text-ink">{plan.name}</h2>
                <p className="mt-1 text-[13px] text-ink-muted">{plan.who}</p>

                <ul className="mt-4 grid flex-1 grid-cols-1 gap-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="text-[13px] text-ink-muted">
                      {f}
                    </li>
                  ))}
                </ul>

                <Button asChild className="mt-5" variant={plan.featured ? 'primary' : 'outline'}>
                  {/* The selected plan travels to sign-up, which applies it to the
                      org once a session exists. */}
                  <Link href={`/sign-up?plan=${plan.id}`}>Start a trial</Link>
                </Button>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-center text-[14px] text-ink-muted">
            Already have an account?{' '}
            <Link
              href="/sign-in"
              className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
