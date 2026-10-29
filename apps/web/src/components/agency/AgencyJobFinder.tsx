'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { FLATTEN_NARROW, SECTION } from '@/components/shell/narrowStage';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';

/**
 * `Job Finder` — one screen, two tabs.
 *
 *   hero    46,190 · 1636x300 r24 on `--ss-grad-ag-jf`
 *           (`radial-gradient(700px 280px at 24% 24%, #131B2A 0%, #05070C 72%)`),
 *           under a starfield and the design's two photos
 *   chip    82,64 · h38 r19 on `rgba(120,170,255,0.18)` inside a
 *           `rgba(120,170,255,0.5)` hairline, label 14/600 `#9CC2FF`
 *   title   82,122 · 760 wide · 40/600 white
 *   tabs    46,520 · 520x56 r14; halves 252x46 r10, active **`#9CEFFF`**
 *   search  46,648 · 560x58 r13; three 170x58 filters at 630 / 820 / 1010 —
 *           Discover only
 *   browse  1500,648 · h58 r13 `#0C0C0C` · 15.5/600
 *   count   46,734 · 17/600 `#5B5B5B`
 *   cards   46,772 · h150 r16 white, shadow `0 16px 40px -34px rgba(...)`; a
 *           52x52 r12 company mark, salary in 17/700 `#26A344`, a 40x40 r10
 *           save toggle that fills `#0C0C0C`, and View Job h38 r9 on `#9CEFFF`
 *
 * ── Where the jobs come from ──────────────────────────────────────────────
 *
 * `agency.jobs.search` — Himalayas' public jobs API, read through the backend.
 * Its terms shape three things here: "View Job" opens the listing's own
 * application link unchanged, the source is credited with a visible link, and
 * an expired job is never shown (the tool drops them, and a saved one is
 * dropped from Saved once its date passes).
 *
 * The design's three drops are Location, Amount and All Type. Amount sorts by
 * pay — the board filters by type and country, not by a salary floor — and
 * says so in its options.
 *
 * ── Saved ─────────────────────────────────────────────────────────────────
 *
 * A bookmark list in this browser, the way a person keeps tabs open: it is the
 * viewer's own shortlist, not shared agency data. Kept as a snapshot of each
 * job so Saved shows without a search, and pruned at expiry.
 */

type Tab = 'discover' | 'saved';

interface Job {
  id: string;
  title: string;
  company: string;
  companyLogo?: string;
  employmentType?: string;
  salary?: string;
  locations: string[];
  postedAt?: string;
  expiresAt?: string;
  applyUrl: string;
}

const SAVED_KEY = 'ss-agency-saved-jobs';
/** The design's two rows of three. */
const PER_PAGE = 6;

const COUNTRIES = [
  ['', 'Location'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['DE', 'Germany'],
  ['NG', 'Nigeria'],
  ['IN', 'India'],
  ['ZA', 'South Africa'],
] as const;
const SORTS = [
  ['relevant', 'Amount'],
  ['salaryDesc', 'Highest pay first'],
  ['recent', 'Newest first'],
] as const;
const TYPES = [
  ['', 'All Type'],
  ['Full Time', 'Full time'],
  ['Part Time', 'Part time'],
  ['Contractor', 'Contract'],
  ['Temporary', 'Temporary'],
  ['Intern', 'Internship'],
] as const;

function readSaved(): Job[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '[]') as Job[];
    const now = Date.now();
    return Array.isArray(raw) ? raw.filter((j) => j && j.id && (!j.expiresAt || Date.parse(j.expiresAt) > now)) : [];
  } catch {
    return [];
  }
}

function ago(iso?: string): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export function AgencyJobFinder() {
  const [tab, setTab] = useState<Tab>('discover');
  const [saved, setSaved] = useState<Job[]>([]);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState<string>('relevant');
  const [type, setType] = useState('');
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [total, setTotal] = useState(0);
  const [apiPage, setApiPage] = useState(1);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSaved(readSaved()), []);

  const search = useCallback(
    async (nextApiPage: number, append: boolean) => {
      setBusy(true);
      setError(null);
      const res = await invoke<{ jobs: Job[]; totalCount: number }>('agency.jobs.search', {
        q: q.trim() || 'social media',
        sort,
        page: nextApiPage,
        ...(country ? { country } : {}),
        ...(type ? { employmentType: type } : {}),
      });
      setBusy(false);
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? userMessage(res.error) : 'Searching jobs needs an approval first.');
        if (!append) setJobs([]);
        return;
      }
      setApiPage(nextApiPage);
      setTotal(res.output.totalCount);
      setJobs((prev) => {
        if (!append || !prev) return res.output.jobs;
        const seen = new Set(prev.map((j) => j.id));
        return [...prev, ...res.output.jobs.filter((j) => !seen.has(j.id))];
      });
      if (!append) setPage(0);
    },
    [q, sort, country, type],
  );

  /* The design opens on a full grid, so the first search runs on arrival. It
     is free and cached for an hour on the server. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void search(1, false), []);

  function toggleSave(job: Job) {
    setSaved((prev) => {
      const next = prev.some((j) => j.id === job.id) ? prev.filter((j) => j.id !== job.id) : [job, ...prev];
      try {
        window.localStorage.setItem(SAVED_KEY, JSON.stringify(next.slice(0, 100)));
      } catch {
        /* Private mode: the bookmark lasts this session only. */
      }
      return next;
    });
  }

  const list = tab === 'saved' ? saved : (jobs ?? []);
  /** Pages already in hand; past the last, Next fetches the board's next page. */
  const loadedPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  /* The label counts the whole result set — the board's estimate — not the 20 fetched so far. */
  const pages = tab === 'discover' ? Math.max(loadedPages, Math.ceil(total / PER_PAGE)) : loadedPages;
  const shown = useMemo(() => list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE), [list, page]);
  const savedIds = useMemo(() => new Set(saved.map((j) => j.id)), [saved]);
  /* Paging past what is loaded fetches the board's next page. */
  const canLoadMore = tab === 'discover' && jobs !== null && jobs.length < total && !busy;

  return (
    <>
      {/*
        The starfield is the section's background rather than an <img> child:
        below the breakpoint `SECTION` turns every child into a flow item, and
        a full-bleed image became a 300px block of stars above the headline.
      */}
      <section
        className={cn('absolute left-ag-tool-x top-[190px] h-[300px] w-ag-tool-wide overflow-hidden rounded-[24px] bg-ag-jf bg-cover bg-center', SECTION)}
        /* The starfield is transparent: layered over the panel's own dark
           gradient, not instead of it — replacing it left white text on pale. */
        style={{ backgroundImage: 'url(/agency/jobfinder-hero.png), var(--ss-grad-ag-jf)' }}
      >

        {/*
          The design's chip reads "NEW: 15 opportunities waiting". There are no
          opportunities — nothing queries listings — so it says what is actually
          true of the panel rather than inventing a number.
        */}
        <span
          className="absolute left-[82px] top-[64px] flex h-[38px] items-center rounded-[19px] px-[14px] text-14 font-semibold"
          style={{ background: 'rgba(120,170,255,0.18)', boxShadow: 'inset 0 0 0 1px rgba(120,170,255,0.5)', color: '#9CC2FF' }}
        >
          {jobs === null ? 'Finding opportunities…' : `NEW: ${total.toLocaleString()} opportunities waiting`}
        </span>

        <h2 className="absolute left-[82px] top-[122px] w-[760px] text-40 font-semibold leading-[1.25] text-white">
          Find Potential Jobs for your Agency on Demand
        </h2>

        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size decorative art off the prototype */}
        <img
          src="/agency/jobfinder-892c.jpg"
          alt=""
          aria-hidden
          className="absolute right-[64px] top-[32px] h-[236px] w-[380px] rounded-[14px] object-cover max-canvas:hidden"
          style={{ objectPosition: 'center 20%', boxShadow: '0 26px 60px -30px rgba(0,0,0,0.7)' }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size decorative art off the prototype */}
        <img
          src="/agency/jobfinder-288d.png"
          alt=""
          aria-hidden
          className="absolute right-[308px] top-[236px] w-[264px] max-canvas:hidden"
          style={{ filter: 'drop-shadow(0 16px 34px rgba(0,0,0,0.5))' }}
        />
      </section>

      <div
        className="absolute left-ag-tool-x top-[520px] flex h-[56px] w-[520px] items-center rounded-[14px] bg-white p-[5px]"
        style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
        role="tablist"
        aria-label="Job Finder"
      >
        {(
          [
            ['discover', 'Discover'],
            ['saved', 'Saved'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setPage(0);
            }}
            className={cn(
              'flex h-[46px] w-[252px] items-center justify-center rounded-[10px] text-16 font-semibold text-ink transition-colors',
              tab === id ? 'bg-cyan-200' : 'bg-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="absolute left-ag-tool-x top-[606px] text-22 font-bold leading-none text-ink">
        {tab === 'saved' ? 'Saved Jobs' : 'Search Jobs'}
      </h3>
      {tab === 'saved' ? (
        <p className="absolute left-ag-tool-x top-[642px] text-16 font-normal" style={{ color: 'rgb(131,131,131)' }}>
          Your bookmarked opportunities, all in one place
        </p>
      ) : null}

      {/*
        The search row belongs to Discover only — the design's `jfIsDiscover`
        guard. Saved shows its subtitle and the list, and nothing else.
      */}
      {tab === 'discover' ? (
        /*
          On the stage every control sits at the design's coordinate. Below the
          breakpoint the stage flattens its own children, and this form is one
          of them — so its controls flatten here, into a wrapping row: search
          on a line of its own, the three drops sharing the next, then Browse.
        */
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search(1, false);
          }}
          className={cn('max-canvas:flex max-canvas:flex-wrap max-canvas:gap-[10px]', FLATTEN_NARROW)}
        >
          <label
            className="absolute left-ag-tool-x top-[648px] flex h-[58px] w-[560px] items-center rounded-[13px] bg-white px-[18px] max-canvas:!w-full"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Job Title, Company, keyword"
              aria-label="Search jobs"
              maxLength={120}
              className="w-full bg-transparent text-16 font-medium text-ink outline-none"
            />
          </label>

          {(
            [
              { x: 630, label: 'Location', value: country, set: setCountry, options: COUNTRIES },
              { x: 820, label: 'Sort by pay', value: sort, set: setSort, options: SORTS },
              { x: 1010, label: 'Job type', value: type, set: setType, options: TYPES },
            ] as const
          ).map((d) => (
            <span
              key={d.label}
              className="absolute top-[648px] block h-[58px] w-[170px] max-canvas:min-w-[150px] max-canvas:flex-1"
              style={{ left: d.x }}
            >
              <select
                value={d.value}
                onChange={(e) => d.set(e.target.value)}
                aria-label={d.label}
                className="h-full w-full cursor-pointer appearance-none rounded-[13px] bg-white pl-[18px] pr-[34px] text-16 font-semibold text-ink outline-none"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
              >
                {d.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <svg
                width="12"
                height="7"
                viewBox="0 0 13 8"
                fill="none"
                aria-hidden
                className="pointer-events-none absolute right-[16px] top-1/2 block -translate-y-1/2"
              >
                <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))}

          <button
            type="submit"
            disabled={busy}
            className="absolute left-[1500px] top-[648px] flex h-[58px] items-center justify-center rounded-[13px] bg-ink px-[24px] text-16 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 max-canvas:w-full"
          >
            {busy ? 'Searching…' : 'Browse Jobs'}
          </button>
        </form>
      ) : null}

      <span className="absolute left-ag-tool-x top-[734px] text-17 font-semibold" style={{ color: 'rgb(91,91,91)' }}>
        {tab === 'saved'
          ? `${saved.length} Saved`
          : jobs === null
            ? 'Searching…'
            : `${total.toLocaleString()} ${total === 1 ? 'Result' : 'Results'}`}
      </span>

      {/* The board's terms ask for a visible credit wherever its jobs appear. */}
      <a
        href="https://himalayas.app/jobs"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-[46px] top-[734px] text-15 font-medium underline"
        style={{ color: 'rgb(91,91,91)' }}
      >
        Jobs from Himalayas
      </a>

      {error ? (
        <p className="absolute left-ag-tool-x top-[762px] text-15 text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <section
          className={cn('absolute left-ag-tool-x top-[772px] w-ag-tool-wide rounded-[16px] bg-white py-[54px] text-center', SECTION)}
          style={{ boxShadow: '0 16px 40px -34px rgba(12,12,12,0.45)' }}
        >
          <p className="text-19 font-bold text-ink">
            {tab === 'saved' ? 'Nothing saved yet' : jobs === null || busy ? 'Finding jobs…' : 'No jobs match that'}
          </p>
          <p className="mx-auto mt-[12px] max-w-[660px] text-16 leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
            {tab === 'saved'
              ? 'Bookmark a job in Discover and it appears here.'
              : jobs === null || busy
                ? 'Looking through remote listings for agency work.'
                : 'Try a broader keyword, or set Location and Job type back to all.'}
          </p>
        </section>
      ) : (
        <div
          /* Three across on the stage, two on a tablet, one on a phone. Not
             `SECTION`, whose flex column would undo the grid. */
          className="absolute left-ag-tool-x top-[772px] grid w-ag-tool-wide grid-cols-3 gap-[18px] max-canvas:grid-cols-2 max-sm:grid-cols-1"
        >
          {shown.map((j) => {
            const on = savedIds.has(j.id);
            const meta = [j.locations.length ? j.locations.slice(0, 2).join(', ') : 'Remote', ago(j.postedAt)]
              .filter(Boolean)
              .join(' · ');
            return (
              <article
                key={j.id}
                className="relative h-[150px] rounded-[16px] bg-white"
                style={{ boxShadow: '0 16px 40px -34px rgba(12,12,12,0.45)' }}
              >
                <span
                  aria-hidden
                  className="absolute left-[20px] top-[22px] flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-[12px] text-26 font-bold text-white"
                  style={{ background: '#635BFF' }}
                >
                  {j.companyLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a third-party logo URL from the job board
                    <img src={j.companyLogo} alt="" className="h-full w-full bg-white object-contain" />
                  ) : (
                    j.company.slice(0, 1).toUpperCase()
                  )}
                </span>
                <p className="absolute left-[88px] right-[66px] top-[22px] truncate text-18 font-bold text-ink" title={j.title}>
                  {j.title}
                </p>
                <p
                  className="absolute left-[88px] right-[66px] top-[52px] truncate text-14 font-medium"
                  style={{ color: '#838383' }}
                  title={`${j.company} · ${meta}`}
                >
                  {j.company} · {meta}
                </p>
                <p
                  className="absolute left-[20px] top-[100px] max-w-[60%] truncate text-17 font-bold"
                  style={{ color: j.salary ? '#26A344' : '#9B9B9B' }}
                >
                  {j.salary ?? (j.employmentType || 'Pay not listed')}
                </p>
                <button
                  type="button"
                  onClick={() => toggleSave(j)}
                  aria-pressed={on}
                  aria-label={on ? `Remove ${j.title} from saved` : `Save ${j.title}`}
                  className="absolute right-[16px] top-[20px] flex h-[40px] w-[40px] items-center justify-center rounded-[10px] transition-colors hover:bg-[rgba(131,131,131,0.06)]"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                >
                  <svg width="14" height="18" viewBox="0 0 15 19" fill="none" aria-hidden className="block">
                    <path
                      d="M1 3.2A2.2 2.2 0 0 1 3.2 1h8.6A2.2 2.2 0 0 1 14 3.2V17.4a.6.6 0 0 1-.96.48L7.5 13.7l-5.54 4.18A.6.6 0 0 1 1 17.4V3.2Z"
                      stroke="#0C0C0C"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      fill={on ? '#0C0C0C' : 'none'}
                    />
                  </svg>
                </button>
                {/* The listing's own application link, unchanged — the board's terms. */}
                <a
                  href={j.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-[16px] right-[16px] flex h-[38px] items-center rounded-[9px] px-[16px] text-14 font-semibold text-ink transition-colors hover:bg-[#6CE8FF]"
                  style={{ background: '#9CEFFF' }}
                >
                  View Job
                </a>
              </article>
            );
          })}
        </div>
      )}

      {shown.length > 0 ? (
        <div className="absolute left-ag-tool-x top-[1130px] flex items-center gap-[14px]">
          <span className="text-16 font-medium" style={{ color: '#5B5B5B' }}>
            Page {page + 1} of {pages}
          </span>
          {[
            { label: 'Previous page', flip: true, can: page > 0, go: () => setPage((p) => p - 1) },
            {
              label: 'Next page',
              flip: false,
              can: page + 1 < loadedPages || canLoadMore,
              go: () => {
                if (page + 1 >= loadedPages) void search(apiPage + 1, true).then(() => setPage((p) => p + 1));
                else setPage((p) => p + 1);
              },
            },
          ].map((pg) => (
            <button
              key={pg.label}
              type="button"
              onClick={pg.go}
              disabled={!pg.can}
              aria-label={pg.label}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.08)] disabled:opacity-40"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
            >
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden className="block" style={{ transform: pg.flip ? 'scaleX(-1)' : undefined }}>
                <path d="m1 1 5 5-5 5" stroke="#3B3B3B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
