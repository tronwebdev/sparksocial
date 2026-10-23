import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `org.credits.checkout` — buying credits.
 *
 * ── What this returns, and what it deliberately does not do ──────────────
 *
 * A URL. The customer goes to Stripe's hosted page, types their card there,
 * and comes back. No card number reaches this process at any point, which is
 * the difference between taking payments and being in PCI scope.
 *
 * It grants nothing. A session being *created* means somebody pressed a
 * button; the money arriving is a separate fact that only Stripe can assert,
 * and it asserts it over a signed webhook (`stripe-webhook.ts`). The success
 * redirect is a URL the customer's own browser follows and anyone can type —
 * treating it as proof of payment is how a product gives credits away.
 *
 * ── Why the packs are server-side ─────────────────────────────────────────
 *
 * The caller names a pack, not an amount. A price that arrives from the client
 * is a price the client chose, and a hosted checkout will happily sell
 * 50,000 credits for a penny if that is what the session says. The pack table
 * lives beside the Stripe client and the webhook re-checks it on the way back.
 *
 * ── Not registered when unconfigured ─────────────────────────────────────
 *
 * The factory is only called when `STRIPE_SECRET_KEY` and
 * `STRIPE_WEBHOOK_SECRET` are both set, per CLAUDE.md. Both, not either: a key
 * without a webhook secret can take money and never deliver the credits, which
 * is worse than not selling them.
 */

export const OrgCreditsCheckoutInput = z.object({
  /** One of the ids `CREDIT_PACKS` declares. Validated against it, not trusted. */
  packId: z.string().min(1).max(40),
});

export const OrgCreditsCheckoutOutput = z.object({
  /** Where to send the customer. A `checkout.stripe.com` URL. */
  url: z.string().url(),
  sessionId: z.string(),
  credits: z.number().int(),
  priceCents: z.number().int(),
  currency: z.string(),
});

export interface CheckoutDeps {
  /** Resolves a pack id to what it sells, or undefined if we do not sell it. */
  packs: () => ReadonlyArray<{ id: string; credits: number; label: string }>;
  priceCents: (credits: number) => number;
  currency: string;
  createSession: (args: {
    orgId: string;
    pack: { id: string; credits: number; label: string };
    userId?: string;
  }) => Promise<{ url: string; sessionId: string }>;
}

export function makeOrgCreditsCheckout(deps: CheckoutDeps) {
  return defineTool({
    name: 'org.credits.checkout',
    version: 1,

    summary:
      'Start a credit purchase. Returns a Stripe checkout URL to send the customer to — it takes no ' +
      'payment itself and grants nothing; the credits arrive when Stripe confirms the payment. Free to call.',

    input: OrgCreditsCheckoutInput,
    output: OrgCreditsCheckoutOutput,

    /*
     * `write`, not `spend`. `spend` means this call consumes the org's credit
     * balance, and `policy.ts` rule 4 would check it against the very balance
     * the customer is trying to top up — so an org that had run out could not
     * buy more. It writes to Stripe, not to the ledger.
     */
    effect: 'write',
    /*
     * `human_only`. Nothing in this product is a reason for the agent to reach
     * for a payment page on somebody's behalf, and an agent that could start a
     * checkout is one prompt away from being told to.
     */
    autonomy: 'human_only',
    // Buying is an owner's act. An admin who could commit the organisation to
    // a charge is a spending authority nobody granted them.
    scopes: ['owner'],
    /*
     * `false`. Two calls are two checkout sessions, which is correct and
     * harmless — an abandoned session charges nothing — but it is not a replay
     * of the first, and claiming otherwise would let a retry hand back a stale
     * URL for a session the customer has already paid.
     */
    idempotent: false,

    async handler(input, ctx) {
      const pack = deps.packs().find((p) => p.id === input.packId);
      if (!pack) {
        throw new ToolError('INVALID_INPUT', `No credit pack "${input.packId}".`, {
          packId: input.packId,
          available: deps.packs().map((p) => p.id),
        });
      }

      const session = await deps.createSession({
        orgId: ctx.orgId,
        pack,
        ...(ctx.userId ? { userId: ctx.userId } : {}),
      });

      ctx.logger.info('credit checkout started', {
        orgId: ctx.orgId,
        packId: pack.id,
        sessionId: session.sessionId,
      });

      return {
        url: session.url,
        sessionId: session.sessionId,
        credits: pack.credits,
        priceCents: deps.priceCents(pack.credits),
        currency: deps.currency,
      };
    },
  });
}

/**
 * `org.credits.packs` — what is for sale.
 *
 * Separate from the checkout so the screen can draw the options without
 * creating a Stripe session to find out what they are. Free, read-only, and
 * registered on the same condition: a price list for a checkout that does not
 * exist is a page of buttons that cannot work.
 */
export function makeOrgCreditsPacks(deps: Pick<CheckoutDeps, 'packs' | 'priceCents' | 'currency'>) {
  return defineTool({
    name: 'org.credits.packs',
    version: 1,

    summary: 'The credit packs this organisation can buy, with their prices. Free, read-only.',

    input: z.object({}),
    output: z.object({
      currency: z.string(),
      packs: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          credits: z.number().int(),
          priceCents: z.number().int(),
        }),
      ),
    }),

    effect: 'read',
    autonomy: 'auto',
    // Readable by the two roles that can act on it. A price list is not
    // sensitive, but a client role seeing the agency's billing options is a
    // scope leak with no upside.
    scopes: ['owner', 'admin'],
    idempotent: true,

    async handler() {
      return {
        currency: deps.currency,
        packs: deps.packs().map((p) => ({
          id: p.id,
          label: p.label,
          credits: p.credits,
          priceCents: deps.priceCents(p.credits),
        })),
      };
    },
  });
}
