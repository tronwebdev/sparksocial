/**
 * The `spark_genome` cookie — the one piece of tenancy state the browser holds.
 *
 * Four files parsed this cookie with their own regex and two wrote it with their
 * own `document.cookie` string. That is why the bug below survived: the rule it
 * needed had nowhere to live.
 *
 * ── The bug: a second account could not use the same browser ──────────────
 *
 * The cookie carried a bare genome id with a one-year `max-age`, and nothing
 * cleared it on sign-out — Clerk clears its own cookies, not ours. So:
 *
 *   1. Someone signs in, onboards. Cookie holds `gen_A`, from org A.
 *   2. They sign out. The cookie survives, for a year.
 *   3. They sign up as a different person, in org B, and start onboarding.
 *   4. The proxy forwards `x-genome-id: gen_A`. `clerk-auth.ts` looks it up
 *      against org B, does not find it, and refuses —
 *      *"That genome is not in your organization."*
 *
 * Every tool call in the new session failed, including the first step of
 * onboarding. The API was right to refuse: that check is CLAUDE.md invariant 2
 * and weakening it is not on the table. What was wrong is that the browser kept
 * asserting a claim it had no business making any more.
 *
 * ── The fix: the cookie records which org it was chosen in ────────────────
 *
 * The value is `<orgId>~<genomeId>`. The proxy compares the recorded org against
 * the org Clerk verified for *this* request and forwards the claim only when they
 * match. A cookie from another org is dropped rather than sent, so the API is
 * never asked a question whose answer must be no.
 *
 * This is not the proxy validating the genome — it still does not do that, and
 * `clerk-auth.ts` remains the only gate. It is the proxy declining to forward a
 * claim it can already see belongs to a different session. If this comparison
 * were removed tomorrow the system would still be *safe*; it would merely be
 * broken again in the way described above.
 *
 * A cookie written before this change has no `~` and therefore no org. It is
 * treated as belonging to no org and dropped, which self-heals the moment a brand
 * is selected — the alternative, honouring it, is the bug.
 */

export const GENOME_COOKIE = 'spark_genome';

/**
 * The one browser global this module touches, declared rather than imported.
 *
 * `apps/web`'s own tsconfig has the DOM lib; the *root* one deliberately does not
 * — it also governs `packages/db` and `apps/api`, where a `document` in scope
 * would be a bug rather than a convenience. This module has to be readable from
 * both programs, because the two proxy routes need its pure half and
 * `apps/api/test/selected-genome.test.ts` is where its rules are checked. Naming
 * the shape is the same move `packages/genome/src/crawl.ts` makes for the globals
 * inside `page.evaluate`.
 */
declare const document: { cookie: string } | undefined;

/** A year. The cookie is a preference, not a session artefact — but see `clearSelectedGenome`. */
const MAX_AGE_SEC = 60 * 60 * 24 * 365;

/**
 * `~` because it appears in neither a Clerk org id (`org_2ab…`) nor a genome id
 * (`gen_…`), and because it needs no percent-encoding in a cookie value.
 */
const SEP = '~';

export interface GenomeClaim {
  /** Absent for a cookie written before this format existed. */
  orgId?: string;
  genomeId: string;
}

/** Parse a raw (still URL-encoded) cookie value. */
export function parseGenomeCookie(raw: string | undefined): GenomeClaim | undefined {
  if (!raw) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed value is not a claim. Throwing here would take down whichever
    // request happened to carry it.
    return undefined;
  }
  const at = decoded.indexOf(SEP);
  if (at < 0) return { genomeId: decoded };
  const orgId = decoded.slice(0, at);
  const genomeId = decoded.slice(at + 1);
  if (!genomeId) return undefined;
  return orgId ? { orgId, genomeId } : { genomeId };
}

/** Pull the claim out of a `Cookie:` header — the two proxy routes' entry point. */
export function claimFromCookieHeader(header: string | null | undefined): GenomeClaim | undefined {
  if (!header) return undefined;
  const raw = new RegExp(`(?:^|;\\s*)${GENOME_COOKIE}=([^;]*)`).exec(header)?.[1];
  return parseGenomeCookie(raw);
}

/**
 * The genome id safe to forward as `x-genome-id` for a request whose verified org
 * is `orgId` — or `undefined`, meaning send no claim at all.
 *
 * Sending nothing is a well-defined state: `clerk-auth.ts` leaves `ctx.genomeId`
 * unset, and every tool that needs one either takes it in its own input or fails
 * with a message about the brand rather than an isolation violation.
 */
export function forwardableGenomeId(
  header: string | null | undefined,
  orgId: string | null | undefined,
): string | undefined {
  const claim = claimFromCookieHeader(header);
  if (!claim || !orgId) return undefined;
  return claim.orgId === orgId ? claim.genomeId : undefined;
}

/** Client-side read, for components that resolve the current selection. */
export function readSelectedGenome(orgId: string | null | undefined): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return forwardableGenomeId(document.cookie, orgId);
}

/**
 * Client-side write. Requires the org, deliberately: a cookie written without one
 * is exactly the cookie that caused the bug, so the type makes it awkward rather
 * than the comment making it discouraged.
 */
export function writeSelectedGenome(orgId: string, genomeId: string): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(`${orgId}${SEP}${genomeId}`);
  // `SameSite=Lax` so it rides same-site navigations but not cross-site
  // requests; not `Secure`, because local dev is http.
  document.cookie = `${GENOME_COOKIE}=${value}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`;
}

/**
 * Drop it on sign-out.
 *
 * Belt to the org comparison's braces. The comparison is what makes the system
 * correct — it holds even for a cookie this never got to clear, such as one left
 * by a session that expired in a closed tab. This just means the stale value does
 * not sit in the browser for a year waiting to be compared.
 */
export function clearSelectedGenome(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${GENOME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
