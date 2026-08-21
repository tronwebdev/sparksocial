import { ToolError } from './types.js';

/**
 * Runs a third-party API call and replaces anything it throws with a sentence.
 *
 * Seven call sites reached a vendor SDK directly — the crawl interpreter, the
 * captioner (three paths), the copy writer, the brief writer, the reply writer,
 * the engagement classifier and the agent loop. Every one of them handled a
 * *bad response* carefully ("returned no text", "returned an unusable shape")
 * and none of them handled a *thrown* error, so an SDK exception propagated
 * with its `message` still set to the vendor's raw response body.
 *
 * `ToolError.message` is rendered verbatim by the UI, which is right for every
 * error this system writes itself. So a disabled vendor account put
 *
 *   400 {"type":"error","error":{"type":"invalid_request_error",
 *        "message":"This organization has been disabled."},"request_id":"req_…"}
 *
 * on the Assets Library page, under a heading offering to caption the file.
 * Found twice by looking at the screen — once on the onboarding crawl, once on
 * upload — which is the tell that it was never one bug.
 *
 * The vendor's own wording is the diagnostic that matters, so it is kept: on
 * the log line, and in `detail` on the error, where the audit row and Sentry
 * can both see it. What it never does is reach the person who was trying to
 * add a photo.
 *
 * Deliberately SDK-agnostic — a thunk, not an Anthropic client — so the
 * transcription, embedding, avatar and voice clients can use the same helper
 * without this module depending on any of their SDKs.
 *
 * @param humanMessage What went wrong and what to do, in the product's voice.
 *   It is shown to a person, so name the thing they were doing rather than the
 *   service that failed.
 */
export async function callVendor<T>(
  vendor: string,
  humanMessage: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (e) {
    /**
     * A `ToolError` thrown from inside the thunk is ours, already worded for a
     * person, and passes straight through. Without this, wrapping a call that
     * already validated its own response would overwrite a precise message
     * ("the reply writer returned an unusable shape") with a generic one.
     */
    if (e instanceof ToolError) throw e;

    const detail = e instanceof Error ? e.message : String(e);
    console.warn(`[warn] ${vendor} call failed`, { detail });
    throw new ToolError('UPSTREAM_FAILED', humanMessage, { vendor, detail });
  }
}
