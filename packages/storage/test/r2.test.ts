import { describe, expect, it } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { ToolError } from '@sparksocial/shared/types';
import { createR2BlobStore, storageUnavailable } from '../src/r2.js';

/**
 * R2 — the store that exists so the app can run somewhere without a managed
 * identity (`infra/render/MIGRATION.md` §0.1).
 *
 * The tests here are the places R2 and Azure are *not* the same, because those
 * are the ones a reader will assume carry over and a reviewer will not notice:
 * create-only uploads, the presign ceiling, and what an operator is told when
 * the credentials are wrong.
 */

/**
 * A real `S3Client` with throwaway credentials, not a hand-rolled fake.
 *
 * SigV4 signing is offline — `getSignedUrl` never calls the network — so a real
 * client produces real signed URLs here and the assertions are about the actual
 * output rather than about a stub. Only `send`, which *would* go out, is
 * replaced.
 */
function harness(overrides: { send?: (cmd: unknown) => Promise<unknown> } = {}) {
  const sent: unknown[] = [];
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
  });
  client.send = (overrides.send ??
    (async (cmd: unknown) => {
      sent.push(cmd);
      return {};
    })) as never;
  return { client, sent };
}

const base = {
  accountId: 'acct',
  bucket: 'assets',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
};

describe('R2 blob store', () => {
  it('signs uploads create-only, the way Azure signs with `c` and not `w`', async () => {
    /*
     * The property, not the mechanism. Azure's upload SAS carries create
     * permission so a leaked URL can add an object and never replace one.
     * S3 `PutObject` overwrites by default, so the equivalent has to be a
     * conditional write — without `IfNoneMatch`, a captured upload URL becomes a
     * way to overwrite somebody else's asset in place for as long as it is valid.
     */
    const { client } = harness();
    const store = createR2BlobStore({ ...base, client });
    const out = await store.presignUpload({ key: 'org/gen/2026/10/x.png', contentType: 'image/png' });

    expect(out.uploadUrl).toContain('x.png');
    expect(out.key).toBe('org/gen/2026/10/x.png');
    // The condition travels as a signed header, so it shows up in the URL.
    expect(out.uploadUrl.toLowerCase()).toContain('if-none-match');
  });

  it('clamps a presign window to what SigV4 will accept', async () => {
    /*
     * Azure SAS has no ceiling and S3's is seven days. A caller that asked for
     * longer got a working URL on Azure and a 403 here — at read time, far from
     * the call that caused it. Clamping makes the two behave the same at the
     * boundary instead of diverging in production.
     */
    const { client } = harness();
    const store = createR2BlobStore({ ...base, client });
    const out = await store.presignUpload({
      key: 'k.png',
      contentType: 'image/png',
      ttlSec: 60 * 24 * 3600, // sixty days
    });

    const expires = Number(new URL(out.uploadUrl).searchParams.get('X-Amz-Expires'));
    expect(expires).toBe(7 * 24 * 3600);
    expect(out.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 3600 * 1000 + 1000);
  });

  it('serves reads from the public base URL when one is set, and signs otherwise', async () => {
    // A public bucket makes every key reachable by URL rather than merely
    // listed, so it is opt-in and absent is the safer default.
    const { client } = harness();
    const signed = createR2BlobStore({ ...base, client });
    expect(await signed.readUrl('a/b.png')).toContain('X-Amz-Signature');

    const pub = createR2BlobStore({ ...base, client, publicBaseUrl: 'https://cdn.example.com/' });
    expect(await pub.readUrl('a/b.png')).toBe('https://cdn.example.com/a/b.png');
  });

  it('turns a server-side put into a long-lived read url', async () => {
    // `put` exists for ElevenLabs' TTS bytes, and the URL it returns is read by
    // a draft under review for days — not a minutes-long upload window.
    const { client, sent } = harness();
    const store = createR2BlobStore({ ...base, client });
    const { url } = await store.put({ key: 'v.mp3', contentType: 'audio/mpeg', bytes: new Uint8Array([1, 2]) });

    expect(sent).toHaveLength(1);
    expect(Number(new URL(url).searchParams.get('X-Amz-Expires'))).toBe(7 * 24 * 3600);
  });

  it('reports a credential failure as operator detail, never to the person uploading', async () => {
    const err = storageUnavailable(
      Object.assign(new Error('The AWS Access Key Id you provided does not exist'), { name: 'InvalidAccessKeyId' }),
      'assets',
    );

    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe('STORAGE_UNAVAILABLE');
    // What a brand owner reads: no key names, no bucket policy, and the one
    // thing they need to know — it is not their file.
    expect(err.message).toContain('Nothing is wrong with your file');
    expect(err.message).not.toMatch(/R2_|AccessKey|bucket/i);
    // What the operator reads, in the log and the audit row.
    expect(String((err.meta as { operator?: string }).operator)).toMatch(/R2_ACCESS_KEY_ID/);
  });

  it('tells a missing bucket apart from a bad key', async () => {
    // Both first surface at the first upload after a deploy, and they need
    // different instructions — conflating them sends somebody to rotate a
    // credential that was never wrong.
    const missing = storageUnavailable(Object.assign(new Error('nope'), { name: 'NoSuchBucket' }), 'assets');
    expect(String((missing.meta as { operator?: string }).operator)).toMatch(/does not exist/);
    expect(String((missing.meta as { operator?: string }).operator)).not.toMatch(/ACCESS_KEY/);
  });
});
