import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '../src/types.js';
import { callVendor } from '../src/vendorCall.js';

/**
 * The bug this exists to stop: a vendor SDK throw carries the raw HTTP body as
 * its `message`, and `ToolError.message` is rendered verbatim by the UI. Two
 * screens were caught printing
 *
 *   400 {"type":"error","error":{...,"message":"This organization has been disabled."}}
 *
 * to a person, one on the onboarding crawl and one on an asset upload.
 */

const RAW = '400 {"type":"error","error":{"type":"invalid_request_error","message":"This organization has been disabled."},"request_id":"req_x"}';

describe('callVendor', () => {
  it('passes a successful result straight through', async () => {
    await expect(callVendor('captioner', 'unused', async () => ({ ok: 1 }))).resolves.toEqual({ ok: 1 });
  });

  it('replaces a raw vendor body with the human message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await callVendor('captioner', 'SPARK could not describe this file.', async () => {
      throw new Error(RAW);
    }).catch((e: unknown) => e);
    warn.mockRestore();

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).message).toBe('SPARK could not describe this file.');
    // The whole point: the vendor's wording is nowhere in what a person reads.
    expect((err as ToolError).message).not.toMatch(/organization has been disabled/);
    expect((err as ToolError).message).not.toMatch(/^\d{3} \{/);
  });

  it('keeps the vendor wording as diagnostic detail, because that is what debugs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = (await callVendor('captioner', 'human', async () => {
      throw new Error(RAW);
    }).catch((e: unknown) => e)) as ToolError;
    warn.mockRestore();

    expect(err.code).toBe('UPSTREAM_FAILED');
    expect(err.meta).toMatchObject({ vendor: 'captioner', detail: RAW });
  });

  it('logs the vendor detail once, so an outage is visible server-side', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await callVendor('inference', 'human', async () => {
      throw new Error(RAW);
    }).catch(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('inference');
    warn.mockRestore();
  });

  it('does not overwrite a ToolError the caller already worded', async () => {
    // The writers validate their own responses ("returned an unusable shape").
    // Those messages are better than anything this wrapper could substitute.
    const precise = new ToolError('UPSTREAM_FAILED', 'The reply writer returned an unusable shape.');
    await expect(
      callVendor('reply writer', 'generic fallback', async () => {
        throw precise;
      }),
    ).rejects.toBe(precise);
  });

  it('handles a thrown non-Error without losing the detail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = (await callVendor('captioner', 'human', async () => {
      throw 'socket hang up';
    }).catch((e: unknown) => e)) as ToolError;
    warn.mockRestore();
    expect(err.meta).toMatchObject({ detail: 'socket hang up' });
  });
});
