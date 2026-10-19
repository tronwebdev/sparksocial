import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { imageUnavailable, withFallback } from '../src/image-client.js';

/**
 * A second image provider, and what a person is told when neither works.
 *
 * The case this exists for: fal answered 403 — out of credit — and the customer
 * pressing "Generate logo" saw `Image generation failed (403).` Retrying fal
 * produces 403 forever, so a different vendor is the only retry that can
 * succeed, and a status code is not something anyone can act on.
 */

const ok = (url: string) => ({ generate: vi.fn(async () => ({ url })) });
const fails = (e: unknown) => ({
  generate: vi.fn(async () => {
    throw e;
  }),
});

const args = { prompt: 'a mark', aspectRatio: '1:1' };

describe('withFallback', () => {
  it('uses the primary and never touches the backup when it works', async () => {
    const primary = ok('https://fal.example/a.png');
    const backup = ok('https://openai.example/b.png');

    const out = await withFallback(primary, backup).generate(args);

    expect(out.url).toBe('https://fal.example/a.png');
    expect(backup.generate).not.toHaveBeenCalled();
  });

  it('falls back when the primary is out of credit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const primary = fails(imageUnavailable(403, 'User is locked. Reason: Exhausted balance.'));
    const backup = ok('https://openai.example/b.png');

    const out = await withFallback(primary, backup).generate(args);

    expect(out.url).toBe('https://openai.example/b.png');
    expect(backup.generate).toHaveBeenCalledWith(args);
    vi.restoreAllMocks();
  });

  /*
   * A blocked or malformed request is about the *request*. Asking a second
   * vendor the same bad question spends money to get the same answer twice as
   * slowly, so only vendor-side failures are worth a second try.
   */
  it('does not retry elsewhere when the request itself is the problem', async () => {
    const primary = fails(new ToolError('GUARDRAIL_BLOCKED', 'claim_grounding', {}));
    const backup = ok('https://openai.example/b.png');

    await expect(withFallback(primary, backup).generate(args)).rejects.toMatchObject({
      code: 'GUARDRAIL_BLOCKED',
    });
    expect(backup.generate).not.toHaveBeenCalled();
  });

  it("surfaces the primary's reason when both fail, because it is the actionable one", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const primary = fails(imageUnavailable(403, 'Exhausted balance.'));
    const backup = fails(new ToolError('UPSTREAM_FAILED', 'The backup image service could not make an image either.', {}));

    await expect(withFallback(primary, backup).generate(args)).rejects.toThrow(/run out of credit/i);
    vi.restoreAllMocks();
  });
});

describe('what the person is told', () => {
  it('explains an exhausted balance without saying "403", and offers the way round it', () => {
    const err = imageUnavailable(403, 'User is locked. Reason: Exhausted balance.');

    expect(err.message).toMatch(/run out of credit/i);
    expect(err.message).toMatch(/upload an image instead/i);
    // The status belongs in the audit row, not in front of somebody making a logo.
    expect(err.message).not.toMatch(/403/);
    expect(String(err.meta?.operator)).toMatch(/top up/i);
  });

  it('separates a bad key from an empty wallet, because the remedies differ', () => {
    expect(imageUnavailable(401, 'unauthorized').message).toMatch(/not configured correctly/i);
    expect(String(imageUnavailable(401, 'unauthorized').meta?.operator)).toMatch(/FAL_API_KEY/);
  });

  it('tells somebody who is rate-limited to wait, rather than to upload', () => {
    expect(imageUnavailable(429, 'slow down').message).toMatch(/busy|wait/i);
  });

  it('reads an exhausted balance out of the body even when the status is not 403', () => {
    expect(imageUnavailable(500, 'Exhausted balance').message).toMatch(/run out of credit/i);
  });
});
