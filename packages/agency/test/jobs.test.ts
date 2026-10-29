import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import { formatSalary, makeAgencyJobsSearch, type BoardJob, type JobBoard } from '../src/jobs.js';

/**
 * `agency.jobs.search` — Job Finder's listings.
 *
 * What these guard is the job board's terms as much as the shape: the apply
 * link passes through unchanged, expired jobs never reach the screen, and the
 * source is credited on every page.
 */

const ctx = () =>
  ({
    orgId: 'org_1',
    role: 'owner',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

const NOW = new Date('2026-10-29T12:00:00Z');
const secs = (iso: string) => new Date(iso).getTime() / 1000;

const job = (over: Partial<BoardJob> = {}): BoardJob => ({
  guid: 'https://himalayas.app/companies/acme/jobs/social-lead',
  title: 'Social Media Lead',
  companyName: 'Acme',
  minSalary: 52000,
  maxSalary: 62000,
  salaryPeriod: 'annual',
  currency: 'USD',
  locations: ['United States'],
  pubDate: secs('2026-10-27T12:00:00Z'),
  expiryDate: secs('2026-12-01T00:00:00Z'),
  applicationLink: 'https://himalayas.app/companies/acme/jobs/social-lead?utm_source=x',
  ...over,
});

function board(jobs: BoardJob[], seen: unknown[] = []): JobBoard {
  return {
    search: async (args) => {
      seen.push(args);
      return { jobs, totalCount: 500 };
    },
  };
}

describe('agency.jobs.search', () => {
  it('returns listings with the apply link unchanged and the source credited', async () => {
    const tool = makeAgencyJobsSearch(board([job()]), () => NOW);
    const out = await tool.handler(tool.input.parse({}), ctx());
    expect(out.jobs[0]).toMatchObject({
      title: 'Social Media Lead',
      company: 'Acme',
      salary: '$52K – $62K / year',
      applyUrl: 'https://himalayas.app/companies/acme/jobs/social-lead?utm_source=x',
      postedAt: '2026-10-27T12:00:00.000Z',
    });
    expect(out.source).toEqual({ name: 'Himalayas', url: 'https://himalayas.app/jobs' });
    expect(out.totalCount).toBe(500);
  });

  it('leaves out a job that has expired', async () => {
    const tool = makeAgencyJobsSearch(board([job({ guid: 'old', expiryDate: secs('2026-10-01T00:00:00Z') }), job()]), () => NOW);
    const out = await tool.handler(tool.input.parse({}), ctx());
    expect(out.jobs.map((j) => j.id)).not.toContain('old');
    expect(out.jobs).toHaveLength(1);
  });

  it('searches for social media by default and passes the filters through', async () => {
    const seen: unknown[] = [];
    const tool = makeAgencyJobsSearch(board([], seen), () => NOW);
    await tool.handler(tool.input.parse({}), ctx());
    await tool.handler(tool.input.parse({ q: 'copywriter', country: 'GB', employmentType: 'Contractor', sort: 'recent', page: 2 }), ctx());
    expect(seen[0]).toEqual({ q: 'social media', sort: 'relevant', page: 1 });
    expect(seen[1]).toEqual({ q: 'copywriter', country: 'GB', employmentType: 'Contractor', sort: 'recent', page: 2 });
  });

  it('drops a listing whose apply link is not a URL rather than showing a dead button', async () => {
    const tool = makeAgencyJobsSearch(board([job({ applicationLink: 'not a link' })]), () => NOW);
    expect((await tool.handler(tool.input.parse({}), ctx())).jobs).toEqual([]);
  });

  it('turns a board outage into a ToolError the screen can show', async () => {
    const tool = makeAgencyJobsSearch({ search: async () => { throw new Error('503'); } }, () => NOW);
    await expect(tool.handler(tool.input.parse({}), ctx())).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
  });

  it('is an administrator’s read — refused to an editor', () => {
    const tool = makeAgencyJobsSearch(board([]));
    const decide = (role: string) =>
      evaluate({
        caller: 'user',
        role,
        tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
        brand: { approvalMode: 'autopublish', agentPaused: false },
        budget: { estimatedCents: 0, remainingCents: 10_000 },
      } as unknown as Parameters<typeof evaluate>[0]);
    expect(decide('editor').kind).toBe('deny');
    expect(decide('admin').kind).toBe('allow');
  });
});

describe('formatSalary', () => {
  it('says nothing when the listing gives no salary', () => {
    expect(formatSalary({})).toBeUndefined();
    expect(formatSalary({ minSalary: 0, maxSalary: 0 })).toBeUndefined();
  });
  it('shows a single figure when only one end is given', () => {
    expect(formatSalary({ maxSalary: 40, currency: 'USD', salaryPeriod: 'hourly' })).toBe('$40 / hour');
  });
  it('survives an unknown currency code', () => {
    expect(formatSalary({ minSalary: 1000, currency: 'ZZZZ' })).toBe('1K');
  });
});
