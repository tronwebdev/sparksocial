import { describe, expect, it, vi } from 'vitest';
import { keyFromUrl, mightHaveMediaUrls, refreshMediaUrls } from '../src/media-urls.js';

/**
 * Generated media is stored as the presigned URL it was uploaded with.
 *
 * So a carousel rendered last month shows six broken images, and nothing in
 * the product says why — the row is fine, the URL in it stopped working. The
 * key is recoverable from the stored URL, which is what makes repairing it on
 * the way out possible without a migration, and what makes it work for rows
 * written long before this existed.
 */
const HOST = 'f2a2ad8045e04105da0e9db0d60da5bf.r2.cloudflarestorage.com';
const BUCKET = 'sparksocial-assets';
const stored = (key: string) => `https://${HOST}/${BUCKET}/${key}?X-Amz-Expires=604800&X-Amz-Signature=dead`;

function store(readUrl = vi.fn(async (key: string) => `https://${HOST}/${BUCKET}/${key}?fresh=1`)) {
  return { readUrl, presignUpload: vi.fn(), put: vi.fn() } as never;
}

describe('finding our own objects', () => {
  it('reads the key out of a presigned url', () => {
    expect(keyFromUrl(stored('org_1/gen_1/2026/10/a.png'), HOST, BUCKET)).toBe('org_1/gen_1/2026/10/a.png');
  });

  /*
   * Somebody else's object with somebody else's expiry. Minting a signature
   * for it produces a URL that is wrong rather than one that is stale, and the
   * real fix for those is copying the media into our bucket at ingest.
   */
  it('leaves another vendor alone', () => {
    expect(keyFromUrl('https://v3.fal.media/files/abc.mp4', HOST, BUCKET)).toBeUndefined();
    expect(keyFromUrl('https://other.r2.cloudflarestorage.com/x/y.png', HOST, BUCKET)).toBeUndefined();
  });

  it('is not fooled by a different bucket on the same host', () => {
    expect(keyFromUrl(`https://${HOST}/other-bucket/a.png`, HOST, BUCKET)).toBeUndefined();
  });

  it('shrugs at a string that is not a url', () => {
    expect(keyFromUrl('not a url', HOST, BUCKET)).toBeUndefined();
  });
});

describe('rewriting a response', () => {
  it('refreshes urls wherever they are nested', async () => {
    const out = await refreshMediaUrls(
      {
        renders: [{ url: stored('a.png') }, { url: stored('b.png') }],
        beats: [{ kind: 'text', backdrop: { urls: [stored('c.png')] } }],
      },
      { store: store(), host: HOST, bucket: BUCKET },
    );

    const json = JSON.stringify(out);
    expect(json).not.toContain('X-Amz-Signature=dead');
    expect(json).toContain('fresh=1');
  });

  it('signs each key once however often it appears', async () => {
    const readUrl = vi.fn(async (key: string) => `https://${HOST}/${BUCKET}/${key}?fresh=1`);
    await refreshMediaUrls(
      { a: stored('same.png'), b: stored('same.png'), c: stored('same.png') },
      { store: store(readUrl), host: HOST, bucket: BUCKET },
    );

    expect(readUrl).toHaveBeenCalledTimes(1);
  });

  /*
   * This runs on the success path of every call in the product. A stale URL is
   * worse than a fresh one and far better than a missing field.
   */
  it('keeps the original when signing fails', async () => {
    const readUrl = vi.fn(async () => {
      throw new Error('storage down');
    });
    const out = await refreshMediaUrls({ url: stored('a.png') }, { store: store(readUrl), host: HOST, bucket: BUCKET });

    expect((out as { url: string }).url).toBe(stored('a.png'));
  });

  it('leaves a body with no media untouched', () => {
    expect(mightHaveMediaUrls({ campaigns: [{ name: 'October' }] }, HOST)).toBe(false);
    expect(mightHaveMediaUrls({ url: stored('a.png') }, HOST)).toBe(true);
  });
});
