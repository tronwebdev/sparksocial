import type { CaptureBrief } from './schema.js';

/**
 * MESSAGE TRANSPORT — the capture loop's delivery channel (plan §2.2, §6.3).
 *
 *   *"WhatsApp Business Cloud API (Iyobo surface), push/in-app secondary —
 *   matches the Nigerian SMB motion; the delivery path for capture briefs."*
 *
 * An interface rather than a direct WhatsApp client, for the same reason
 * publishing goes through `PlatformAdapter`: the channel is a deployment
 * decision, not an architectural one. WhatsApp is first because it is where the
 * owner already is, but a session that reaches them by push or in-app is the
 * same session.
 *
 * The practical reason it exists *today*: WhatsApp production messaging needs
 * Meta business verification, which takes weeks (plan §8, and the schedule-risk
 * note in docs/STATUS.md). Everything upstream — brief generation, validation,
 * batching, the five-minute budget — is finished and testable now. Putting the
 * seam here means the loop is complete and only the last hop is stubbed, rather
 * than the whole loop waiting on a form Meta has not processed yet.
 */

export interface SendResult {
  /** Channel-side id, for correlating the owner's reply back to this session. */
  messageId: string;
  channel: string;
  /** What the transport actually delivered to, redacted for logs and audit rows. */
  toRedacted: string;
}

export interface MessageTransport {
  /** Stable identifier recorded on the tool call, e.g. `whatsapp` or `stub`. */
  readonly channel: string;
  /**
   * Deliver one weekly capture session.
   *
   * Takes the whole session rather than a message string: how 3–5 briefs are
   * laid out is channel-specific (WhatsApp has list messages and a 1024-char
   * body limit; push has neither), and flattening to text here would push that
   * formatting into the caller, where it would be written once for WhatsApp and
   * be wrong for everything else.
   */
  sendSession(args: {
    to: string;
    genomeId: string;
    briefs: CaptureBrief[];
    totalEffortSec: number;
  }): Promise<SendResult>;

  /**
   * Deliver one plain message — `human.ask`, `human.notify`, `whatsapp.send`.
   *
   * Separate from `sendSession` rather than a generalisation of it, because the
   * two are different message *types* on the channel that matters: a capture
   * session is a WhatsApp interactive list, a question is a text or reply-button
   * message, and they have different templates, different approval requirements
   * from Meta, and different length limits. Collapsing them into "send some
   * text" would push that distinction into the caller, where it would be
   * written once for WhatsApp and be wrong for push.
   *
   * `options` are offered choices; a transport with no notion of them renders
   * them into the body and still accepts free-text replies.
   */
  sendText(args: {
    to: string;
    body: string;
    options?: string[];
  }): Promise<SendResult>;
}

/**
 * No-op transport. Records what *would* have been sent and returns a
 * well-formed result.
 *
 * Deliberately not a throwing stub: the point is that the whole loop —
 * resolver → briefs → session → send → (owner films) → ingest → finish — runs
 * end to end in development and in tests, so that swapping in the real
 * WhatsApp client is a one-line change against a path already known to work,
 * not the first time the path has ever been exercised.
 *
 * `sent` is exposed for assertions; nothing in production reads it.
 */
export function createStubTransport(): MessageTransport & {
  sent: Array<{ to: string; genomeId: string; briefCount: number }>;
  texts: Array<{ to: string; body: string; options?: string[] }>;
} {
  const sent: Array<{ to: string; genomeId: string; briefCount: number }> = [];
  const texts: Array<{ to: string; body: string; options?: string[] }> = [];
  let n = 0;

  return {
    channel: 'stub',
    sent,
    texts,
    async sendSession({ to, genomeId, briefs }) {
      sent.push({ to, genomeId, briefCount: briefs.length });
      return {
        messageId: `stub_${++n}`,
        channel: 'stub',
        toRedacted: redactRecipient(to),
      };
    },
    async sendText({ to, body, options }) {
      texts.push({ to, body, ...(options?.length ? { options } : {}) });
      return {
        messageId: `stub_${++n}`,
        channel: 'stub',
        toRedacted: redactRecipient(to),
      };
    },
  };
}

/**
 * A phone number is personal data and this string lands in `tool_calls`, which
 * is queried, exported and read by support. Keep enough to identify the
 * recipient in a conversation with the owner, not enough to be a contact list.
 */
export function redactRecipient(to: string): string {
  const trimmed = to.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return `${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}
