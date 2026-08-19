/**
 * The real network fetch behind `recipe.run`'s `rss`, `bulk_connector` (csv,
 * drive) kinds. Split out from `tools.ts` so it's one small, obviously-honest
 * function: `checkPublicHttpUrl` already ran in `runners.ts` before this is
 * called for any caller-supplied URL — Drive's own URL is always
 * `googleapis.com`, built from our own code, so that check doesn't apply to
 * it. This is deliberately not a second security boundary — just a bounded,
 * timed-out GET.
 */
export async function fetchTextForRecipes(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/*, application/xml, application/rss+xml, application/atom+xml, application/json' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // A recipe source has no business being enormous — cap well above any
    // real feed or spreadsheet export, so a misconfigured URL cannot pin
    // the process reading an unbounded response body.
    const text = await res.text();
    if (text.length > 5_000_000) throw new Error('Response too large (>5MB).');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The `bulk_connector`'s Canva sub-kind — the one caller here that needs an
 * `Authorization: Bearer` header instead of just `Accept`. Every URL this is
 * called with is built by our own code (`api.canva.com`, see
 * `runBulkConnectorCanva`), never a caller-supplied one, so this deliberately
 * skips `checkPublicHttpUrl` the way `fetchTextForRecipes` does for Drive.
 */
export async function fetchWithAuthForRecipes(url: string, bearerToken: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.length > 5_000_000) throw new Error('Response too large (>5MB).');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
