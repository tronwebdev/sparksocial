import { describe, expect, it } from 'vitest';
import { AssetUploadUrlInput } from '../src/upload.js';

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

  it('is still an allowlist, not a free-for-all', () => {
    // The whole point of the enum: the container must not become general file
    // hosting for whatever a caller names.
    for (const contentType of ['application/zip', 'text/html', 'application/x-msdownload']) {
      expect(AssetUploadUrlInput.safeParse({ ...base, contentType }).success).toBe(false);
    }
  });
});
