import type { BoardJob, JobBoard } from '@sparksocial/agency';

/**
 * Himalayas' public jobs API, behind `agency.jobs.search`.
 *
 * Called from here and never from the browser: the API sends no CORS headers,
 * and its terms ask for server-side calls. No key is needed. If
 * `HIMALAYAS_API_KEY` is set it is sent as a bearer token, which lifts the
 * shared anonymous allowance to the account's own 60 a minute.
 *
 * Listings refresh once a day, so a search is cached for an hour — a team
 * paging back and forth through Job Finder costs the board one request.
 */

const BASE = 'https://himalayas.app/jobs/api/search';
const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function toBoardJob(raw: Record<string, unknown>): BoardJob | undefined {
  const guid = typeof raw.guid === 'string' ? raw.guid : undefined;
  const title = typeof raw.title === 'string' ? raw.title : undefined;
  const applicationLink = typeof raw.applicationLink === 'string' ? raw.applicationLink : undefined;
  if (!guid || !title || !applicationLink) return undefined;
  const minSalary = num(raw.minSalary);
  const maxSalary = num(raw.maxSalary);
  const pubDate = num(raw.pubDate);
  const expiryDate = num(raw.expiryDate);
  return {
    guid,
    title,
    companyName: typeof raw.companyName === 'string' ? raw.companyName : 'Unknown company',
    ...(typeof raw.companyLogo === 'string' && raw.companyLogo ? { companyLogo: raw.companyLogo } : {}),
    ...(typeof raw.employmentType === 'string' ? { employmentType: raw.employmentType } : {}),
    ...(minSalary !== undefined ? { minSalary } : {}),
    ...(maxSalary !== undefined ? { maxSalary } : {}),
    ...(typeof raw.salaryPeriod === 'string' ? { salaryPeriod: raw.salaryPeriod } : {}),
    ...(typeof raw.currency === 'string' ? { currency: raw.currency } : {}),
    locations: Array.isArray(raw.locationRestrictions)
      ? raw.locationRestrictions.filter((l): l is string => typeof l === 'string')
      : [],
    ...(pubDate !== undefined ? { pubDate } : {}),
    ...(expiryDate !== undefined ? { expiryDate } : {}),
    applicationLink,
  };
}

export function himalayasJobBoard(opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}): JobBoard {
  const doFetch = opts.fetchImpl ?? fetch;
  const apiKey = opts.apiKey ?? process.env.HIMALAYAS_API_KEY;
  const cache = new Map<string, { at: number; value: { jobs: BoardJob[]; totalCount: number } }>();

  return {
    async search({ q, country, employmentType, sort, page }) {
      const params = new URLSearchParams({ q, sort, page: String(page) });
      if (country) params.set('country', country);
      if (employmentType) params.set('employment_type', employmentType);
      const url = `${BASE}?${params.toString()}`;

      const hit = cache.get(url);
      if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

      const res = await doFetch(url, {
        headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Himalayas answered ${res.status}`);
      const body = (await res.json()) as { jobs?: unknown; totalCount?: unknown };
      const jobs = Array.isArray(body.jobs)
        ? body.jobs.flatMap((j) => {
            const mapped = j && typeof j === 'object' ? toBoardJob(j as Record<string, unknown>) : undefined;
            return mapped ? [mapped] : [];
          })
        : [];
      const value = { jobs, totalCount: num(body.totalCount) ?? jobs.length };
      cache.set(url, { at: Date.now(), value });
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      return value;
    },
  };
}
