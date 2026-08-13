import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { parseInbound, registerWhatsappWebhook, verifySignature } from '../src/whatsapp-webhook.js';

/**
 * The inbound webhook is unauthenticated by necessity — Meta's servers have no
 * Clerk session — so the HMAC signature is the *only* thing separating "the
 * owner answered your question" from "anyone on the internet answered on their
 * behalf". Most of this file is about that one check.
 */

const SECRET = 'app-secret';

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id: 'wamid.1', from: '2348012345678', type: 'text', text: { body: 'the skin fade' }, ...over },
              ],
            },
          },
        ],
      },
    ],
  });

function harness(over: Partial<Parameters<typeof registerWhatsappWebhook>[1]> = {}) {
  const app = new Hono();
  const calls: unknown[] = [];

  registerWhatsappWebhook(app, {
    appSecret: SECRET,
    verifyToken: 'verify-me',
    invokeDeps: { writeToolCall: async () => {} } as never,
    loadBrandGovernance: async () => ({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      approvalMode: 'autopublish' as const,
      agentPaused: false,
    }),
    resolveTenant: async () => ({ orgId: 'org_1', brandId: 'brand_1' }),
    systemCtx: async () => {
      calls.push('ctx');
      return {} as never;
    },
    ...over,
  });

  return { app, calls };
}

describe('signature verification', () => {
  it('accepts a correctly signed body', () => {
    const body = envelope();
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    const body = envelope();
    expect(verifySignature(body, sign(body, 'not-the-secret'), SECRET)).toBe(false);
  });

  it('rejects when the body changed after signing', () => {
    // The forgery this stops: a valid-looking envelope with the answer swapped.
    const signature = sign(envelope());
    const tampered = envelope({ text: { body: 'yes, publish everything' } });
    expect(verifySignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    const body = envelope();
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, 'deadbeef', SECRET)).toBe(false);
    expect(verifySignature(body, 'sha1=deadbeef', SECRET)).toBe(false);
  });

  it('rejects a digest of the wrong length without throwing', () => {
    // `timingSafeEqual` throws on unequal lengths, which would turn a probe
    // into a 500 and leak the length. Same `false` as any other bad signature.
    expect(() => verifySignature(envelope(), 'sha256=ab', SECRET)).not.toThrow();
    expect(verifySignature(envelope(), 'sha256=ab', SECRET)).toBe(false);
  });
});

describe('POST /v1/webhooks/whatsapp', () => {
  const post = (app: Hono, body: string, signature?: string) =>
    app.request('/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
      body,
    });

  it('refuses an unsigned request', async () => {
    const { app, calls } = harness();
    const res = await post(app, envelope());

    expect(res.status).toBe(403);
    // Nothing downstream ran — the forgery never reached a tool.
    expect(calls).toHaveLength(0);
  });

  it('refuses a wrongly signed request', async () => {
    const body = envelope();
    const { app, calls } = harness();
    const res = await post(app, body, sign(body, 'wrong'));

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('does not say why it refused', async () => {
    // Distinguishing "missing" from "wrong" is a free oracle for a prober.
    const body = envelope();
    const missing = await post(harness().app, body);
    const wrong = await post(harness().app, body, sign(body, 'wrong'));

    expect(await missing.json()).toEqual(await wrong.json());
  });

  it('acknowledges a well-formed signed delivery', async () => {
    const body = envelope();
    const { app } = harness({ systemCtx: async () => ({}) as never });
    const res = await post(app, body, sign(body));

    expect(res.status).toBe(200);
  });

  it('still returns 200 when a message cannot be handled', async () => {
    /**
     * Meta retries non-2xx with backoff and disables a webhook that keeps
     * failing. An unroutable message is not a *delivery* failure, and reporting
     * it as one eventually costs the whole integration.
     */
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = envelope();
    const { app } = harness({
      systemCtx: async () => {
        throw new Error('store is down');
      },
    });

    expect((await post(app, body, sign(body))).status).toBe(200);
    vi.restoreAllMocks();
  });

  it('drops a message from an unmapped number rather than guessing a brand', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = envelope();
    const { app, calls } = harness({ resolveTenant: async () => undefined });

    expect((await post(app, body, sign(body))).status).toBe(200);
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe('GET /v1/webhooks/whatsapp — the subscription handshake', () => {
  const get = (app: Hono, qs: string) => app.request(`/v1/webhooks/whatsapp?${qs}`);

  it('echoes the challenge for the right verify token', async () => {
    const res = await get(harness().app, 'hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
  });

  it('refuses the wrong verify token', async () => {
    const res = await get(harness().app, 'hub.mode=subscribe&hub.verify_token=guess&hub.challenge=abc123');
    expect(res.status).toBe(403);
  });

  it('refuses a request that is not a subscribe', async () => {
    const res = await get(harness().app, 'hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=abc');
    expect(res.status).toBe(403);
  });
});

describe('parseInbound', () => {
  it('pulls out a text message and its reply id', () => {
    const [message] = parseInbound(envelope({ context: { id: 'wamid.original' } }));
    expect(message).toMatchObject({ id: 'wamid.1', from: '2348012345678', body: 'the skin fade', inReplyTo: 'wamid.original' });
  });

  it('skips non-text messages rather than failing', () => {
    // Media belongs to `direct.media.ingest`, which needs Meta's download
    // endpoint. Skipping is right; throwing would take the endpoint down.
    expect(parseInbound(envelope({ type: 'image', text: undefined }))).toEqual([]);
  });

  it('survives a shape it has never seen', () => {
    /**
     * The payload is Meta's to change, and they disable webhooks that keep
     * erroring — so a new field must not be able to cost us inbound messages.
     */
    expect(parseInbound('not json')).toEqual([]);
    expect(parseInbound('{}')).toEqual([]);
    expect(parseInbound(JSON.stringify({ entry: 'nope' }))).toEqual([]);
    expect(parseInbound(JSON.stringify({ entry: [{ changes: [{ value: {} }] }] }))).toEqual([]);
  });

  it('reads several messages from one delivery', () => {
    // Meta batches. Handling only the first would silently drop answers.
    const batched = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'a', from: '1', type: 'text', text: { body: 'one' } },
                  { id: 'b', from: '1', type: 'text', text: { body: 'two' } },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parseInbound(batched).map((m) => m.body)).toEqual(['one', 'two']);
  });
});
