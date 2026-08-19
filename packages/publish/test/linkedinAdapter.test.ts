import { describe, expect, it, vi } from 'vitest';
import { PublishError } from '../src/adapter.js';
import { createLinkedInAdapter } from '../src/native/linkedinAdapter.js';
import { joinScopedToken } from '../src/native/scopedToken.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const req = {
  platform: 'linkedin' as const,
  text: 'the fade finishing',
  mediaUrls: ['https://cdn/img.png'],
  idempotencyKey: 'item_1:linkedin',
  accessToken: joinScopedToken('urn:li:person:abc', 'tok_xyz'),
};

function mockThreeStepSuccess() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('registerUpload')) {
      return json({
        value: {
          asset: 'urn:li:digitalmediaAsset:MEDIA1',
          uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: 'https://upload.linkedin/put' } },
        },
      });
    }
    if (u === 'https://upload.linkedin/put') {
      expect(init!.method).toBe('PUT');
      return new Response(null, { status: 201 });
    }
    if (u.endsWith('/ugcPosts')) return json({}, 201, { 'x-restli-id': 'urn:li:share:999' });
    // Any other url is the "fetch our own media to re-upload" step.
    return new Response(new Uint8Array([1, 2, 3]).buffer);
  });
}

describe('publish — three-step flow with media', () => {
  it('registers an upload, PUTs the fetched bytes, then posts referencing the asset', async () => {
    const f = mockThreeStepSuccess();
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });

    const receipt = await adapter.publish(req);

    const registerCall = f.mock.calls.find((c) => String(c[0]).includes('registerUpload'))!;
    const registerBody = JSON.parse((registerCall[1] as RequestInit).body as string);
    expect(registerBody.registerUploadRequest.owner).toBe('urn:li:person:abc');
    expect(registerBody.registerUploadRequest.recipes).toEqual(['urn:li:digitalmediaRecipe:feedshare-image']);

    const postCall = f.mock.calls.find((c) => String(c[0]).endsWith('/ugcPosts'))!;
    const postBody = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(postBody.author).toBe('urn:li:person:abc');
    expect(postBody.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory).toBe('IMAGE');
    expect(postBody.specificContent['com.linkedin.ugc.ShareContent'].media).toEqual([{ status: 'READY', media: 'urn:li:digitalmediaAsset:MEDIA1' }]);

    expect(receipt).toMatchObject({ platform: 'linkedin', externalId: 'urn:li:share:999', via: 'native:linkedin' });
  });

  it('uses the video recipe and shareMediaCategory for a .mp4 url', async () => {
    const f = mockThreeStepSuccess();
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.publish({ ...req, mediaUrls: ['https://cdn/clip.mp4'] });
    const registerCall = f.mock.calls.find((c) => String(c[0]).includes('registerUpload'))!;
    expect(JSON.parse((registerCall[1] as RequestInit).body as string).registerUploadRequest.recipes).toEqual([
      'urn:li:digitalmediaRecipe:feedshare-video',
    ]);
  });
});

describe('publish — text only, no media step', () => {
  it('skips registerUpload entirely and posts shareMediaCategory NONE', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith('/ugcPosts')) return json({}, 201, { 'x-restli-id': 'urn:li:share:1' });
      throw new Error(`unexpected url ${String(url)}`);
    });
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.publish({ ...req, mediaUrls: [] });
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory).toBe('NONE');
    expect(body.specificContent['com.linkedin.ugc.ShareContent']).not.toHaveProperty('media');
  });
});

describe('failure handling', () => {
  it('refuses without an accessToken', async () => {
    const adapter = createLinkedInAdapter();
    const err = await adapter.publish({ ...req, accessToken: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(false);
  });

  it('refuses when the scoped token has no author urn', async () => {
    const adapter = createLinkedInAdapter();
    const err = await adapter.publish({ ...req, accessToken: 'bare_token_no_colon_prefix_ok' }).catch((e: unknown) => e);
    // splitScopedToken with no ':' returns ['', wholeString] — id empty means refuse.
    expect(err).toBeInstanceOf(PublishError);
  });

  it('surfaces a registerUpload failure classified by status', async () => {
    const f = vi.fn(async () => new Response('bad', { status: 401 }));
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(false);
  });

  it('surfaces a ugcPosts failure and treats a 429 as retryable', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('registerUpload')) {
        return json({
          value: { asset: 'urn:li:digitalmediaAsset:M1', uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: 'https://upload.linkedin/put' } } },
        });
      }
      if (u === 'https://cdn/img.png') return new Response(new Uint8Array([1]).buffer);
      if (u === 'https://upload.linkedin/put') return new Response(null, { status: 201 });
      return new Response('slow down', { status: 429 });
    });
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('refuses when ugcPosts succeeds but has no x-restli-id header', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/ugcPosts')) return json({}, 201);
      throw new Error('unexpected');
    });
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish({ ...req, mediaUrls: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
  });
});

describe('delete', () => {
  it('DELETEs the urn, bearer-authorized with the token passed to delete', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
    const adapter = createLinkedInAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.delete!('urn:li:share:999', 'linkedin', 'tok_xyz');
    expect(f.mock.calls[0]![0]).toBe(`https://api.linkedin.com/v2/ugcPosts/${encodeURIComponent('urn:li:share:999')}`);
    expect(((f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer tok_xyz');
  });

  it('refuses without a token', async () => {
    const adapter = createLinkedInAdapter();
    const err = await adapter.delete!('urn:li:share:999', 'linkedin').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
  });
});

describe('registry contract', () => {
  it('supports only linkedin', () => {
    const adapter = createLinkedInAdapter();
    expect(adapter.supports('linkedin')).toBe(true);
    expect(adapter.supports('x')).toBe(false);
  });

  it('names itself distinctly', () => {
    expect(createLinkedInAdapter().name).toBe('native:linkedin');
  });
});
