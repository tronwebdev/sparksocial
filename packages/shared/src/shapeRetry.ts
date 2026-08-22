import { ToolError } from './types.js';

/**
 * One retry when a forced tool call comes back in the wrong shape.
 *
 * ── Why this is a shared policy and not five loops ────────────────────────
 *
 * Five call sites ask a model for a forced tool call and then validate what
 * came back: the copy writer, the brief writer, the reply writer, the
 * engagement classifier and the crawl interpreter. `input_schema` is guidance
 * to the model, not a guarantee from the API, so each of them can receive
 * something that fails validation — and each already threw a precise error
 * saying so.
 *
 * Observed: `direct.session.batch` failed with "the brief writer returned an
 * unusable shape", and the identical call succeeded immediately after. That is
 * a coin-flip, not a verdict. It also got more likely when a second vendor was
 * introduced, because the fallback obeys `input_schema` slightly less reliably
 * than the model the prompts were tuned against.
 *
 * The first fix hand-rolled a two-attempt loop in two of the five. That left an
 * inconsistent policy across near-identical call sites, which is worse than no
 * retry at all: which failures are transient stops being guessable, and the
 * next person copies whichever site they happen to open. Hence one helper.
 *
 * ── What is deliberately not retried ─────────────────────────────────────
 *
 * Only the shape. A vendor being down is already handled a layer below by
 * `callVendor` moving to the second vendor, and retrying that here would
 * multiply attempts against an account that is failing. A response that is
 * well-formed but *bad* — a vague capture brief, an off-brand line — is a
 * judgement call belonging to the validator that owns it (`validateBrief` has
 * its own corrective retry), not to this.
 */

/**
 * Marker for "the model's answer did not match the schema".
 *
 * Wraps the `ToolError` the caller would have thrown, so the retry layer can
 * tell a shape problem from every other failure without inspecting messages,
 * and the error that finally surfaces is the caller's own precise one rather
 * than something this file invented.
 */
export class ShapeMismatch extends Error {
  constructor(readonly detail: ToolError) {
    super(detail.message);
    this.name = 'ShapeMismatch';
  }
}

/**
 * Runs `attempt`, retrying only a `ShapeMismatch`, and surfacing the caller's
 * own `ToolError` if the last attempt still fails.
 *
 * Two attempts by default: one retry absorbs a coin-flip, and a second failure
 * is signal worth showing rather than something to grind against.
 */
export async function withShapeRetry<T>(attempt: () => Promise<T>, attempts = 2): Promise<T> {
  let last: ShapeMismatch | undefined;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof ShapeMismatch)) throw e;
      last = e;
      if (i < attempts) {
        // Worth a line: a run that quietly retried twice and a run that
        // succeeded first time otherwise look identical in the logs, which
        // hides a vendor getting steadily worse at following a schema.
        console.warn('[warn] model returned an unusable shape — retrying once', {
          detail: e.message.slice(0, 200),
        });
      }
    }
  }

  throw last?.detail ?? new ToolError('UPSTREAM_FAILED', 'The model returned an unusable shape.');
}
