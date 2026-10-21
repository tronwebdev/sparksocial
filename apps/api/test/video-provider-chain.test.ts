import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { buildVideoClient } from '../src/video-client.js';
import { withFallback } from '../src/vendor-fallback.js';

/**
 * Which video vendor gets used, and when the second one gets a turn.
 *
 * `buildVideoClient`'s own job is thin — read two sets of keys, decide what to
 * hand back — and the clients themselves are covered in their own files. What
 * is worth testing here is the selection, because the failure mode it guards
 * against has already happened twice in this codebase: a provider written,
 * tested, and never actually reached, because the thing that was supposed to
 * call it did not.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provider selection', () => {
  it('registers nothing when neither vendor is configured', () => {
    vi.stubEnv('FAL_API_KEY', '');
    vi.stubEnv('HIGGSFIELD_KEY_ID', '');
    vi.stubEnv('HIGGSFIELD_KEY_SECRET', '');

    // Undefined is what stops `content.generate_broll` being registered at all,
    // which is the difference between a missing button and a broken one.
    expect(buildVideoClient()).toBeUndefined();
  });

  it('runs on Higgsfield alone when fal is unset', () => {
    vi.stubEnv('FAL_API_KEY', '');
    vi.stubEnv('HIGGSFIELD_KEY_ID', 'id');
    vi.stubEnv('HIGGSFIELD_KEY_SECRET', 'secret');

    expect(buildVideoClient()).toBeDefined();
  });

  it('runs on fal alone when Higgsfield is unset', () => {
    vi.stubEnv('FAL_API_KEY', 'k');
    vi.stubEnv('HIGGSFIELD_KEY_ID', '');
    vi.stubEnv('HIGGSFIELD_KEY_SECRET', '');

    expect(buildVideoClient()).toBeDefined();
  });

  it('treats half a Higgsfield credential as none of one', () => {
    // A key id without its secret is a typo, not a degraded setup: the only
    // thing it can produce is a 401 on the day fal runs out.
    vi.stubEnv('FAL_API_KEY', '');
    vi.stubEnv('HIGGSFIELD_KEY_ID', 'id');
    vi.stubEnv('HIGGSFIELD_KEY_SECRET', '');

    expect(buildVideoClient()).toBeUndefined();
  });
});

/**
 * The chain itself, against the two clients rather than the env, because this
 * is the behaviour the request was for: Higgsfield picks up where fal leaves
 * off, and only for the failures a second vendor could actually fix.
 */
describe('fal, then Higgsfield', () => {
  const args = { prompt: 'a kiln firing', aspectRatio: '9:16', durationSec: 6 };

  it('never calls the backup while the primary works', async () => {
    const primary = { generate: vi.fn(async () => ({ url: 'https://fal.example/a.mp4' })) };
    const backup = { generate: vi.fn(async () => ({ url: 'https://hf.example/b.mp4' })) };

    const out = await withFallback('video', primary, backup).generate(args);

    expect(out.url).toBe('https://fal.example/a.mp4');
    expect(backup.generate).not.toHaveBeenCalled();
  });

  it('hands an exhausted balance to Higgsfield', async () => {
    const primary = {
      generate: vi.fn(async () => {
        throw new ToolError('UPSTREAM_FAILED', 'out of credit', { vendor: 'fal', status: 403 });
      }),
    };
    const backup = { generate: vi.fn(async () => ({ url: 'https://hf.example/b.mp4' })) };

    const out = await withFallback('video', primary, backup).generate(args);

    expect(out.url).toBe('https://hf.example/b.mp4');
    expect(backup.generate).toHaveBeenCalledWith(args);
  });

  it('does not ask Higgsfield a question fal refused on content grounds', async () => {
    // A clip is minutes of waiting and tens of cents. Sending a moderated
    // prompt to a second model buys the same refusal, slower and for money.
    const primary = {
      generate: vi.fn(async () => {
        throw new ToolError('GUARDRAIL_BLOCKED', 'refused', {});
      }),
    };
    const backup = { generate: vi.fn(async () => ({ url: 'https://hf.example/b.mp4' })) };

    await expect(withFallback('video', primary, backup).generate(args)).rejects.toMatchObject({
      code: 'GUARDRAIL_BLOCKED',
    });
    expect(backup.generate).not.toHaveBeenCalled();
  });

  it("surfaces fal's error when both are down, not Higgsfield's", async () => {
    // fal's carries the cause anyone would act on; the backup's is usually the
    // second-order one. Both are logged, one is thrown.
    const primary = {
      generate: vi.fn(async () => {
        throw new ToolError('UPSTREAM_FAILED', 'fal is out of credit', { vendor: 'fal' });
      }),
    };
    const backup = {
      generate: vi.fn(async () => {
        throw new ToolError('UPSTREAM_FAILED', 'Higgsfield rejected the API key', { vendor: 'Higgsfield' });
      }),
    };

    await expect(withFallback('video', primary, backup).generate(args)).rejects.toMatchObject({
      message: 'fal is out of credit',
    });
  });
});
