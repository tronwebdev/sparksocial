import type { ToolResult } from './tools';
import { userMessage } from './errorCopy';

/**
 * `notify` — how any screen tells the person what just happened.
 *
 *   notify.success('Campaign launched', { body: '12 posts scheduled' })
 *   notify.error('Couldn’t publish', { body: userMessage(res.error) })
 *   notify.warning('3 posts need your approval')
 *   notify.pending('Sent for approval', { body: 'An owner approves it in Needs Attention.' })
 *   notify.info('Draft copied')
 *
 * Every action message in the app goes through here and lands in one place:
 * the in-app notification card, bottom-right, with SPARK in the matching mood
 * and a short sound for the kind (`notifySound.ts`). Before this there were
 * four ways to say "done" — a dark Sonner pill bottom-centre, three hand-built
 * pills, and grey lines of text under whatever button was pressed — and none of
 * them sounded or looked like the others.
 *
 * Callable from anywhere, not only components: the notification provider binds
 * itself on mount, and anything sent before that waits for it.
 *
 * What stays inline: a form field's own validation ("enter a valid URL"), which
 * belongs next to the field, and a panel's empty or error *state*, which is
 * part of the page rather than news about an action.
 */

export type NotifyKind = 'success' | 'error' | 'warning' | 'info' | 'pending';

export interface NotifyOptions {
  /** One line of detail under the title. */
  body?: string;
  /** One button on the card, e.g. "Undo" or "View". */
  action?: { label: string; onClick: () => void };
  /** How long it stays. Defaults by kind; `0` keeps it until it is closed. */
  durationMs?: number;
  /** No sound for this one — e.g. a confirmation of something the person can already see. */
  silent?: boolean;
}

export interface NotifyRequest extends NotifyOptions {
  kind: NotifyKind;
  title: string;
}

type Sink = (n: NotifyRequest) => void;

let sink: Sink | null = null;
const waiting: NotifyRequest[] = [];

/** The provider registers here. Passing `null` unbinds it. */
export function bindNotifySink(next: Sink | null) {
  sink = next;
  if (next) for (const n of waiting.splice(0)) next(n);
}

function send(kind: NotifyKind, title: string, opts: NotifyOptions = {}) {
  const n: NotifyRequest = { kind, title, ...opts };
  if (sink) sink(n);
  else waiting.push(n);
}

export const notify = {
  success: (title: string, opts?: NotifyOptions) => send('success', title, opts),
  error: (title: string, opts?: NotifyOptions) => send('error', title, opts),
  warning: (title: string, opts?: NotifyOptions) => send('warning', title, opts),
  info: (title: string, opts?: NotifyOptions) => send('info', title, opts),
  pending: (title: string, opts?: NotifyOptions) => send('pending', title, opts),
};

/**
 * Says what a tool call came to, and returns whether it succeeded.
 *
 *   if (!notifyResult(res, 'Recipe saved')) return;
 *
 * - `succeeded` → a success notification with `success` (or nothing, when it
 *   is omitted — some screens show the result itself)
 * - `gated`     → pending: it has gone to someone for approval, with the
 *   policy's reason. Not an error: the request was received and is waiting.
 * - `failed`    → an error with the readable message from `errorCopy`.
 *
 * `failTitle` names what did not happen ("Couldn’t save the recipe"); the tool's
 * own message becomes the detail line.
 */
export function notifyResult<T>(
  res: ToolResult<T>,
  success?: string | { title: string; body?: string },
  failTitle = 'That didn’t work',
): res is Extract<ToolResult<T>, { status: 'succeeded' }> {
  if (res.status === 'succeeded') {
    if (success) {
      const s = typeof success === 'string' ? { title: success } : success;
      notify.success(s.title, s.body ? { body: s.body } : undefined);
    }
    return true;
  }
  if (res.status === 'gated') {
    const reason = res.decision.reason?.replace(/\.$/, '');
    notify.pending('Sent for approval', {
      body: reason ? `${reason}. An owner or admin approves it in Needs Attention.` : 'An owner or admin approves it in Needs Attention.',
    });
    return false;
  }
  notify.error(failTitle, { body: userMessage(res.error) });
  return false;
}
