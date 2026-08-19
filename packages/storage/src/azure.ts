import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
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
    const key = await client.getUserDelegationKey(startsOn, expiresOn);
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
      await container.getBlockBlobClient(key).uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
      // Long-lived on purpose: unlike a presigned upload URL (minutes, single
      // use), this is a *read* URL for content a draft references for as long
      // as the draft is being reviewed, which can be days.
      return { url: await sign(key, 'r', 7 * 24 * 3600) };
    },
  };
}
