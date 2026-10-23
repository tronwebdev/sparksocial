import type { Hono } from 'hono';
import type Stripe from 'stripe';
import type { CreditStore } from '@sparksocial/tools';
import { creditsToCents } from '@sparksocial/shared/credits';
import { packById, type StripeConfig } from './stripe-client.js';

/**
 * STRIPE'S WEBHOOK — where a payment becomes a balance.
 *
 * `org.credits.checkout` sends somebody to Stripe's hosted page. Nothing comes
 * back through the browser that can be trusted: the success redirect is a URL
 * the customer's own browser follows, and anyone can type it. This endpoint is
 * the only thing that grants credits, and the signature is the only thing
 * between it and anyone on the internet granting themselves some.
 *
 * ── The three things that are easy to get wrong here ──────────────────────
 *
 * 1. **The raw bytes.** The signature is an HMAC over exactly what Stripe
 *    sent. Parsing to JSON and re-serialising changes whitespace and key
 *    order, the signature stops matching, and the temptation becomes to skip
 *    the check. `c.req.text()` first, and `constructEvent` parses.
 *
 * 2. **Redelivery.** Stripe retries until it gets a 2xx — for days. A blip
 *    between granting the credits and answering turns one purchase into two
 *    balances. The grant carries the session id as `externalRef`, which has a
 *    unique index, so the second delivery is dropped by the database rather
 *    than by anyone remembering. And it must still answer 2xx, or Stripe keeps
 *    trying forever.
 *
 * 3. **What to believe.** The amount granted comes from the *session*, read
 *    back from Stripe's own event, never from anything the client sent. The
 *    pack id in metadata is checked against the server's own table; a session
 *    naming a pack we do not sell is ignored rather than guessed at.
 *
 * With no `STRIPE_WEBHOOK_SECRET` the route is **not registered**, the same
 * stance `whatsapp-webhook.ts` takes and for the same reason: an endpoint that
 * accepts unsigned writes is worse than a missing one, because the missing one
 * fails visibly during setup.
 */

export interface StripeWebhookDeps {
  stripe: Stripe;
  config: StripeConfig;
  credits: Pick<CreditStore, 'grant'>;
  logger?: { info(m: string, meta?: unknown): void; warn(m: string, meta?: unknown): void };
}

export function registerStripeWebhook(app: Hono, deps: StripeWebhookDeps): void {
  const log = deps.logger ?? { info: () => {}, warn: () => {} };

  app.post('/webhooks/stripe', async (c) => {
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      // Not 401: an unsigned request is not an authentication failure, it is a
      // request that is not from Stripe at all.
      return c.json({ error: 'Missing stripe-signature.' }, 400);
    }

    const raw = await c.req.text();

    let event: Stripe.Event;
    try {
      event = deps.stripe.webhooks.constructEvent(raw, signature, deps.config.webhookSecret);
    } catch (err) {
      /*
       * Deliberately uninformative to the caller and informative in the log.
       * A verification failure is either a misconfigured secret — which the
       * operator needs to see — or somebody probing, who does not need to be
       * told which part was wrong.
       */
      log.warn('stripe webhook signature rejected', { error: String(err) });
      return c.json({ error: 'Invalid signature.' }, 400);
    }

    /*
     * One event type. Everything else is acknowledged and ignored: Stripe
     * sends dozens by default, and answering non-2xx to a type we do not
     * handle would put it into retry for no reason.
     *
     * `checkout.session.completed` and not `payment_intent.succeeded`, because
     * the session is what carries our metadata and `async_payment_succeeded`
     * is the delayed-method counterpart of the same thing.
     */
    if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
      return c.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    /*
     * Paid, and only paid. `checkout.session.completed` fires for a session
     * whose payment is still pending when the method is a delayed one — a bank
     * debit — and granting on that would be granting on a promise. The async
     * event above is what arrives when it actually clears.
     */
    if (session.payment_status !== 'paid') {
      log.info('stripe session completed but unpaid, waiting', {
        sessionId: session.id,
        paymentStatus: session.payment_status,
      });
      return c.json({ received: true });
    }

    const orgId = session.metadata?.orgId ?? session.client_reference_id ?? undefined;
    const packId = session.metadata?.packId;
    const pack = packId ? packById(packId) : undefined;

    if (!orgId || !pack) {
      /*
       * Acknowledged, not retried. A session with no org or an unknown pack is
       * not going to become valid on the fourth delivery, and leaving it in
       * Stripe's retry queue for three days hides it. The log is the signal —
       * this is a reconciliation job, not an outage.
       */
      log.warn('stripe payment with no resolvable org or pack', {
        sessionId: session.id,
        orgId,
        packId,
      });
      return c.json({ received: true });
    }

    /*
     * The amount comes from the session Stripe signed, not from metadata's
     * `credits` string — metadata is ours but it travels through the client,
     * and the pack table is the server's own. They should agree; where they do
     * not, the table wins.
     */
    await deps.credits.grant({
      orgId,
      amountCents: creditsToCents(pack.credits),
      reason: `Stripe purchase — ${pack.label}`,
      externalRef: session.id,
    });

    log.info('credits granted from stripe payment', {
      orgId,
      sessionId: session.id,
      packId: pack.id,
      credits: pack.credits,
    });

    return c.json({ received: true });
  });
}
