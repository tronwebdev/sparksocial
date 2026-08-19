import { ToolError } from '@sparksocial/shared';

/**
 * Canva's Autofill + Export APIs — `compose.fanout`'s vendor calls.
 *
 * Same caveat `canva.ts`'s own header carries for the OAuth flow: endpoint
 * paths and response shapes here are built from Canva's published Connect
 * API docs, not verified against a live app — there is no Canva developer
 * app registered in this environment (`CANVA_CLIENT_ID`/`CANVA_CLIENT_SECRET`
 * are unset in `apps/api/.env`). If a call 404s or the response shape is
 * wrong, that is the first thing to check against Canva's current docs.
 *
 * Both operations are async jobs on Canva's side — create, then poll until
 * the job reports done or failed. `pollJob` is the one place that shape is
 * handled, shared by both the autofill and export flows rather than
 * duplicated per job type.
 */

const BASE_URL = 'https://api.canva.com/rest/v1';

export type CanvaAutofillField = { type: 'text'; text: string } | { type: 'image'; asset_id: string };

export interface CanvaJobStatus<TResult> {
  status: 'in_progress' | 'success' | 'failed';
  result?: TResult;
  error?: string;
}

/** Injected fetch, same testability contract as every other vendor call in this codebase. */
export type CanvaFetch = (url: string, init: RequestInit) => Promise<Response>;

async function canvaFetch(fetchImpl: CanvaFetch, path: string, accessToken: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchImpl(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ToolError('UPSTREAM_FAILED', `Canva request failed: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`, {
      status: response.status,
      path,
    });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ToolError('UPSTREAM_FAILED', `Canva returned a response that was not valid JSON for ${path}.`, { path });
  }
}

/** `POST /autofills` — fills a Brand Template's named fields and starts a design-creation job. */
export async function startCanvaAutofill(
  fetchImpl: CanvaFetch,
  args: { accessToken: string; brandTemplateId: string; data: Record<string, CanvaAutofillField> },
): Promise<{ jobId: string }> {
  const body = (await canvaFetch(fetchImpl, '/autofills', args.accessToken, {
    method: 'POST',
    body: JSON.stringify({ brand_template_id: args.brandTemplateId, data: args.data }),
  })) as { job?: { id?: string } };
  if (!body.job?.id) throw new ToolError('UPSTREAM_FAILED', 'Canva accepted the autofill request but returned no job id.', {});
  return { jobId: body.job.id };
}

export async function getCanvaAutofillJob(
  fetchImpl: CanvaFetch,
  args: { accessToken: string; jobId: string },
): Promise<CanvaJobStatus<{ designId: string; editUrl?: string }>> {
  const body = (await canvaFetch(fetchImpl, `/autofills/${encodeURIComponent(args.jobId)}`, args.accessToken)) as {
    job?: { status?: string; result?: { design?: { id?: string; urls?: { edit_url?: string } } }; error?: { message?: string } };
  };
  const status = body.job?.status;
  if (status === 'success') {
    const designId = body.job?.result?.design?.id;
    if (!designId) throw new ToolError('UPSTREAM_FAILED', 'Canva autofill succeeded but returned no design id.', {});
    return { status: 'success', result: { designId, editUrl: body.job?.result?.design?.urls?.edit_url } };
  }
  if (status === 'failed') return { status: 'failed', error: body.job?.error?.message ?? 'Canva autofill job failed.' };
  return { status: 'in_progress' };
}

/** `POST /exports` — renders a design to a downloadable file in the given format. */
export async function startCanvaExport(
  fetchImpl: CanvaFetch,
  args: { accessToken: string; designId: string; format: 'png' | 'jpg' | 'pdf' },
): Promise<{ jobId: string }> {
  const body = (await canvaFetch(fetchImpl, '/exports', args.accessToken, {
    method: 'POST',
    body: JSON.stringify({ design_id: args.designId, format: { type: args.format } }),
  })) as { job?: { id?: string } };
  if (!body.job?.id) throw new ToolError('UPSTREAM_FAILED', 'Canva accepted the export request but returned no job id.', {});
  return { jobId: body.job.id };
}

export async function getCanvaExportJob(
  fetchImpl: CanvaFetch,
  args: { accessToken: string; jobId: string },
): Promise<CanvaJobStatus<{ urls: string[] }>> {
  const body = (await canvaFetch(fetchImpl, `/exports/${encodeURIComponent(args.jobId)}`, args.accessToken)) as {
    job?: { status?: string; urls?: string[]; error?: { message?: string } };
  };
  const status = body.job?.status;
  if (status === 'success') return { status: 'success', result: { urls: body.job?.urls ?? [] } };
  if (status === 'failed') return { status: 'failed', error: body.job?.error?.message ?? 'Canva export job failed.' };
  return { status: 'in_progress' };
}

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 30; // ~30s ceiling per job — a fan-out call should fail fast, not hang a request indefinitely.

/** Polls a Canva job to completion or throws — shared by both the autofill and export flows. */
export async function pollCanvaJob<TResult>(
  poll: () => Promise<CanvaJobStatus<TResult>>,
  label: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<TResult> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const status = await poll();
    if (status.status === 'success') {
      if (!status.result) throw new ToolError('UPSTREAM_FAILED', `Canva ${label} job reported success with no result.`, {});
      return status.result;
    }
    if (status.status === 'failed') {
      throw new ToolError('UPSTREAM_FAILED', `Canva ${label} job failed: ${status.error ?? 'unknown error'}`, {});
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ToolError('UPSTREAM_FAILED', `Canva ${label} job did not complete within ${MAX_POLL_ATTEMPTS}s.`, {});
}
