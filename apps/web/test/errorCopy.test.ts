import { describe, expect, it } from 'vitest';
import { looksTechnical, userError, userMessage, resultError } from '../src/lib/errorCopy';

/**
 * 232 places rendered `res.error.message` straight onto the screen.
 *
 * Most of those messages were written for a person and read fine. The rest
 * were written by Zod, the Postgres driver or `node:fs`, and two of them
 * reached onboarding verbatim:
 *
 *   brandFonts.display: Invalid enum value. Expected 'inter' | … received 'Asgard Trial'
 *   The inference pass returned an unusable shape.
 *
 * The test runs the opposite way round from the obvious design: a message is
 * shown **unless it looks like machine output**. A whitelist fails in the
 * wrong direction — anything nobody remembered to flag is shown raw, which is
 * the failure this exists to stop.
 */
describe('what counts as machine output', () => {
  it('catches the two that reached a customer', () => {
    expect(
      looksTechnical(
        "brandFonts.display: Invalid enum value. Expected 'inter' | 'dm_sans', received 'Asgard Trial'",
      ),
    ).toBe(true);
    expect(looksTechnical('The inference pass returned an unusable shape.')).toBe(true);
  });

  it('catches a leaked query, a stack frame and an errno', () => {
    expect(looksTechnical('Failed query: insert into "renders" ("id", "org_id")')).toBe(true);
    expect(looksTechnical('at Object.handler (/app/packages/x.ts:12:7)')).toBe(true);
    expect(looksTechnical("ENOENT: no such file or directory, open '/app/fonts/x.ttf'")).toBe(true);
  });

  /*
   * The expensive mistake is the other one: replacing copy somebody wrote on
   * purpose. These are real messages from this codebase and all must survive.
   */
  it('leaves real copy alone', () => {
    expect(
      looksTechnical(
        'example.com refused our request — a security filter on the site is blocking automated readers, ' +
          'not anything you did. If the site is yours, allowlisting "SparkSocialBot" with your host or ' +
          'security plugin lets us read it. Either way, you can set your brand up by answering a few questions instead.',
      ),
    ).toBe(false);
    expect(looksTechnical('There is no page at https://example.com/x. Check the address.')).toBe(false);
    expect(looksTechnical('That name does not match. Type “Dishoom” exactly to delete this brand.')).toBe(false);
    expect(looksTechnical('Only an owner can set a spending limit.')).toBe(false);
  });

  it('treats an empty message as unusable', () => {
    expect(looksTechnical('   ')).toBe(true);
  });
});

describe('what the reader is shown', () => {
  it('replaces machine text with the code\u2019s own sentence', () => {
    const out = userError({
      code: 'INVALID_INPUT',
      message: "brandFonts.display: Invalid enum value. Expected 'inter', received 'Asgard Trial'",
    });

    expect(out.message).toBe('Something in that form was not accepted. Check the fields and try again.');
  });

  /*
   * Kept, not thrown away. Hiding it entirely would make support harder than
   * the raw message ever made the product — it belongs behind a toggle, not in
   * somebody's face.
   */
  it('keeps the original as detail', () => {
    const out = userError({ code: 'UPSTREAM_FAILED', message: 'The inference pass returned an unusable shape.' });

    expect(out.detail).toBe('The inference pass returned an unusable shape.');
  });

  it('passes a real sentence through unchanged, with no detail', () => {
    const out = userError({ code: 'NOT_FOUND', message: 'There is no page at that address.' });

    expect(out.message).toBe('There is no page at that address.');
    expect(out.detail).toBeUndefined();
  });

  it('has something to say for a refusal that carries no error', () => {
    expect(userMessage(undefined)).toContain('Something went wrong');
    expect(resultError({ status: 'gated' }).message).toContain('approval');
    expect(resultError({ status: 'denied' }).message).toContain('permission');
  });

  it('prefers a caller\u2019s own fallback to the generic one', () => {
    expect(userMessage(undefined, 'Could not load the calendar.')).toBe('Could not load the calendar.');
  });
});

describe('the proxy’s unreachable-API note', () => {
  it('is replaced — it carries the server address and Node’s "fetch failed"', () => {
    const msg = userMessage({
      code: 'UPSTREAM_FAILED',
      message: 'Could not reach the SparkSocial API at http://localhost:8080. fetch failed',
    });
    expect(msg).not.toMatch(/localhost|fetch failed|SparkSocial API/);
    expect(msg).toMatch(/try again/i);
  });
});
