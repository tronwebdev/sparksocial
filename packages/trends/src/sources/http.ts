/**
 * A bounded, timed-out fetch shared by every real trend source — the same
 * "never let one slow vendor hang the whole call" property `recipe-fetch.ts`
 * enforces for RSS/CSV. Every source in this directory takes an injectable
 * `fetchImpl` for the same reason `recipes`' runners take an injectable
 * `fetchText`: tests exercise the real parsing/mapping logic without a
 * network call.
 */
export async function timedFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
