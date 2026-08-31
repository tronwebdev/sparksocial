/**
 * THE DIRECT BROWSER PUT TO BLOB STORAGE.
 *
 * Every upload in this product goes browser → storage, against a short-lived SAS
 * the API mints. The file never passes through the API, which is the point: a
 * 512MB video should not be proxied through a Node process. The consequence is
 * that the browser makes a cross-origin request to `*.blob.core.windows.net`, and
 * that has a failure mode with no useful message attached to it.
 *
 * ── What staging showed ───────────────────────────────────────────────────
 *
 * The storage account had no CORS rule for the web app's origin, so the preflight
 * was refused and the PUT never left the browser. Five call sites each did:
 *
 *     catch (e) { setError(e instanceof Error ? e.message : '…') }
 *
 * and `e.message` for a blocked or failed `fetch` is the literal string
 * **"Failed to fetch"**. That is what appeared beside "Choose Files": three words
 * that name neither the cause nor anything to do about it, on a screen where the
 * obvious inference — "my file is wrong" — is the one wrong conclusion.
 *
 * ── Why one module instead of five fixes ──────────────────────────────────
 *
 * The block was copied five times, so the defect was copied five times, and a
 * sixth upload surface would have copied it again. The distinction this makes is
 * not something to re-derive per screen:
 *
 *   * **The request never completed** (fetch threw). CORS, DNS, offline, a
 *     blocked network. A browser deliberately cannot tell these apart — the CORS
 *     spec hides the difference so a page cannot probe what it may not read — so
 *     the user message covers them honestly as one and the console carries the
 *     operator's most likely cause.
 *   * **Storage answered and refused** (a status). CORS passed and the account is
 *     reachable, which makes 403 mean an expired or under-permissioned SAS and
 *     404 mean a missing container. Different problems, different messages.
 *
 * ── Who reads which half ──────────────────────────────────────────────────
 *
 * `message` is for the person holding the file, and it says the file is not the
 * problem, because that is the thing they are about to waste ten minutes on.
 * `console.error` is for us, and it names the host and the likely fix. Nothing
 * about a storage account's CORS rules belongs on the screen of somebody
 * uploading a photo of a fish.
 */

/**
 * The one browser global here, declared rather than imported — same move as
 * `selectedGenome.ts`, and for the same reason: `apps/web`'s tsconfig has the DOM
 * lib but the *root* one deliberately does not, and this module has to be
 * readable from both programs because `apps/api/test/upload-to-storage.test.ts`
 * is where its rules are checked.
 */
declare const window: { location: { origin: string } } | undefined;

export interface UploadFailure {
  /** For the person holding the file. Never mentions CORS, SAS, or Azure. */
  message: string;
  /** `network` — it never completed. `refused` — storage answered with a status. */
  kind: 'network' | 'refused';
  status?: number;
}

export type UploadResult = { ok: true } | ({ ok: false } & UploadFailure);

/** The header Azure requires on a SAS PUT. Omitting it 400s, so it is not optional. */
const BLOB_TYPE_HEADER = 'x-ms-blob-type';

export async function uploadToStorage(
  uploadUrl: string,
  file: Blob,
  contentType: string,
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType, [BLOB_TYPE_HEADER]: 'BlockBlob' },
      body: file,
    });
  } catch (e) {
    /**
     * The request did not complete. The browser will not say why.
     *
     * Logged with the host, because the single most likely cause is that the
     * storage account does not allow this origin — and that is fixed by
     * `infra/azure/bootstrap.sh`'s "Blob CORS" step, not by anything in this
     * codebase. An environment provisioned without it looks entirely healthy
     * until the first upload.
     */
    let host = 'storage';
    try {
      host = new URL(uploadUrl).host;
    } catch {
      /* A malformed URL is the API's problem, not something to crash the handler over. */
    }
    console.error(
      `[upload] the PUT to ${host} never completed (${e instanceof Error ? e.message : String(e)}). ` +
        `If this is a deployed environment, check the storage account's CORS rules allow ${
          typeof window === 'undefined' ? 'this origin' : window.location.origin
        } for PUT and OPTIONS — see infra/azure/bootstrap.sh, step "Blob CORS".`,
    );
    return {
      ok: false,
      kind: 'network',
      message:
        'The file could not be sent to storage. Nothing is wrong with the file itself — the connection to ' +
        'storage failed. Try again; if it keeps happening it is our end, not yours.',
    };
  }

  if (response.ok) return { ok: true };

  /**
   * Storage answered, so the origin is allowed and the account is reachable. What
   * is left is about the URL: these are short-lived and single-purpose by design.
   */
  const message =
    response.status === 403
      ? 'That upload link had expired by the time the file finished sending. Try again — a fresh link is ' +
        'issued each time.'
      : response.status === 404
        ? 'Storage accepted the request but the destination does not exist. That is a setup problem on our ' +
          'side, not something you can fix from here.'
        : `Storage refused the upload (${response.status}). Nothing is wrong with the file — try again ` +
          'shortly.';

  console.error(`[upload] storage refused the PUT with ${response.status} ${response.statusText}`);
  return { ok: false, kind: 'refused', status: response.status, message };
}
