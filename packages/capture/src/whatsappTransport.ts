import { ToolError } from '@sparksocial/shared';
import type { MessageTransport } from './transport.js';
import { redactRecipient } from './transport.js';

/**
 * The real `MessageTransport` — WhatsApp Business Cloud API. Everything
 * upstream of this (brief generation, validation, batching, the five-minute
 * budget) has been real since P2; this is the last hop `transport.ts`'s own
 * comment names as the honest gap. `.env.example`'s own note already
 * promises the shape: "Unset → the stub transport."
 *
 * ── Why a list message for a session, buttons/text for a question ──────────
 * `sendSession` uses WhatsApp's interactive *list* message — the natural fit
 * for "here are 3-5 things, pick one to see the brief," and each row is one
 * brief truncated to the platform's own limits (24-char title, 72-char
 * description, 10 rows per section). `sendText` uses interactive *buttons*
 * when there are ≤3 short options (WhatsApp's own cap), and otherwise
 * degrades to plain text with the choices numbered in the body — a caller
 * offering more choices than the platform's reply-button UI supports still
 * gets something a person can answer, not a dropped feature.
 */

export interface WhatsAppTransportOptions {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_VERSION = 'v21.0';
const BODY_CHAR_LIMIT = 1024; // WhatsApp's own cap on a text/interactive body
const ROW_TITLE_LIMIT = 24;
const ROW_DESC_LIMIT = 72;
const MAX_LIST_ROWS = 10;
const MAX_BUTTONS = 3;
const BUTTON_TITLE_LIMIT = 20;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function createWhatsAppTransport(opts: WhatsAppTransportOptions): MessageTransport {
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? `https://graph.facebook.com/${opts.apiVersion ?? DEFAULT_API_VERSION}`).replace(/\/+$/, '');

  async function send(body: Record<string, unknown>): Promise<string> {
    const response = await doFetch(`${baseUrl}/${opts.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ToolError('UPSTREAM_FAILED', `WhatsApp send failed (${response.status}).`, {
        status: response.status,
        detail: detail.slice(0, 200),
      });
    }

    const parsed = (await response.json()) as { messages?: Array<{ id?: string }> };
    const id = parsed.messages?.[0]?.id;
    if (!id) {
      throw new ToolError('UPSTREAM_FAILED', 'WhatsApp accepted the request but returned no message id.', {});
    }
    return id;
  }

  return {
    channel: 'whatsapp',

    async sendSession({ to, briefs, totalEffortSec }) {
      const rows = briefs.slice(0, MAX_LIST_ROWS).map((b, i) => ({
        id: b.brief_id,
        title: truncate(`${i + 1}. ${b.subject}`, ROW_TITLE_LIMIT),
        description: truncate(`${b.duration_sec}s · ${b.framing}`, ROW_DESC_LIMIT),
      }));

      const messageId = await send({
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: truncate(
              `This week's capture session — about ${Math.round(totalEffortSec / 60)} min total. Pick one to see the full brief.`,
              BODY_CHAR_LIMIT,
            ),
          },
          action: { button: 'View briefs', sections: [{ title: 'This week', rows }] },
        },
      });

      return { messageId, channel: 'whatsapp', toRedacted: redactRecipient(to) };
    },

    async sendText({ to, body, options }) {
      if (options?.length && options.length <= MAX_BUTTONS && options.every((o) => o.length <= BUTTON_TITLE_LIMIT)) {
        const messageId = await send({
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: truncate(body, BODY_CHAR_LIMIT) },
            action: { buttons: options.map((o, i) => ({ type: 'reply', reply: { id: `opt_${i}`, title: o } })) },
          },
        });
        return { messageId, channel: 'whatsapp', toRedacted: redactRecipient(to) };
      }

      const withOptions = options?.length ? `${body}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : body;
      const messageId = await send({ to, type: 'text', text: { body: truncate(withOptions, BODY_CHAR_LIMIT) } });
      return { messageId, channel: 'whatsapp', toRedacted: redactRecipient(to) };
    },
  };
}
