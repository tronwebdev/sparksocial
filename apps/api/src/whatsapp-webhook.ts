import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { invokeTool } from '@sparksocial/tools';
import type { InvokeDeps, ToolCtx } from '@sparksocial/tools';

/**
 * META'S WHATSAPP WEBHOOK — the inbound half of the capture loop (§6.3).
 *
 * `whatsapp.receive` existed as a tool with nothing calling it. This is the
 * route, and it is almost entirely one security check.
 *
 * ── The signature is the whole thing ───────────────────────────────────────
 *
 * This endpoint is unauthenticated by necessity: Meta's servers call it and
 * they have no Clerk session. The only thing separating "the owner answered
 * your question" from "anyone on the internet answered on their behalf" is the
 * `X-Hub-Signature-256` HMAC over the **raw** body, keyed with the app secret.
 *
 * Two details that are easy to get wrong and fatal to get wrong:
 *
 * 1. **The raw bytes.** The HMAC must be computed over exactly what Meta sent.
 *    Parsing to JSON and re-serialising changes key order and whitespace, and
 *    the signature stops matching — so the temptation becomes to skip the
 *    check. `c.req.text()` first, parse second.
 * 2. **Constant-time comparison.** `a === b` on a hex digest leaks how many
 *    leading characters were right, one request at a time.
 *
 * With no `WHATSAPP_APP_SECRET` configured the route is **not registered at
 * all**, rather than registered and permissive. An endpoint that accepts
 * unsigned writes is worse than a missing one: the missing one fails visibly
 * during setup.
 */

export interface WhatsappWebhookDeps {
  invokeDeps: InvokeDeps;
  /** Builds the ctx the tool runs under. Meta is not a Clerk user. */
  systemCtx: (args: { orgId: string; brandId: string }) => Promise<ToolCtx>;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<Parameters<typeof invokeTool>[0]['brand']>;
  appSecret: string;
  /** Echoed back on the GET subscription handshake. */
  verifyToken: string;
  /**
   * Which workspace an inbound message belongs to.
   *
   * A phone number is the only identifier Meta gives us, so mapping it to a
   * brand is a lookup the alpha does not have yet — `whatsapp.send` does not
   * record which brand a number belongs to. Injected so the resolution can
   * become a real query without touching this route.
   */
  resolveTenant: (fromPhone: string) => Promise<{ orgId: string; brandId: string } | undefined>;
}

export function registerWhatsappWebhook(app: Hono, deps: WhatsappWebhookDeps): void {
  /**
   * Subscription handshake. Meta calls this once when the webhook is
   * configured and expects `hub.challenge` echoed back verbatim as plain text.
   */
  app.get('/v1/webhooks/whatsapp', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');

    if (mode === 'subscribe' && token && safeEqual(token, deps.verifyToken)) {
      return c.text(challenge ?? '', 200);
    }
    return c.text('Forbidden', 403);
  });

  app.post('/v1/webhooks/whatsapp', async (c) => {
    // Raw first. See note 1 in the header — re-serialised JSON will not match.
    const raw = await c.req.text();

    if (!verifySignature(raw, c.req.header('x-hub-signature-256'), deps.appSecret)) {
      // No detail in the response. A body distinguishing "missing" from
      // "wrong" is a free oracle for someone probing the endpoint.
      return c.json({ error: { code: 'FORBIDDEN', message: 'Bad signature.' } }, 403);
    }

    const messages = parseInbound(raw);

    /**
     * 200 regardless of what happens below.
     *
     * Meta retries any non-2xx with backoff and disables a webhook that keeps
     * failing. A message we cannot route — an unknown number, a sticker — is
     * not a delivery failure, and reporting it as one eventually costs the
     * whole integration. Errors are logged; the acknowledgement is about
     * transport, not about business outcome.
     */
    for (const message of messages) {
      try {
        await handle(deps, message);
      } catch (e) {
        console.error('[error] whatsapp inbound failed', {
          from: redact(message.from),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return c.json({ received: messages.length });
  });
}

async function handle(deps: WhatsappWebhookDeps, message: InboundMessage): Promise<void> {
  const tenant = await deps.resolveTenant(message.from);
  if (!tenant) {
    // Someone messaged the business number who is not a known owner. Recording
    // it against a guessed brand would be worse than dropping it.
    console.warn('[warn] whatsapp message from an unmapped number', { from: redact(message.from) });
    return;
  }

  const ctx = await deps.systemCtx(tenant);

  await invokeTool(
    {
      tool: 'whatsapp.receive',
      input: {
        from: message.from,
        body: message.body,
        channelMessageId: message.id,
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      },
      /**
       * `user`, not `agent`. The words genuinely came from a person, and
       * `whatsapp.receive` is `human_only` — declaring `agent` here would be
       * denied by the policy engine, correctly.
       */
      caller: 'user',
      ctx,
      brand: await deps.loadBrandGovernance(tenant.orgId, tenant.brandId),
      // Meta retries. The channel's own message id is the natural key, so a
      // redelivery replays rather than answering a question twice.
      idempotencyKey: `whatsapp:${message.id}`,
    },
    deps.invokeDeps,
  );
}

interface InboundMessage {
  id: string;
  from: string;
  body: string;
  inReplyTo?: string;
}

/**
 * Pull text messages out of Meta's envelope.
 *
 * Deliberately total: anything unrecognised yields nothing rather than
 * throwing. The payload shape is Meta's to change, and a new field appearing
 * must not take the endpoint down — which, given they disable webhooks that
 * keep erroring, would mean losing inbound messages entirely.
 *
 * Non-text messages (images, stickers, the media a capture session actually
 * returns) are skipped here on purpose: they belong to `direct.media.ingest`,
 * which needs Meta's media download endpoint and a resolved media id.
 */
export function parseInbound(raw: string): InboundMessage[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }

  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return [];

  const out: InboundMessage[] = [];
  for (const entry of entries) {
    for (const change of asArray((entry as { changes?: unknown[] })?.changes)) {
      for (const m of asArray((change as { value?: { messages?: unknown[] } })?.value?.messages)) {
        const message = m as {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          context?: { id?: string };
        };

        if (message.type !== 'text' || !message.id || !message.from || !message.text?.body) continue;

        out.push({
          id: message.id,
          from: message.from,
          body: message.text.body,
          ...(message.context?.id ? { inReplyTo: message.context.id } : {}),
        });
      }
    }
  }
  return out;
}

/** HMAC-SHA256 over the raw body, compared in constant time. */
export function verifySignature(raw: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex');
  return safeEqual(header.slice('sha256='.length), expected);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length — so the lengths are compared first and the result is the same
  // `false` either way.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A phone number in a log line is personal data. Keep enough to correlate. */
const redact = (phone: string) =>
  phone.length <= 4 ? '*'.repeat(phone.length) : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
