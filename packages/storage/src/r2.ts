import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ToolError } from '@sparksocial/shared/types';
import type { BlobStore, PresignedUpload } from './types.js';

/**
 * Cloudflare R2 via presigned S3 URLs.
 *
 * The same contract `azure.ts` implements, for a platform with no managed
 * identity. Written for the Render migration (`infra/render/MIGRATION.md` §0.1):
 * Render has no object storage of its own, and `azure.ts` cannot run there at
 * all — it signs with a *user-delegation* SAS minted through the Container App's
 * identity, and there is no identity for `DefaultAzureCredential` to resolve.
 *
 * R2 rather than S3 because of the property the master plan picked R2 for in the
 * first place: **zero egress**. This is a media product; every rendered video
 * and every asset read is egress, and it is the dominant cost lever. CLAUDE.md's
 * note that Blob Storage loses that property — and that media therefore has to
 * be served through a cached Front Door — stops applying the moment this is the
 * store.
 *
 * It is S3-compatible, so nothing here is R2-specific except the endpoint: the
 * same file serves Backblaze B2 or AWS S3 by changing `endpoint` and `region`.
 *
 * ── Static keys, and why that is a real downgrade ──────────────────────────
 *
 * Azure signs with a key Azure AD issues to a managed identity; nothing holds a
 * permanent credential. R2 has no equivalent — it is an access key id and a
 * secret, long-lived, sitting in an environment variable. That is a genuine
 * reduction in posture and it is worth saying rather than discovering at an
 * audit. Scope the token to the one bucket, and rotate it on a schedule.
 */
export interface R2Options {
  /** Cloudflare account id — the `<id>` in `<id>.r2.cloudflarestorage.com`. */
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * A public base URL for reads — an `r2.dev` domain or, better, a custom one.
   *
   * Optional, and absent is the safer default: without it every read is a
   * presigned URL that expires, which is what `azure.ts` does. Set it only for a
   * bucket whose contents are genuinely public, and understand that it makes
   * every key guessable-by-URL rather than merely listed.
   */
  publicBaseUrl?: string;
  /** Injected in tests. */
  client?: S3Client;
}

const DEFAULT_UPLOAD_TTL_SEC = 900;
/**
 * A read URL for content a draft references while it is being reviewed, which
 * can be days — the same reasoning, and the same number, as `azure.ts`'s `put`.
 */
const LONG_READ_TTL_SEC = 7 * 24 * 3600;

/**
 * S3's presigned-URL ceiling with SigV4. Azure SAS has no such limit, so a
 * caller that asked for a longer window silently got one there and a 403 here;
 * clamping makes the difference visible at the boundary instead.
 */
const MAX_PRESIGN_TTL_SEC = 7 * 24 * 3600;

export function createR2BlobStore(opts: R2Options): BlobStore {
  const client =
    opts.client ??
    new S3Client({
      // R2 ignores region but the SDK requires one; `auto` is Cloudflare's own
      // documented value.
      region: 'auto',
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });

  async function signGet(key: string, ttlSec: number): Promise<string> {
    if (opts.publicBaseUrl) {
      return `${opts.publicBaseUrl.replace(/\/$/, '')}/${encodeURI(key)}`;
    }
    try {
      return await getSignedUrl(client, new GetObjectCommand({ Bucket: opts.bucket, Key: key }), {
        expiresIn: clampTtl(ttlSec),
      });
    } catch (e) {
      throw storageUnavailable(e, opts.bucket);
    }
  }

  return {
    async presignUpload({ key, contentType, ttlSec = DEFAULT_UPLOAD_TTL_SEC }): Promise<PresignedUpload> {
      let uploadUrl: string;
      try {
        uploadUrl = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            ContentType: contentType,
            /*
             * Create-only, the same intent as Azure's `c` permission.
             *
             * `azure.ts` deliberately signs uploads with create rather than
             * write, so a leaked URL can add an object and not replace someone
             * else's in place. S3's `PutObject` overwrites by default and has no
             * create-only permission, so the equivalent is a conditional write:
             * `If-None-Match: *` fails with 412 when the key already exists.
             *
             * R2 supports this; S3 added it in 2024. A store pointed at an older
             * S3-compatible endpoint that ignores the header degrades to
             * overwrite-on-collision rather than failing — worth knowing, since
             * keys embed a UUID and a collision is not a realistic accident, only
             * a deliberate replay of a captured URL.
             */
            IfNoneMatch: '*',
          }),
          { expiresIn: clampTtl(ttlSec) },
        );
      } catch (e) {
        throw storageUnavailable(e, opts.bucket);
      }

      const readUrl = await signGet(key, ttlSec);
      return { uploadUrl, readUrl, key, expiresAt: new Date(Date.now() + clampTtl(ttlSec) * 1000) };
    },

    async readUrl(key, ttlSec = DEFAULT_UPLOAD_TTL_SEC) {
      return signGet(key, ttlSec);
    },

    async put({ key, contentType, bytes }) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            ContentType: contentType,
            Body: bytes,
          }),
        );
      } catch (e) {
        throw storageUnavailable(e, opts.bucket);
      }
      return { url: await signGet(key, LONG_READ_TTL_SEC) };
    },
  };
}

/** SigV4 refuses a longer window; clamping here beats a 403 the caller cannot read. */
function clampTtl(ttlSec: number): number {
  return Math.max(1, Math.min(ttlSec, MAX_PRESIGN_TTL_SEC));
}

/**
 * One `ToolError` for every way R2 can be unreachable or misconfigured.
 *
 * Same contract and same reasoning as `azure.ts`'s function of this name: the
 * operator detail goes in `meta`, where the audit row keeps it and the API's
 * logger prints it, while `app.ts` serialises only `code` and `message` to the
 * client. Nothing about a bucket policy is actionable by the person uploading a
 * logo; telling them the upload failed *and that it is not their file* is.
 *
 * The three cases are separated because they need different operator
 * instructions and all three first surface at the same moment — the first upload
 * after a deploy.
 */
export function storageUnavailable(cause: unknown, bucket: string): ToolError {
  const text = cause instanceof Error ? cause.message : String(cause);
  const name = cause instanceof Error ? cause.name : '';

  const badKey = /InvalidAccessKeyId|SignatureDoesNotMatch|CredentialsProviderError/i.test(`${name} ${text}`);
  const noBucket = /NoSuchBucket|NotFound/i.test(`${name} ${text}`);

  const operator = badKey
    ? `R2 rejected the credentials for bucket "${bucket}". Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, and ` +
      `that the token is scoped to this bucket with Object Read & Write.`
    : noBucket
      ? `Bucket "${bucket}" does not exist on this account. Check R2_BUCKET and R2_ACCOUNT_ID.`
      : `R2 could not be reached for bucket "${bucket}".`;

  return new ToolError(
    'STORAGE_UNAVAILABLE',
    'File storage is not reachable right now, so the upload could not be saved. Nothing is wrong with your ' +
      'file — try again shortly.',
    { bucket, operator, cause: text },
  );
}
