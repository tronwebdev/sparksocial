/**
 * The client's view of the tool registry. Every capability the UI has goes
 * through here — there is no other way to reach the backend.
 *
 * Mirrors `apps/api/src/app.ts`'s response shape: a call either succeeded, was
 * gated by the policy engine (denied, or staged for a human), or failed. Callers
 * must handle `gated` explicitly rather than treating it as success — that
 * distinction is the whole point of the autonomy model.
 */

export type ToolResult<T> =
  | { status: 'succeeded'; callId: string; output: T; why?: unknown }
  | { status: 'gated'; callId: string; decision: { kind: string; reason?: string } }
  | { status: 'failed'; callId?: string; error: { code: string; message: string } };

/** Where Clerk parks a session that has not finished choosing an organization. */
const TASKS_URL = '/sign-in/tasks';

/** Where an unauthenticated (or no-longer-valid) session gets sent. */
const SIGN_IN_URL = '/sign-in';

export async function invoke<T>(name: string, input: unknown, idempotencyKey?: string): Promise<ToolResult<T>> {
  const res = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  });

  const body = (await res.json().catch(() => null)) as ToolResult<T> | { error?: { code: string; message: string } } | null;

  /**
   * A session with no organization is recoverable in exactly one way, and the
   * user cannot guess it.
   *
   * Every panel calls tools independently, so this surfaced as a shell full of
   * identical "No active organization" messages with no action attached to any
   * of them. Sending the browser to the task screen turns N dead errors into
   * the one step that was missing. Handled centrally because the alternative is
   * the same recovery pasted into every caller, and the one that gets forgotten
   * is the screen the user happens to land on.
   *
   * Guarded against redirecting away from the task screen itself — the page
   * mounts under `(auth)`, makes no tool calls, and a loop here would be worse
   * than the bug.
   */
  const code = body && 'error' in body ? body.error?.code : undefined;
  if (code === 'NO_ORGANIZATION' && typeof window !== 'undefined') {
    if (!window.location.pathname.startsWith(TASKS_URL)) window.location.assign(TASKS_URL);
  }

  /**
   * `FORBIDDEN` is this codebase's session-identity code — thrown only for "not
   * signed in" / "session has no subject" (`clerk-auth.ts`) and by the proxy
   * route itself when there's no token to forward at all. It is never an
   * in-session permission denial: a role that lacks scope for a tool comes back
   * as `status: 'gated'`, a structurally different response every caller
   * already has to handle separately. So a `FORBIDDEN` here means the session
   * the browser thinks it has isn't one the backend accepts — expired, revoked,
   * or a stale Bearer token — and no amount of staying on this page fixes that.
   *
   * Before this, a guard component (e.g. `GenomeGuard`) that called `invoke()`
   * during exactly this failure just rendered the raw error message and dead-
   * ended there instead of routing anywhere, which is what "unauthenticated
   * access doesn't redirect to sign-in" looked like from the outside.
   */
  if (code === 'FORBIDDEN' && typeof window !== 'undefined') {
    if (!window.location.pathname.startsWith(SIGN_IN_URL)) window.location.assign(SIGN_IN_URL);
  }

  if (body && 'status' in body) return body;
  return {
    status: 'failed',
    error: (body as { error?: { code: string; message: string } })?.error ?? {
      code: 'UNKNOWN',
      message: `Request failed (${res.status}).`,
    },
  };
}

/** Convenience for the common case: the output, or a thrown error. */
export async function invokeOrThrow<T>(name: string, input: unknown): Promise<T> {
  const result = await invoke<T>(name, input);
  if (result.status === 'succeeded') return result.output;
  if (result.status === 'gated') throw new Error(`${name} was gated: ${result.decision.kind}`);
  throw new Error(`${name} failed: ${result.error.code} — ${result.error.message}`);
}

/**
 * One place to turn any `ToolResult` failure into a line for a person.
 *
 * Deliberately thin: it does **not** rewrite tool messages. Every code in the
 * set is already written for a human by whoever threw it — `INVALID_INPUT` names
 * the field, `NOT_FOUND` names the thing, and `explainCrawlFailure` writes a real
 * sentence for "blocked" versus "unreachable", each with a different next step.
 * Replacing those with something generic would lose the only useful part.
 *
 * What this exists for is the `gated` branch, which every caller was
 * hand-rolling and half of them got subtly different.
 *
 * ── The one that got away, and where it was fixed ─────────────────────────
 *
 * A vendor payload *did* reach onboarding —
 * `400 {"type":"error",...,"request_id":"req_011Ce…"}` on the second step of
 * setup. The fix belonged at the boundary that produced it
 * (`apps/api/src/inference-client.ts`, which now catches the SDK error and keeps
 * the body in `details`), not here: sniffing messages for JSON in the client
 * would have hidden the symptom and left every other caller of that client
 * exposed.
 */
export function humanError(result: ToolResult<unknown>, gatedFallback = 'That needs approval before it can run.'): string {
  if (result.status === 'succeeded') return '';
  if (result.status === 'gated') return result.decision.reason ?? gatedFallback;
  return result.error.message || 'That did not work.';
}
