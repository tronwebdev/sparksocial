import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import {
  startCanvaAutofill,
  getCanvaAutofillJob,
  startCanvaExport,
  getCanvaExportJob,
  pollCanvaJob,
} from '../src/canvaDesign.js';

/**
 * Canva's Autofill/Export APIs — two async job kinds, same start/poll shape.
 * What matters: the right body/path per call, `success`/`failed`/`in_progress`
 * map to the right outcome, and `pollCanvaJob` actually polls (not just reads
 * once) and gives up rather than hanging forever.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('startCanvaAutofill', () => {
  it('posts brand_template_id and data, returns the job id', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({ job: { id: 'job_1' } }));
    const out = await startCanvaAutofill(f as never, {
      accessToken: 'tok',
      brandTemplateId: 'tmpl_1',
      data: { headline: { type: 'text', text: 'hello' } },
    });

    expect(out).toEqual({ jobId: 'job_1' });
    expect(f.mock.calls[0]![0]).toBe('https://api.canva.com/rest/v1/autofills');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ brand_template_id: 'tmpl_1', data: { headline: { type: 'text', text: 'hello' } } });
  });

  it('refuses a response with no job id', async () => {
    const f = vi.fn(async () => json({}));
    await expect(startCanvaAutofill(f as never, { accessToken: 't', brandTemplateId: 'x', data: {} })).rejects.toThrow(ToolError);
  });

  it('reports an upstream failure on a non-2xx response', async () => {
    const f = vi.fn(async () => new Response('bad request', { status: 400 }));
    await expect(startCanvaAutofill(f as never, { accessToken: 't', brandTemplateId: 'x', data: {} })).rejects.toThrow(ToolError);
  });
});

describe('getCanvaAutofillJob', () => {
  it('maps a success job to the design id and edit url', async () => {
    const f = vi.fn(async () => json({ job: { status: 'success', result: { design: { id: 'design_1', urls: { edit_url: 'https://canva.com/edit/1' } } } } }));
    const out = await getCanvaAutofillJob(f as never, { accessToken: 't', jobId: 'job_1' });
    expect(out).toEqual({ status: 'success', result: { designId: 'design_1', editUrl: 'https://canva.com/edit/1' } });
  });

  it('maps a failed job to its error message', async () => {
    const f = vi.fn(async () => json({ job: { status: 'failed', error: { message: 'template not found' } } }));
    const out = await getCanvaAutofillJob(f as never, { accessToken: 't', jobId: 'job_1' });
    expect(out).toEqual({ status: 'failed', error: 'template not found' });
  });

  it('maps anything else to in_progress', async () => {
    const f = vi.fn(async () => json({ job: { status: 'in_progress' } }));
    expect(await getCanvaAutofillJob(f as never, { accessToken: 't', jobId: 'job_1' })).toEqual({ status: 'in_progress' });
  });

  it('throws if a success job carries no design id', async () => {
    const f = vi.fn(async () => json({ job: { status: 'success', result: {} } }));
    await expect(getCanvaAutofillJob(f as never, { accessToken: 't', jobId: 'job_1' })).rejects.toThrow(ToolError);
  });
});

describe('startCanvaExport / getCanvaExportJob', () => {
  it('posts design_id and format, returns the job id', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({ job: { id: 'exp_1' } }));
    const out = await startCanvaExport(f as never, { accessToken: 't', designId: 'design_1', format: 'png' });

    expect(out).toEqual({ jobId: 'exp_1' });
    expect(f.mock.calls[0]![0]).toBe('https://api.canva.com/rest/v1/exports');
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ design_id: 'design_1', format: { type: 'png' } });
  });

  it('maps a success export job to its download urls', async () => {
    const f = vi.fn(async () => json({ job: { status: 'success', urls: ['https://export.canva.com/a.png'] } }));
    const out = await getCanvaExportJob(f as never, { accessToken: 't', jobId: 'exp_1' });
    expect(out).toEqual({ status: 'success', result: { urls: ['https://export.canva.com/a.png'] } });
  });
});

describe('pollCanvaJob', () => {
  it('polls until success and returns the result', async () => {
    let calls = 0;
    const poll = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? { status: 'in_progress' as const } : { status: 'success' as const, result: { designId: 'd1' } };
    });
    const sleep = vi.fn(async () => {});

    const result = await pollCanvaJob(poll, 'autofill', sleep);

    expect(result).toEqual({ designId: 'd1' });
    expect(poll).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on a failed job, without exhausting retries', async () => {
    const poll = vi.fn(async () => ({ status: 'failed' as const, error: 'template not found' }));
    const sleep = vi.fn(async () => {});
    await expect(pollCanvaJob(poll, 'autofill', sleep)).rejects.toThrow(ToolError);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('gives up after the max attempts rather than hanging forever', async () => {
    const poll = vi.fn(async () => ({ status: 'in_progress' as const }));
    const sleep = vi.fn(async () => {});
    await expect(pollCanvaJob(poll, 'export', sleep)).rejects.toThrow(ToolError);
    expect(poll.mock.calls.length).toBeGreaterThan(1);
  });
});
