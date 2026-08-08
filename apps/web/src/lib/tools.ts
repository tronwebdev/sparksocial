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

export async function invoke<T>(name: string, input: unknown, idempotencyKey?: string): Promise<ToolResult<T>> {
  const res = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  });

  const body = (await res.json().catch(() => null)) as ToolResult<T> | { error?: { code: string; message: string } } | null;

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
