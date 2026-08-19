import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createWhatsAppTransport } from '../src/whatsappTransport.js';
import type { CaptureBrief } from '../src/schema.js';

/**
 * The real transport — one HTTP call per send. What matters is the request
 * shape (Bearer auth, the right message type for the right content) and that
 * a bad response fails loudly rather than reporting a session as delivered.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const brief = (over: Partial<CaptureBrief> = {}): CaptureBrief => ({
  brief_id: 'brief_1',
  playbook_id: 'pb_craft_capture',
  subject: 'the final fade blend',
  framing: 'behind subject, chest height',
  orientation: 'vertical',
  duration_sec: 20,
  motion: 'slow push in or static',
  audio: 'ambient only, no speech',
  lighting: 'face a window',
  do_not: ['do not talk to camera'],
  estimated_effort_sec: 45,
  expires_at: '2026-08-20T00:00:00.000Z',
  ...over,
});

describe('sendSession', () => {
  it('posts an interactive list message with one row per brief, authorized with a bearer token', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.1' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    await transport.sendSession({ to: '+2348012345678', genomeId: 'gen_1', briefs: [brief(), brief({ brief_id: 'brief_2', subject: 'the finished cut' })], totalEffortSec: 90 });

    expect(f.mock.calls[0]![0]).toBe('https://graph.facebook.com/v21.0/pn_1/messages');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '+2348012345678', type: 'interactive' });
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.action.sections[0].rows).toHaveLength(2);
    expect(body.interactive.action.sections[0].rows[0].id).toBe('brief_1');
  });

  it('caps rows at 10, WhatsApp\'s own list limit', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.1' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });
    const briefs = Array.from({ length: 15 }, (_, i) => brief({ brief_id: `b${i}` }));

    await transport.sendSession({ to: '+1', genomeId: 'gen_1', briefs, totalEffortSec: 300 });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.interactive.action.sections[0].rows).toHaveLength(10);
  });

  it('truncates a row title/description to the platform limits rather than sending an oversized one', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.1' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    await transport.sendSession({
      to: '+1',
      genomeId: 'gen_1',
      briefs: [brief({ subject: 'a'.repeat(60), framing: 'b'.repeat(100) })],
      totalEffortSec: 45,
    });

    const row = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string).interactive.action.sections[0].rows[0];
    expect(row.title.length).toBeLessThanOrEqual(24);
    expect(row.description.length).toBeLessThanOrEqual(72);
  });

  it('returns the redacted recipient, never the raw number', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.1' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    const out = await transport.sendSession({ to: '+2348012345678', genomeId: 'gen_1', briefs: [brief()], totalEffortSec: 45 });

    expect(out).toMatchObject({ messageId: 'wamid.1', channel: 'whatsapp' });
    expect(out.toRedacted).not.toContain('234801');
    expect(out.toRedacted.endsWith('5678')).toBe(true);
  });
});

describe('sendText', () => {
  it('sends a plain text message when there are no options', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.2' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    await transport.sendText({ to: '+1', body: 'Your clips are ready.' });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ type: 'text', text: { body: 'Your clips are ready.' } });
  });

  it('sends interactive buttons for up to 3 short options', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.3' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    await transport.sendText({ to: '+1', body: 'Which one?', options: ['Fade', 'Taper'] });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
    expect(body.interactive.action.buttons).toHaveLength(2);
    expect(body.interactive.action.buttons[0]).toMatchObject({ type: 'reply', reply: { title: 'Fade' } });
  });

  it('degrades to numbered plain text when there are more than 3 options', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.4' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    await transport.sendText({ to: '+1', body: 'Pick one', options: ['A', 'B', 'C', 'D'] });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.type).toBe('text');
    expect(body.text.body).toContain('1. A');
    expect(body.text.body).toContain('4. D');
  });

  it('degrades to numbered plain text when an option is too long for a button', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ messages: [{ id: 'wamid.5' }] }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });

    await transport.sendText({ to: '+1', body: 'Pick one', options: ['a'.repeat(25)] });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.type).toBe('text');
  });
});

describe('transport', () => {
  it('reports an upstream failure on a non-2xx response', async () => {
    const f = vi.fn(async () => new Response('bad token', { status: 401 }));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });
    await expect(transport.sendText({ to: '+1', body: 'hi' })).rejects.toThrow(ToolError);
  });

  it('refuses a response with no message id rather than reporting a fake delivery', async () => {
    const f = vi.fn(async () => json({}));
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok', fetchImpl: f as unknown as typeof fetch });
    await expect(transport.sendText({ to: '+1', body: 'hi' })).rejects.toThrow(ToolError);
  });

  it('identifies itself as the whatsapp channel', () => {
    const transport = createWhatsAppTransport({ phoneNumberId: 'pn_1', accessToken: 'tok' });
    expect(transport.channel).toBe('whatsapp');
  });
});
