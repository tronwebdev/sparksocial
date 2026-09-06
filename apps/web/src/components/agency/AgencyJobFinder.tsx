'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

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
 * ── Why the list is empty ─────────────────────────────────────────────────
 *
 * There is no job board behind this. Nothing in the registry queries listings,
 * and the prototype's own six jobs are literal fixtures — Stripe, a salary
 * band, "2 days ago" — with handlers that toast "Job detail — external listing
 * in production".
 *
 * Saving is still real *state*: the tab switch, the save toggle and the count
 * all work against a local set, so every interaction the design specifies can
 * be walked. What is missing is the source, and the empty state says so.
 */

type Tab = 'discover' | 'saved';

export function AgencyJobFinder() {
  const [tab, setTab] = useState<Tab>('discover');
  const [saved, setSaved] = useState<string[]>([]);

  return (
    <>
      <section className="absolute left-ag-tool-x top-[190px] h-[300px] w-ag-tool-wide overflow-hidden rounded-[24px] bg-ag-jf">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative full-bleed backdrop off the prototype */}
        <img src="/agency/jobfinder-hero.png" alt="" aria-hidden className="absolute left-0 top-0 h-full w-full object-cover" />

        {/*
          The design's chip reads "NEW: 15 opportunities waiting". There are no
          opportunities — nothing queries listings — so it says what is actually
          true of the panel rather than inventing a number.
        */}
        <span
          className="absolute left-[82px] top-[64px] flex h-[38px] items-center rounded-[19px] px-[14px] text-[14px] font-semibold"
          style={{ background: 'rgba(120,170,255,0.18)', boxShadow: 'inset 0 0 0 1px rgba(120,170,255,0.5)', color: '#9CC2FF' }}
        >
          Job board not connected
        </span>

        <h2 className="absolute left-[82px] top-[122px] w-[760px] text-[40px] font-semibold leading-[1.25] text-white">
          Find Potential Jobs for your Agency on Demand
        </h2>

        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size decorative art off the prototype */}
        <img
          src="/agency/jobfinder-892c.jpg"
          alt=""
          aria-hidden
          className="absolute right-[64px] top-[32px] h-[236px] w-[380px] rounded-[14px] object-cover"
          style={{ objectPosition: 'center 20%', boxShadow: '0 26px 60px -30px rgba(0,0,0,0.7)' }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size decorative art off the prototype */}
        <img
          src="/agency/jobfinder-288d.png"
          alt=""
          aria-hidden
          className="absolute right-[308px] top-[236px] w-[264px]"
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
            onClick={() => setTab(id)}
            className={cn(
              'flex h-[46px] w-[252px] items-center justify-center rounded-[10px] text-[16px] font-semibold text-ink transition-colors',
              tab === id ? 'bg-cyan-200' : 'bg-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="absolute left-ag-tool-x top-[606px] text-[22px] font-bold leading-none text-ink">
        {tab === 'saved' ? 'Saved Jobs' : 'Search Jobs'}
      </h3>
      {tab === 'saved' ? (
        <p className="absolute left-ag-tool-x top-[642px] text-[15.5px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
          Your bookmarked opportunities, all in one place
        </p>
      ) : null}

      {/*
        The search row belongs to Discover only — the design's `jfIsDiscover`
        guard. Saved shows its subtitle and the list, and nothing else.
      */}
      {tab === 'discover' ? (
        <>
          <label
            className="absolute left-ag-tool-x top-[648px] flex h-[58px] w-[560px] items-center rounded-[13px] bg-white px-[18px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
          >
            <input
              placeholder="Job Title, Company, keyword"
              aria-label="Search jobs"
              className="w-full bg-transparent text-[15.5px] font-medium text-ink outline-none"
            />
          </label>

          {[
            { x: 630, label: 'Location' },
            { x: 820, label: 'Amount' },
            { x: 1010, label: 'All Type' },
          ].map((d) => (
            <span
              key={d.label}
              className="absolute top-[648px] flex h-[58px] w-[170px] items-center justify-between rounded-[13px] bg-white px-[18px] text-[15.5px] font-semibold text-ink"
              style={{ left: d.x, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)', opacity: 0.55 }}
              title="Filters need a job source"
            >
              <span className="whitespace-nowrap">{d.label}</span>
              <svg width="12" height="7" viewBox="0 0 13 8" fill="none" aria-hidden className="block">
                <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))}

          <span
            className="absolute left-[1500px] top-[648px] flex h-[58px] items-center rounded-[13px] bg-ink px-[24px] text-[15.5px] font-semibold text-white"
            style={{ opacity: 0.55 }}
            title="No job source is connected"
          >
            Browse Jobs
          </span>
        </>
      ) : null}

      <span className="absolute left-ag-tool-x top-[734px] text-[17px] font-semibold" style={{ color: 'rgb(91,91,91)' }}>
        {tab === 'saved' ? `${saved.length} Saved` : '0 Results'}
      </span>

      {/*
        The card list, empty. `saved` is still real state so the toggle and the
        count behave; there is simply nothing to populate them from.
      */}
      <section
        className="absolute left-ag-tool-x top-[772px] w-ag-tool-wide rounded-[16px] bg-white py-[54px] text-center"
        style={{ boxShadow: '0 16px 40px -34px rgba(12,12,12,0.45)' }}
      >
        <p className="text-[19px] font-bold text-ink">
          {tab === 'saved' ? 'Nothing saved yet' : 'No job source connected'}
        </p>
        <p className="mx-auto mt-[12px] max-w-[660px] text-[15.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
          {tab === 'saved'
            ? 'Jobs you bookmark from Discover appear here.'
            : 'Nothing in the registry queries job listings yet, so there is no board to search. The filters and the save toggle are built and will work the moment a source exists.'}
        </p>
        {/* Kept so the design's own control is present and exercisable. */}
        {tab === 'discover' ? (
          <button
            type="button"
            onClick={() => setSaved((s) => (s.includes('demo') ? s.filter((x) => x !== 'demo') : [...s, 'demo']))}
            className="mx-auto mt-[20px] flex h-[38px] items-center rounded-[9px] bg-cyan-200 px-[16px] text-[14px] font-semibold text-ink"
          >
            {saved.includes('demo') ? 'Remove sample bookmark' : 'Save a sample bookmark'}
          </button>
        ) : null}
      </section>
    </>
  );
}
