import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `agency.jobs.search` — the Agency Portal's Job Finder.
 *
 * ── The source ────────────────────────────────────────────────────────────
 *
 * Himalayas' public jobs API: free, no key needed, and its terms allow showing
 * its listings inside an app we operate. Upwork, Fiverr and LinkedIn were the
 * obvious names and none of them can be pulled into a product like this
 * legally. Himalayas lists remote jobs, which is what an agency bids for.
 *
 * Its terms are why the output is shaped the way it is:
 *   * `applyUrl` is Himalayas' `applicationLink`, unchanged — every "View Job"
 *     uses it as-is.
 *   * `source` is returned with every page so the screen can credit Himalayas
 *     with a visible link.
 *   * Expired jobs are dropped here, not left to the screen.
 *   * Jobs are only ever shown in this app — nothing here re-publishes them.
 *
 * ── Third-party text ──────────────────────────────────────────────────────
 *
 * Titles and company names come from a job board. They are rendered as text
 * and never reach a model prompt; the job's HTML description is not passed on
 * at all.
 */

export const JOB_TYPES = ['Full Time', 'Part Time', 'Contractor', 'Temporary', 'Intern'] as const;
export const JOB_SORTS = ['relevant', 'recent', 'salaryDesc'] as const;

/** One listing as the job board returns it, already mapped by the API's client. */
export interface BoardJob {
  guid: string;
  title: string;
  companyName: string;
  companyLogo?: string;
  employmentType?: string;
  minSalary?: number;
  maxSalary?: number;
  salaryPeriod?: string;
  currency?: string;
  locations: string[];
  /** Seconds since the epoch, as the board sends them. */
  pubDate?: number;
  expiryDate?: number;
  applicationLink: string;
}

/** Injected, like every vendor seam — the API wires Himalayas, tests a fake. */
export interface JobBoard {
  search(args: {
    q: string;
    country?: string;
    employmentType?: string;
    sort: (typeof JOB_SORTS)[number];
    page: number;
  }): Promise<{ jobs: BoardJob[]; totalCount: number }>;
}

export const Job = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  companyLogo: z.string().url().optional(),
  employmentType: z.string().optional(),
  /** Formatted for display, e.g. "$52K – $62K / year". Absent when the listing gives none. */
  salary: z.string().optional(),
  locations: z.array(z.string()),
  postedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  /** The board's application link, unchanged — its terms require it. */
  applyUrl: z.string().url(),
});
export type Job = z.infer<typeof Job>;

export const AgencyJobsSearchInput = z.object({
  q: z.string().trim().max(120).default('social media'),
  /** A country code or name; omitted means anywhere. */
  country: z.string().trim().max(60).optional(),
  employmentType: z.enum(JOB_TYPES).optional(),
  sort: z.enum(JOB_SORTS).default('relevant'),
  page: z.number().int().min(1).max(50).default(1),
});

export const AgencyJobsSearchOutput = z.object({
  jobs: z.array(Job),
  /** The board's own estimate, which it says can be a day old. */
  totalCount: z.number().int(),
  page: z.number().int(),
  /** Credit for the listings, which the board's terms require be shown. */
  source: z.object({ name: z.string(), url: z.string().url() }),
});

const PERIOD: Record<string, string> = { annual: 'year', monthly: 'month', weekly: 'week', hourly: 'hour', daily: 'day' };

export function formatSalary(j: Pick<BoardJob, 'minSalary' | 'maxSalary' | 'currency' | 'salaryPeriod'>): string | undefined {
  const lo = j.minSalary && j.minSalary > 0 ? j.minSalary : undefined;
  const hi = j.maxSalary && j.maxSalary > 0 ? j.maxSalary : undefined;
  if (!lo && !hi) return undefined;
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: j.currency || 'USD',
      notation: 'compact',
      maximumFractionDigits: 0,
    });
  } catch {
    // An unknown currency code would throw; the number alone is still worth showing.
    fmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 });
  }
  const range = lo && hi && lo !== hi ? `${fmt.format(lo)} – ${fmt.format(hi)}` : fmt.format((lo ?? hi)!);
  const per = j.salaryPeriod ? PERIOD[j.salaryPeriod] : undefined;
  return per ? `${range} / ${per}` : range;
}

const iso = (seconds?: number) => (seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined);

export function makeAgencyJobsSearch(board: JobBoard, now: () => Date = () => new Date()) {
  return defineTool({
    name: 'agency.jobs.search',
    version: 1,

    summary:
      'Search remote job listings an agency could bid for (social media, content, marketing), from the ' +
      'Himalayas job board. Expired listings are left out. Read-only; free.',

    input: AgencyJobsSearchInput,
    output: AgencyJobsSearchOutput,

    effect: 'read',
    autonomy: 'auto',
    /** The Agency Portal is an administrator's screen — see `agency.roster`. */
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['AG-JF-01'],

    async handler(input, ctx) {
      let page: Awaited<ReturnType<JobBoard['search']>>;
      try {
        page = await board.search({
          q: input.q || 'social media',
          sort: input.sort,
          page: input.page,
          ...(input.country ? { country: input.country } : {}),
          ...(input.employmentType ? { employmentType: input.employmentType } : {}),
        });
      } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError('UPSTREAM_FAILED', 'The job board did not answer. Nothing was changed, so trying again is safe.', {
          cause: e instanceof Error ? e.message : String(e),
        });
      }

      const nowSeconds = now().getTime() / 1000;
      const jobs = page.jobs
        .filter((j) => !j.expiryDate || j.expiryDate > nowSeconds)
        .flatMap((j) => {
          const parsed = Job.safeParse({
            id: j.guid,
            title: j.title,
            company: j.companyName,
            ...(j.companyLogo ? { companyLogo: j.companyLogo } : {}),
            ...(j.employmentType ? { employmentType: j.employmentType } : {}),
            ...(formatSalary(j) ? { salary: formatSalary(j) } : {}),
            locations: j.locations,
            ...(iso(j.pubDate) ? { postedAt: iso(j.pubDate) } : {}),
            ...(iso(j.expiryDate) ? { expiresAt: iso(j.expiryDate) } : {}),
            applyUrl: j.applicationLink,
          });
          // A listing with a malformed link cannot be applied to; leave it out.
          return parsed.success ? [parsed.data] : [];
        });

      ctx.logger.info('job search', { orgId: ctx.orgId, results: jobs.length, page: input.page });
      return {
        jobs,
        totalCount: page.totalCount,
        page: input.page,
        source: { name: 'Himalayas', url: 'https://himalayas.app/jobs' },
      };
    },
  });
}
