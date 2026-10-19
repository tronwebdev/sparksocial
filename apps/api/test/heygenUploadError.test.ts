import { describe, expect, it } from 'vitest';
import { heygenUploadError } from '../src/avatar-client.js';

/**
 * The message a failed avatar upload shows.
 *
 * Every assertion here comes from one live response. Onboarding was showing
 * "HeyGen rejected the photo (400)" and the body behind it was
 *
 *     {"code": 400133, "message": "Insufficient credit.
 *      This operation requires 'api' credits."}
 *
 * The photo was fine. The account was out of credit.
 */

const CREDIT_BODY = JSON.stringify({
  code: 400133,
  message: "Insufficient credit. This operation requires 'api' credits.",
});

describe('a billing failure is not the photo’s fault', () => {
  it('does not blame the photo', () => {
    const err = heygenUploadError(400, CREDIT_BODY);
    expect(err.message).not.toMatch(/photo could not be used|rejected the photo/i);
    expect(err.message).toMatch(/nothing is wrong with your photo/i);
  });

  it('tells the customer what they can do, which is carry on', () => {
    expect(heygenUploadError(400, CREDIT_BODY).message).toMatch(/set an avatar afterwards/i);
  });

  it('keeps the vendor’s own words for the operator, not the customer', () => {
    const err = heygenUploadError(400, CREDIT_BODY);
    expect(String(err.meta?.operator)).toMatch(/Insufficient credit/);
    expect(err.message).not.toMatch(/credit/i);
  });

  /*
   * The numeric code is undocumented, so the text is matched too. Either
   * alone would still catch this; relying only on the number would fail
   * silently the day HeyGen renumbers it.
   */
  it('still recognises the billing case if the code changes but the words do not', () => {
    const body = JSON.stringify({ code: 999999, message: 'Insufficient credit for this operation.' });
    expect(heygenUploadError(400, body).message).toMatch(/nothing is wrong with your photo/i);
  });
});

describe('the cases that really are about the image', () => {
  it('names HeyGen’s actual requirement, which is the actionable part', () => {
    const err = heygenUploadError(400, JSON.stringify({ code: 400112, message: 'no face detected' }));
    expect(err.message).toMatch(/one clearly visible face/i);
    expect(err.message).toMatch(/200x200/);
  });
});

describe('everything else is separated by what the reader should do', () => {
  it('reads an auth failure as configuration', () => {
    expect(heygenUploadError(401, '').message).toMatch(/not configured/i);
  });

  it('marks a 429 as rate limited rather than upstream-failed', () => {
    expect(heygenUploadError(429, '').code).toBe('RATE_LIMITED');
  });

  it('asks the reader to wait on a 5xx', () => {
    expect(heygenUploadError(503, '').message).toMatch(/try again shortly/i);
  });

  it('survives a non-JSON body without losing it', () => {
    const err = heygenUploadError(400, '<html>Bad Request</html>');
    expect(String(err.meta?.operator)).toMatch(/Bad Request/);
  });
});
