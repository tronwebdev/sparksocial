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

/**
 * `idempotencyKey` is optional in this signature and **mandatory for any tool
 * declared `idempotent: false`** — `packages/tools/src/invoke.ts` refuses such a
 * call before the handler runs, with `INVALID_INPUT`.
 *
 * It reads backwards and has been misread twice: `idempotent: false` does not
 * mean "do not send a key". It means the tool cannot be safely repeated, so the
 * key is what makes a duplicated *request* — a retry, a double-submit, a proxy
 * replay — return the first result instead of doing the thing twice. Seven
 * buttons across this app sent no key and were rejected 100% of the time.
 *
 * Choosing one:
 *   - **Fresh `crypto.randomUUID()`** when each press is a genuinely new action
 *     (draft this playbook, invite this person, ingest this file). One press mints
 *     one key, so one press is one action.
 *   - **A stable string** when a repeat press must collapse into the first —
 *     `publish:${contentItemId}:${platform}` is the example: publishing the same
 *     post to the same platform twice is never what was meant.
 *
 * `packages/db/test/isolation.test.ts` fails the build if a call site here omits
 * the key for a non-idempotent tool, because the compiler cannot see it.
 */
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

  // A successful call proves the session works, so arm the latch again for a
  // future expiry. Without this, one transient 401 disables the redirect for the
  // rest of the tab's life.
  if (!code && typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem('ss:forbidden-redirected');
    } catch {
      /* storage unavailable — nothing to reset */
    }
  }
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
    /**
     * At most one redirect per browsing session, and here is why.
     *
     * The guard below used to be only the path check, which stops this
     * redirecting *away from* sign-in but does nothing about the round trip:
     * `/home` calls a tool → 401 → assign `/sign-in` → sign-in sees a signed-in
     * client and `router.replace('/')` → `/` → `/home` → 401 → … Six server
     * requests per lap, forever, and the actual error never reaches a screen.
     * That is what "the loop is still happening" looks like in a dev log, and it
     * is ours, not Clerk's.
     *
     * A session-scoped latch turns it into one honest attempt: redirect once, and
     * if the backend still rejects the session after that, return the failure so
     * a caller can render it. `sessionStorage` rather than a module variable
     * because `window.location.assign` reloads the page, which would reset one.
     */
    const LATCH = 'ss:forbidden-redirected';
    let alreadyTried = false;
    try {
      alreadyTried = window.sessionStorage.getItem(LATCH) === '1';
    } catch {
      // Private mode or blocked storage: fall back to redirecting, since one
      // extra hop is better than never recovering a genuinely stale session.
    }

    if (!alreadyTried && !window.location.pathname.startsWith(SIGN_IN_URL)) {
      try {
        window.sessionStorage.setItem(LATCH, '1');
      } catch {
        /* see above */
      }
      window.location.assign(SIGN_IN_URL);
    }
  }

  /**
   * A tool the server does not have.
   *
   * Some tools are registered only when their vendor is configured —
   * `analytics.sync` needs an analytics key, `makeTrendInfluencerReview` needs
   * listening access. The API answers `404 NOT_FOUND: "No such tool."`, which is
   * correct and completely unactionable on a screen: it appeared under a Sync
   * button as those four words, which reads as a broken button rather than an
   * unconfigured integration.
   *
   * Rewritten centrally, because the alternative is every caller of a
   * conditionally-registered tool remembering to special-case it — and the ones
   * that forget are exactly the buttons nobody has clicked yet.
   */
  if (code === 'NOT_FOUND' && body && 'error' in body && /no such tool/i.test(body.error?.message ?? '')) {
    return {
      status: 'failed',
      error: {
        code: 'NOT_CONFIGURED',
        message: 'That is not switched on for this workspace yet — it needs an account or a key connected first.',
      },
    };
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
