/**
 * TURNING A TOOL ERROR INTO A SENTENCE A PERSON CAN ACT ON.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * 232 places in this app render `res.error.message` straight onto the screen.
 * Most of the time that message was written for a person and reads fine — the
 * crawl failures, the guardrail refusals, the brand-delete confirmation are
 * all deliberate copy. The rest of the time it is machine text, and the owner
 * gets things like:
 *
 *   brandFonts.display: Invalid enum value. Expected 'inter' | 'dm_sans' | …,
 *   received 'Asgard Trial'
 *
 *   The inference pass returned an unusable shape.
 *
 *   Failed query: insert into "renders" ("id", "org_id", …
 *
 * Each of those is a true statement about our code and nothing a reader can do
 * anything with. Two of them are real bugs fixed elsewhere; the third is a
 * class, and the class needs a filter.
 *
 * ── Why it detects machine text rather than recognising human text ───────
 *
 * The obvious design is a whitelist: a flag on `ToolError` saying "this one is
 * for a person". It was rejected because it fails in the wrong direction. A
 * message nobody remembered to flag would be shown raw — the exact failure
 * this exists to stop — and the flag would have to be added to every tool,
 * forever, by people who are not thinking about copy at the time.
 *
 * So the test runs the other way: **a message is shown unless it looks like
 * machine output**, and a false positive costs a slightly more generic
 * sentence rather than a Zod dump. The signals are things prose does not
 * contain — SQL fragments, stack frames, `errno` codes, Zod's own phrasing,
 * `undefined`, a dotted.path followed by a colon.
 *
 * ── The technical text is kept, not thrown away ──────────────────────────
 *
 * `detail` carries the original. Hiding it entirely would make support harder
 * than the raw message ever made the product: a caller can put it behind a
 * "Details" toggle or a `title`, which is where it belongs — available to
 * somebody looking for it and not in the face of somebody who is not.
 */

export interface ToolErrorShape {
  code: string;
  message: string;
}

export interface UserFacingError {
  /** Shown on screen. Always a complete sentence, always actionable or honest. */
  message: string;
  /** The original, when it was replaced. Absent when the message *is* the original. */
  detail?: string;
}

/**
 * What each code means to somebody who did not write the code.
 *
 * Only used when the message itself is unusable — a tool that explained
 * itself well keeps its own words, because it knows more about the situation
 * than a code does.
 */
const BY_CODE: Record<string, string> = {
  FORBIDDEN: 'You do not have permission to do that.',
  NO_ORG: 'Finish choosing a workspace and try again.',
  NEEDS_APPROVAL: 'That needs approval before it can run — it is waiting in the review queue.',
  NEEDS_CONFIRMATION: 'That needs confirming before it can run.',
  GUARDRAIL_BLOCKED: 'That was stopped by a brand safety rule.',
  BUDGET_EXCEEDED: 'There is not enough credit left this month to do that.',
  RATE_LIMITED: 'That service is busy. Wait a moment and try again.',
  NOT_FOUND: 'That is no longer there.',
  INVALID_INPUT: 'Something in that form was not accepted. Check the fields and try again.',
  UPSTREAM_FAILED: 'Something we depend on did not respond properly. Try again in a moment.',
  ISOLATION_VIOLATION: 'That belongs to a different brand.',
};

const FALLBACK = 'Something went wrong. Try again, and tell us if it keeps happening.';

/**
 * Signals that a string was written by a machine for a machine.
 *
 * Each one is here because it has actually reached a screen, or because it is
 * one character away from something that has. Kept narrow on purpose: a
 * pattern that matches ordinary prose would start hiding good copy, and good
 * copy is the common case.
 */
const MACHINE_SIGNALS: readonly RegExp[] = [
  /invalid enum value/i,
  /expected .{0,40}, received/i,
  /\bzod\b/i,
  /\bfailed query\b/i,
  /\b(insert into|select .* from|update .* set|delete from)\b/i,
  /\bENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN\b/,
  /\bat [A-Za-z$_][\w$.]*\s*\(/, // a stack frame
  /\b(undefined|null) is not a|cannot read propert/i,
  /\[object \w+\]/,
  /^\s*\w+Error:/,
  /\bunusable shape\b/i,
  /\b[a-z_]+\.[a-z_]+(\.[a-z_]+)*\s*:/i, // `brandFonts.display:` — a field path
  /https?:\/\/\S{80,}/, // a signed URL dumped into prose
];

/** True when the message is machine output rather than something written for a reader. */
export function looksTechnical(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  /*
   * Very long messages are almost always a serialised payload. 400 rather
   * than something tighter because the crawl's `blocked` copy is 300-odd
   * characters of deliberate, useful prose and must survive.
   */
  if (m.length > 400) return true;
  return MACHINE_SIGNALS.some((re) => re.test(m));
}

/**
 * The sentence to show, and the original if it was replaced.
 *
 * `undefined` input is handled because a refused call does not always carry an
 * error object — `status: 'gated'` has none — and every call site would
 * otherwise need its own ternary, which is how the original problem spread.
 */
export function userError(error: ToolErrorShape | undefined, fallback?: string): UserFacingError {
  if (!error) return { message: fallback ?? FALLBACK };

  if (!looksTechnical(error.message)) return { message: error.message };

  return {
    message: BY_CODE[error.code] ?? fallback ?? FALLBACK,
    detail: error.message,
  };
}

/** The message alone, for the many call sites that render a single string. */
export function userMessage(error: ToolErrorShape | undefined, fallback?: string): string {
  return userError(error, fallback).message;
}

/**
 * The whole result, for a caller holding an `invoke` result rather than an
 * error — including the two non-`failed` refusals, which carry no error object
 * and were each being hand-written into a different sentence at every site.
 */
export function resultError(
  res: { status: string; error?: ToolErrorShape },
  fallback?: string,
): UserFacingError {
  if (res.status === 'gated') {
    return { message: fallback ?? 'That needs approval — it is waiting in the review queue.' };
  }
  if (res.status === 'denied') {
    return { message: fallback ?? 'You do not have permission to do that.' };
  }
  return userError(res.error, fallback);
}
