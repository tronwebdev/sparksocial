import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { ToolError } from '@sparksocial/shared/types';
import type { BlobStore, PresignedUpload } from './types.js';

/**
 * Azure Blob Storage via **user-delegation SAS**.
 *
 * Signed with a key Azure AD issues to the app's managed identity, not with the
 * storage account key — the account key is a permanent all-powerful credential
 * that CLAUDE.md forbids committing and that nothing here ever needs to hold.
 * Managed Identity in Container Apps, `az login` locally; `DefaultAzureCredential`
 * resolves both without a branch.
 *
 * The delegation key is cached because minting one is a network round trip and it
 * is valid for hours, so fetching per-upload would add latency to every ingest for
 * no benefit. It is refreshed a minute before expiry rather than at expiry, so a
 * request in flight when the clock rolls over doesn't sign with a dead key.
 *
 * ── When the identity is not there ────────────────────────────────────────
 *
 * `DefaultAzureCredential` fails by throwing a `ChainedTokenCredential`
 * aggregate: a ~700-character report naming every credential source it tried,
 * with troubleshooting URLs and a correlation id. That is genuinely the right
 * text for an operator and exactly the wrong text for a customer, and it was
 * being rendered in full, in red, under a "Upload a logo" button — the app
 * telling a fishmonger to check whether the Azure CLI is on the PATH.
 *
 * So the credential failure is caught and converted once, here, at the only
 * place that knows it is a credential failure rather than a storage error. The
 * aggregate goes to the log; the caller gets a code and one sentence.
 */
export interface AzureBlobOptions {
  account: string;
  container: string;
  /** Injected in tests. Defaults to a `DefaultAzureCredential`-backed client. */
  client?: BlobServiceClient;
}

const DELEGATION_TTL_MIN = 60;
const DELEGATION_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_UPLOAD_TTL_SEC = 900;

export function createAzureBlobStore(opts: AzureBlobOptions): BlobStore {
  const accountUrl = `https://${opts.account}.blob.core.windows.net`;
  const client = opts.client ?? new BlobServiceClient(accountUrl, new DefaultAzureCredential());

  let delegation: { key: Awaited<ReturnType<BlobServiceClient['getUserDelegationKey']>>; expiresAt: number } | undefined;

  async function delegationKey() {
    const now = Date.now();
    if (delegation && delegation.expiresAt - DELEGATION_REFRESH_MARGIN_MS > now) return delegation.key;

    const startsOn = new Date(now - 5 * 60_000); // clock-skew allowance
    const expiresOn = new Date(now + DELEGATION_TTL_MIN * 60_000);
    let key: Awaited<ReturnType<BlobServiceClient['getUserDelegationKey']>>;
    try {
      key = await client.getUserDelegationKey(startsOn, expiresOn);
    } catch (e) {
      throw storageUnavailable(e, opts.account);
    }
    delegation = { key, expiresAt: expiresOn.getTime() };
    return key;
  }

  async function sign(key: string, permissions: string, ttlSec: number, contentType?: string) {
    const udk = await delegationKey();
    const sas = generateBlobSASQueryParameters(
      {
        containerName: opts.container,
        blobName: key,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn: new Date(Date.now() - 5 * 60_000),
        expiresOn: new Date(Date.now() + ttlSec * 1000),
        protocol: SASProtocol.Https,
        ...(contentType ? { contentType } : {}),
      },
      udk,
      opts.account,
    );
    return `${accountUrl}/${opts.container}/${encodeURI(key)}?${sas.toString()}`;
  }

  return {
    async presignUpload({ key, contentType, ttlSec = DEFAULT_UPLOAD_TTL_SEC }): Promise<PresignedUpload> {
      // Create-only on the upload URL. 'w' would also permit overwriting an
      // existing blob, which turns a leaked URL into a way to replace someone
      // else's asset in place rather than merely adding one.
      const uploadUrl = await sign(key, 'c', ttlSec, contentType);
      const readUrl = await sign(key, 'r', ttlSec);
      return { uploadUrl, readUrl, key, expiresAt: new Date(Date.now() + ttlSec * 1000) };
    },

    async readUrl(key, ttlSec = DEFAULT_UPLOAD_TTL_SEC) {
      return sign(key, 'r', ttlSec);
    },

    async put({ key, contentType, bytes }) {
      const container = client.getContainerClient(opts.container);
      // Wrapped for the same reason as the delegation key: a server-side upload
      // authenticates with the same identity, so it fails with the same aggregate.
      try {
        await container
          .getBlockBlobClient(key)
          .uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
      } catch (e) {
        throw storageUnavailable(e, opts.account);
      }
      // Long-lived on purpose: unlike a presigned upload URL (minutes, single
      // use), this is a *read* URL for content a draft references for as long
      // as the draft is being reviewed, which can be days.
      return { url: await sign(key, 'r', 7 * 24 * 3600) };
    },
  };
}

/**
 * One `ToolError` for every way the storage identity can be missing.
 *
 * `STORAGE_UNAVAILABLE` rather than a generic failure, so the UI can say
 * something true without parsing prose, and so a log search finds every instance
 * of this specific misconfiguration.
 *
 * The full aggregate goes in `meta.cause` — the audit row keeps it, and
 * `apps/api`'s logger prints it, while `app.ts` serialises only `code` and
 * `message` to the client — so `message` is all a person ever reads. The
 * distinction is the whole point: nothing about a Managed Identity role
 * assignment is actionable by the person trying to upload a logo, and telling
 * them their upload failed *and that it is not their file* is.
 */
export function storageUnavailable(cause: unknown, account: string): ToolError {
  const text = cause instanceof Error ? cause.message : String(cause);

  /**
   * Credential failures and permission failures need different operator
   * instructions, and the two are easy to confuse: both surface at the first
   * upload after a deploy. No identity at all is `ChainedTokenCredential` /
   * `CredentialUnavailable`; an identity without the role is a 403 naming
   * `AuthorizationPermissionMismatch`.
   */
  const noIdentity = /ChainedTokenCredential|CredentialUnavailable|ManagedIdentityCredential/i.test(text);
  const operator = noIdentity
    ? `No Azure identity is available to sign for storage account "${account}". In Container Apps, assign a ` +
      `managed identity; locally, run \`az login\`.`
    : `The identity signing for storage account "${account}" was refused. It needs both ` +
      `"Storage Blob Data Contributor" and "Storage Blob Delegator" on that account.`;

  return new ToolError(
    'STORAGE_UNAVAILABLE',
    'File storage is not reachable right now, so the upload could not be saved. Nothing is wrong with your ' +
      'file — try again shortly.',
    { account, operator, cause: text },
  );
}
