import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '../src/types.js';
import { ShapeMismatch, withShapeRetry } from '../src/shapeRetry.js';

/**
 * `input_schema` is guidance to the model, not a guarantee from the API. The
 * observed case: `direct.session.batch` failed with "the brief writer returned
 * an unusable shape", and the identical call succeeded immediately after.
 *
 * Five call sites share this policy, which is the point — an inconsistent retry
 * rule across near-identical sites is worse than none, because which failures
 * are transient stops being guessable.
 */

const mismatch = (msg = 'unusable shape') =>
  new ShapeMismatch(new ToolError('UPSTREAM_FAILED', msg, { issues: [] }));

describe('withShapeRetry', () => {
  it('returns the first success without a second call', async () => {
    const attempt = vi.fn(async () => 'first');
    await expect(withShapeRetry(attempt)).resolves.toBe('first');
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('absorbs a single shape mismatch — the coin-flip this exists for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const attempt = vi.fn(async () => {
      if (++n === 1) throw mismatch();
      return 'second';
    });

    await expect(withShapeRetry(attempt)).resolves.toBe('second');
    expect(attempt).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('surfaces the caller’s own error when the retry fails too', async () => {
    // Not a generic message invented here: the writers each say something
    // specific, and that is what should reach the audit row.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await withShapeRetry(async () => {
      throw mismatch('The brief writer returned an unusable shape.');
    }).catch((e: unknown) => e);
    warn.mockRestore();

    expect(err).toBeInstanceOf(ToolError);
    expect(err).not.toBeInstanceOf(ShapeMismatch);
    expect((err as ToolError).message).toBe('The brief writer returned an unusable shape.');
    expect((err as ToolError).code).toBe('UPSTREAM_FAILED');
  });

  it('tries exactly twice by default, not until it works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const attempt = vi.fn(async () => {
      throw mismatch();
    });
    await withShapeRetry(attempt).catch(() => {});
    expect(attempt).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('does not retry anything that is not a shape mismatch', async () => {
    // A vendor being down is handled a layer below by `callVendor` moving to the
    // second vendor. Retrying it here would multiply attempts against an
    // account that is already failing.
    const outage = new ToolError('UPSTREAM_FAILED', 'the vendor is down');
    const attempt = vi.fn(async () => {
      throw outage;
    });

    await expect(withShapeRetry(attempt)).rejects.toBe(outage);
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('lets an ordinary Error through untouched', async () => {
    const bug = new TypeError('someone read a property of undefined');
    await expect(
      withShapeRetry(async () => {
        throw bug;
      }),
    ).rejects.toBe(bug);
  });

  it('logs the retry, so a vendor getting worse at schemas is visible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    await withShapeRetry(async () => {
      if (++n === 1) throw mismatch();
      return 'ok';
    });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/unusable shape/i);
    warn.mockRestore();
  });

  it('honours a higher attempt count when a caller asks for one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const attempt = vi.fn(async () => {
      if (++n < 3) throw mismatch();
      return 'third';
    });

    await expect(withShapeRetry(attempt, 3)).resolves.toBe('third');
    expect(attempt).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
