/**
 * Environment reads that treat **present-but-empty as absent**.
 *
 * `process.env.X ?? fallback` only falls back when the variable is *unset*, and
 * `??` is otherwise the right operator — so this pattern spread through the
 * codebase looking correct. But `.env.example` ships every optional key as
 * `KEY=` with no value, and `--env-file` sets those to `''`. Copy the example
 * to `.env`, which is the documented first step, and every default silently
 * stops applying.
 *
 * The failures are not subtle once you see them, which is what makes this worth
 * a helper rather than a note:
 *
 * - `DEV_SEED_ORG_ID=` seeded the golden set under the org id `''`, so every
 *   genome lookup returned "not found" against a store that contained it.
 *   That is the one that surfaced; the rest were waiting.
 * - `DEV_MONTHLY_CAP_CENTS=` → `Number('')` is **0**, a spend cap of zero, and
 *   every paid tool call denied with `budget.exceeded`.
 * - `PORT=` → `Number('')` is 0, which binds an arbitrary free port. The server
 *   starts, reports success, and nothing can reach it.
 * - `CLERK_AUTHORIZED_PARTIES=` → an empty audience list, which
 *   `makeClerkResolveCtx` refuses to start with. That one at least fails loudly.
 *
 * A missing variable and an empty one mean the same thing to a human writing a
 * config file. Making them mean the same thing to the code removes a class of
 * bug rather than one instance of it.
 */

/** The value, or `fallback` when unset, empty, or whitespace. */
export function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
}

/**
 * The value as a number, or `fallback` when unset, empty, or unparseable.
 *
 * Rejecting `NaN` matters as much as rejecting empty: `Number('two')` is `NaN`,
 * and `NaN` compared against anything is false — so a typo'd cap would not
 * throw, it would make every budget check pass.
 */
export function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[warn] ${name}="${raw}" is not a number — using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/**
 * Whether a credential is actually usable.
 *
 * Every "real client or fake?" seam in this app keys on a key being present,
 * and `KEY=` is present. Without this they all select the real client and fail
 * on the first request with an auth error from the vendor, instead of the local
 * warning that says which variable to set.
 */
export function envSet(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '';
}

/** Comma-separated list, empty entries dropped. */
export function envList(name: string, fallback: string[]): string[] {
  const raw = envStr(name, '');
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
