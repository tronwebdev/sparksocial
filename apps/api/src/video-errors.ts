import { ToolError } from '@sparksocial/shared';

/**
 * A vendor's HTTP failure, said twice: once for the person who pressed the
 * button and once for whoever has to fix it.
 *
 * The same split `imageUnavailable` makes in `image-client.ts`, and video
 * needed it for a reason image did not: with two providers behind
 * `withFallback`, the error that reaches a user is always the *primary's*. So
 * "both vendors are down" is reported in fal's words, and those words were
 * `Video generation request failed (403)` — a number, for the one failure an
 * owner can actually act on.
 *
 * `vendor` names the provider in the operator half only. A customer does not
 * need to know which of two video vendors we buy from; an operator reading a
 * log needs to know which account to top up.
 */
export function videoUnavailable(vendor: string, status: number, detail: string): ToolError {
  const body = detail.toLowerCase();
  const outOfCredit = status === 403 || /exhausted|balance|locked|quota|credit/.test(body);
  const badKey = status === 401;
  /*
   * ── Why a 400 can be a rate limit ──────────────────────────────────────
   *
   * Higgsfield's concurrency cap does not come back as 429. It comes back as
   * **400 Bad Request** with `{"detail":"Maximum number of concurrent requests
   * (4) has been reached"}`, and their docs say there are no `Retry-After` or
   * rate-limit headers to read instead.
   *
   * That matters for us specifically: a post is several beats and
   * `autoIllustrate` can have several clips in flight, so four concurrent
   * requests is a number this pipeline reaches on one ordinary post — not an
   * abuse case. Classified as a request error it reads as "your prompt was
   * wrong" and stops; classified as busy it reads as "wait a minute", which is
   * both true and actionable.
   *
   * Reading the message to decide is exactly what the vendor's docs advise
   * against ("do not parse human-readable messages to make permanent business
   * decisions"), and they are right about *permanent* decisions. This is not
   * one: it picks a sentence and a retry hint. If they change the wording the
   * failure mode is the generic message we would have shown anyway, which is
   * why the status code still has to match as well.
   */
  const atConcurrency = status === 400 && /concurrent/.test(body);
  const rateLimited = status === 429 || atConcurrency;
  /*
   * 423 and 503 are Higgsfield's, and they are not failures of ours or of the
   * account: a model can be temporarily blocked or simply not ready. They are
   * worth their own sentence because "try again shortly" is true for them and
   * misleading for an exhausted balance.
   */
  const modelDown = status === 423 || status === 503;

  const message = outOfCredit
    ? 'Video generation is paused because the video service has run out of credit. Nothing is wrong with ' +
      'what you entered — upload a clip instead, or try again once it is topped up.'
    : badKey
      ? 'Video generation is not configured correctly, so nothing could be made. This is our side, not yours.'
      : rateLimited
        ? 'Video generation is busy right now. Wait a minute and try again, or upload a clip instead.'
        : modelDown
          ? 'The video model is unavailable at the moment. Try again in a few minutes, or upload a clip instead.'
          : 'Video generation did not work just now. Try again shortly, or upload a clip instead.';

  const operator = outOfCredit
    ? `${vendor} returned ${status}: the account is out of credit or locked. Top up with ${vendor}; the key is otherwise fine.`
    : badKey
      ? `${vendor} rejected the API key. Check the key, and that it is not revoked.`
      : rateLimited
        ? atConcurrency
          ? `${vendor} refused this as over the account's concurrency cap (it returns 400, not 429, and sends no Retry-After). ` +
            'Let a clip finish before starting another, or raise the limit in their console.'
          : `${vendor} rate-limited this account. Back off, or raise the plan limit.`
        : modelDown
          ? `${vendor} reported the model as blocked or not ready (${status}). Pick another model or wait.`
          : `${vendor} returned ${status}: ${detail.slice(0, 200)}`;

  return new ToolError('UPSTREAM_FAILED', message, { vendor, status, operator, detail: detail.slice(0, 200) });
}
