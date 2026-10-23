import Stripe from 'stripe';
import { creditsToCents } from '@sparksocial/shared/credits';

/**
 * Buying credits, through Stripe's hosted checkout.
 *
 * ── Why hosted checkout and not our own form ─────────────────────────────
 *
 * No card number ever reaches this process. `org.credits.checkout` creates a
 * session and hands back a URL on `checkout.stripe.com`; the customer types
 * their card into Stripe's page, and we learn what happened from a signed
 * webhook. That is the difference between "we take payments" and "we are in
 * PCI scope", and it is worth the redirect.
 *
 * It is also why the rule in this repo about never entering card details holds
 * without an exception: there is nowhere in this product to enter one.
 *
 * ── Why the official SDK ─────────────────────────────────────────────────
 *
 * Every other vendor here is a hand-written `fetch` client — `fal`,
 * Higgsfield — and that is the right default: a few endpoints, no state, and
 * the dependency is not worth it. Stripe is the exception for one reason:
 * `constructEvent` verifies the webhook signature, and a hand-rolled HMAC with
 * a timestamp tolerance and a constant-time compare is the kind of code that
 * works in testing and is wrong in a way nobody notices. A mistake there means
 * anyone who can reach the endpoint can grant themselves credits.
 *
 * ── Configuration ────────────────────────────────────────────────────────
 *
 * `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Absent means absent: the
 * tool is not registered and the webhook route does not exist, per CLAUDE.md's
 * rule about unconfigured keys. A checkout button that 500s reads to a
 * customer as "the product is broken"; a button that is not there reads as
 * "this is not set up", which is the truth.
 */

/**
 * What a customer can buy, in credits.
 *
 * Fixed packs rather than an arbitrary amount, because an arbitrary amount
 * needs a price object per purchase and a minimum nobody has decided. These
 * are `price_data` built inline, so no Stripe dashboard Price has to exist and
 * match — one less pair of numbers that can disagree.
 */
export const CREDIT_PACKS = [
  { id: 'starter', credits: 2_500, label: '2,500 credits' },
  { id: 'growth', credits: 10_000, label: '10,000 credits' },
  { id: 'scale', credits: 50_000, label: '50,000 credits' },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]['id'];

export const packById = (id: string) => CREDIT_PACKS.find((p) => p.id === id);

/**
 * What a pack costs, in the smallest currency unit.
 *
 * `creditsToCents` from shared rather than a local rate. The rate is a pricing
 * decision and a second copy of it here is a number that can disagree with the
 * one the ledger spends against — which would mean selling credits at one
 * price and consuming them at another, discovered at a reconciliation.
 */
export const packPriceCents = (credits: number) => creditsToCents(credits);

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Where Stripe sends the customer back to. The web app's own origin. */
  returnUrl: string;
  /** ISO 4217, lowercase. Stripe rejects a currency the account cannot settle. */
  currency: string;
}

/**
 * Null when unconfigured, which the caller is expected to branch on rather
 * than defend against — see the configuration note above.
 */
export function readStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !webhookSecret) return null;
  return {
    secretKey,
    webhookSecret,
    returnUrl: env.WEB_ORIGIN?.trim() || 'http://localhost:3000',
    currency: (env.STRIPE_CURRENCY?.trim() || 'usd').toLowerCase(),
  };
}

export function stripeClient(config: StripeConfig): Stripe {
  return new Stripe(config.secretKey, {
    /*
     * Pinned. Stripe's API is versioned per account *and* per request, and an
     * account whose default version moves would otherwise change the shape of
     * the webhook payloads this code reads without a deploy. The version a
     * payload is parsed by should be a decision in a diff.
     */
    apiVersion: '2025-08-27.basil',
    appInfo: { name: 'SparkSocial' },
  });
}

/** A pack as the tool hands it back — widened from the literal table. */
export interface CreditPack {
  id: string;
  credits: number;
  label: string;
}

export interface CheckoutArgs {
  orgId: string;
  pack: CreditPack;
  /** Who pressed the button, for the Stripe dashboard's own record. */
  userId?: string;
}

/**
 * One hosted checkout session.
 *
 * `client_reference_id` and `metadata.orgId` both carry the organisation: the
 * first is what Stripe shows in its dashboard, the second is what the webhook
 * reads. They are written together so a payment can always be traced back to
 * an org from either side, which matters the first time one of these has to be
 * reconciled by hand.
 */
export async function createCheckoutSession(
  stripe: Stripe,
  config: StripeConfig,
  args: CheckoutArgs,
): Promise<{ url: string; sessionId: string }> {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: args.orgId,
    metadata: {
      orgId: args.orgId,
      packId: args.pack.id,
      credits: String(args.pack.credits),
      ...(args.userId ? { userId: args.userId } : {}),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: config.currency,
          unit_amount: packPriceCents(args.pack.credits),
          product_data: {
            name: `SparkSocial — ${args.pack.label}`,
            description: 'Credits for generation, rendering and publishing.',
          },
        },
      },
    ],
    success_url: `${config.returnUrl}/settings/org/billing?purchase=done&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.returnUrl}/settings/org/billing?purchase=cancelled`,
  });

  if (!session.url) {
    // Stripe returns a session without a URL only in modes this does not use.
    // Saying so beats handing the caller an empty string to redirect to.
    throw new Error('Stripe created a session with no checkout URL.');
  }
  return { url: session.url, sessionId: session.id };
}
