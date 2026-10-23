import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { registerStripeWebhook } from '../src/stripe-webhook.js';
import { CREDIT_PACKS, packPriceCents } from '../src/stripe-client.js';

/**
 * The only path by which a payment becomes a balance.
 *
 * Nothing that comes back through the browser can be trusted — the success
 * redirect is a URL the customer's own browser follows and anyone can type —
 * so this endpoint, and its signature check, is the whole of it.
 */
const SECRET = 'whsec_test_secret';

/** A real Stripe signature header, so `constructEvent` is exercised not stubbed. */
function signed(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  return `t=${at},v1=${sig}`;
}

function event(over: Record<string, unknown> = {}, type = 'checkout.session.completed') {
  return JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type,
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        payment_status: 'paid',
        client_reference_id: 'org_1',
        metadata: { orgId: 'org_1', packId: 'growth', credits: '10000' },
        ...over,
      },
    },
  });
}

function harness() {
  const grant = vi.fn(async () => {});
  const app = new Hono();
  registerStripeWebhook(app, {
    stripe: new Stripe('sk_test_x', { apiVersion: '2025-08-27.basil' }),
    config: { secretKey: 'sk_test_x', webhookSecret: SECRET, returnUrl: 'https://x.test', currency: 'usd' },
    credits: { grant },
  });
  const post = (body: string, header?: string) =>
    app.request('/webhooks/stripe', {
      method: 'POST',
      body,
      ...(header ? { headers: { 'stripe-signature': header } } : {}),
    });
  return { post, grant };
}

describe('the stripe webhook', () => {
  it('grants credits for a paid session', async () => {
    const { post, grant } = harness();
    const body = event();

    const res = await post(body, signed(body));

    expect(res.status).toBe(200);
    expect(grant).toHaveBeenCalledWith({
      orgId: 'org_1',
      amountCents: packPriceCents(10_000),
      reason: expect.stringContaining('Stripe purchase'),
      // The session id, which is what makes a redelivery a no-op.
      externalRef: 'cs_test_1',
    });
  });

  /*
   * The signature is the only thing between this endpoint and anyone on the
   * internet granting themselves credits.
   */
  it('refuses an unsigned request', async () => {
    const { post, grant } = harness();

    const res = await post(event());

    expect(res.status).toBe(400);
    expect(grant).not.toHaveBeenCalled();
  });

  it('refuses a signature made with the wrong secret', async () => {
    const { post, grant } = harness();
    const body = event();

    const res = await post(body, signed(body, 'whsec_not_ours'));

    expect(res.status).toBe(400);
    expect(grant).not.toHaveBeenCalled();
  });

  it('refuses a body that was altered after signing', async () => {
    const { post, grant } = harness();
    const header = signed(event());

    // Same signature, different amount — the attack the raw-bytes rule exists for.
    const res = await post(event({ metadata: { orgId: 'org_1', packId: 'scale' } }), header);

    expect(res.status).toBe(400);
    expect(grant).not.toHaveBeenCalled();
  });

  /*
   * `checkout.session.completed` fires for a delayed payment method before the
   * money clears. Granting on that is granting on a promise.
   */
  it('does not grant for a session that has not been paid', async () => {
    const { post, grant } = harness();
    const body = event({ payment_status: 'unpaid' });

    const res = await post(body, signed(body));

    expect(res.status).toBe(200);
    expect(grant).not.toHaveBeenCalled();
  });

  /*
   * The pack table is the server's. A session naming something we do not sell
   * is acknowledged — it will not become valid on the fourth delivery — and
   * logged, not retried for three days.
   */
  it('ignores a pack it does not sell, without asking to be retried', async () => {
    const { post, grant } = harness();
    const body = event({ metadata: { orgId: 'org_1', packId: 'free_money' } });

    const res = await post(body, signed(body));

    expect(res.status).toBe(200);
    expect(grant).not.toHaveBeenCalled();
  });

  it('acknowledges event types it does not handle', async () => {
    const { post, grant } = harness();
    const body = event({}, 'payment_intent.created');

    const res = await post(body, signed(body));

    expect(res.status).toBe(200);
    expect(grant).not.toHaveBeenCalled();
  });

  /*
   * Grants the amount from the server's own table, not from the `credits`
   * string in metadata — which is ours, but travels through the client.
   */
  it('prices from its own table rather than the payload', async () => {
    const { post, grant } = harness();
    const body = event({ metadata: { orgId: 'org_1', packId: 'starter', credits: '999999' } });

    await post(body, signed(body));

    const starter = CREDIT_PACKS.find((p) => p.id === 'starter')!;
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: packPriceCents(starter.credits) }),
    );
  });
});
