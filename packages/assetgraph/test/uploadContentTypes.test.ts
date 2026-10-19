import { describe, expect, it } from 'vitest';
import { AssetUploadUrlInput, makeAssetUploadUrl } from '../src/upload.js';

/**
 * `asset.upload_url`'s content-type allowlist.
 *
 * The regression this guards: two screens have uploaded knowledge PDFs through
 * this tool since they were written — onboarding's "Upload company Docs" step
 * and Settings' knowledge panel — and the allowlist did not include
 * `application/pdf`, so both failed at the input schema with
 *
 *     contentType: Invalid enum value. Expected 'image/jpeg' | … ,
 *     received 'application/pdf'
 *
 * A PDF is not media and never reaches the Finish pipeline: this tool only
 * presigns, nothing enters the Asset Graph until `asset.ingest_url` is called
 * with a role, and `brand.knowledge.attach_document` reads the PDF into text
 * chunks instead. The allowlist still has to name it, because the schema is
 * what decides whether the upload can start at all.
 */

const base = { genomeId: 'g1', filename: 'policy.pdf', sizeBytes: 1024 };

describe('asset.upload_url content types', () => {
  it('accepts a knowledge PDF, which two screens have always sent', () => {
    const parsed = AssetUploadUrlInput.safeParse({ ...base, contentType: 'application/pdf' });
    expect(parsed.success).toBe(true);
  });

  it('still accepts the media the Finish pipeline handles', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'video/mp4', 'audio/mpeg'] as const) {
      expect(AssetUploadUrlInput.safeParse({ ...base, contentType }).success).toBe(true);
    }
  });

  /*
   * The browser recorder, which could not upload anything at all.
   *
   * `MediaRecorder` produces WebM/Opus in Chrome and Firefox and reports it as
   * `audio/webm;codecs=opus`. Two separate reasons that failed: `audio/webm`
   * was not on the list (though `video/webm` was), and the codec parameter is
   * part of a well-formed media type that `z.enum` compares as an opaque
   * string. Both halves are needed — fixing either alone leaves the control
   * broken.
   */
  it('accepts what the browser recorder actually produces, codec parameter and all', () => {
    const parsed = AssetUploadUrlInput.safeParse({ ...base, contentType: 'audio/webm;codecs=opus' });
    expect(parsed.success).toBe(true);
    // Normalised, so one spelling reaches storage.
    expect(parsed.success && parsed.data.contentType).toBe('audio/webm');
  });

  it('accepts the bare recorder types too', () => {
    for (const contentType of ['audio/webm', 'audio/ogg'] as const) {
      expect(AssetUploadUrlInput.safeParse({ ...base, contentType }).success).toBe(true);
    }
  });

  it('normalises case and spacing, which are legal in a media type', () => {
    const parsed = AssetUploadUrlInput.safeParse({ ...base, contentType: 'IMAGE/PNG; charset=binary' });
    expect(parsed.success && parsed.data.contentType).toBe('image/png');
  });

  it('is still an allowlist, not a free-for-all', () => {
    // The whole point of the enum: the container must not become general file
    // hosting for whatever a caller names.
    for (const contentType of ['application/zip', 'text/html', 'application/x-msdownload',
      // Stripping parameters must not become a way past the list.
      'application/zip;codecs=none']) {
      expect(AssetUploadUrlInput.safeParse({ ...base, contentType }).success).toBe(false);
    }
  });
});

/**
 * The signed content type has to reach the client.
 *
 * Normalising `audio/webm;codecs=opus` down to `audio/webm` fixed the input
 * schema and created a worse bug one layer down: S3 and R2 sign `content-type`
 * into the presigned URL, so a browser echoing its own unnormalised string
 * gets `SignatureDoesNotMatch`. That is a 403 carrying no CORS headers, which
 * a browser reports as a CORS error next to a drop zone — the exact failure
 * this repo already spent a day on once.
 *
 * So the tool hands back the type it signed, and `uploadToStorage` spreads the
 * returned headers *after* the caller's own so this one wins.
 */
describe('asset.upload_url returns the type it signed', () => {
  const store = {
    presignUpload: async ({ key, contentType }: { key: string; contentType: string }) => ({
      uploadUrl: `https://bucket.test/${key}?sig`,
      readUrl: `https://bucket.test/${key}`,
      key,
      expiresAt: new Date('2026-10-19T12:00:00Z'),
      requiredHeaders: { 'if-none-match': '*' },
      signedContentType: contentType,
    }),
  };

  const ctx = {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as Parameters<ReturnType<typeof makeAssetUploadUrl>['handler']>[1];

  /*
   * Parsed through the schema first, because that is what production does:
   * `invoke.ts:208` runs `tool.input.parse(req.input)` and hands the handler
   * the result. Calling `handler` with a raw object skips the normalisation
   * and tests a path no caller takes — which is how the first version of this
   * test "failed" against correct code.
   */
  it('tells the client to send the normalised type, not the one it offered', async () => {
    const tool = makeAssetUploadUrl(store as never);
    const input = AssetUploadUrlInput.parse({
      genomeId: 'gen_1',
      filename: 'recording.webm',
      contentType: 'audio/webm;codecs=opus',
      sizeBytes: 2048,
    });
    const out = await tool.handler(input, ctx);

    expect(out.headers['content-type']).toBe('audio/webm');
  });

  it('still passes through the store’s own required headers', async () => {
    const tool = makeAssetUploadUrl(store as never);
    const out = await tool.handler(
      { genomeId: 'gen_1', filename: 'a.png', contentType: 'image/png', sizeBytes: 10 },
      ctx,
    );

    expect(out.headers['if-none-match']).toBe('*');
    expect(out.headers['content-type']).toBe('image/png');
  });
});
