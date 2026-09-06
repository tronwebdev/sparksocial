'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * `Client Finder` and `Client Finder Saved Leads` — two states of one tool,
 * switched by whether a lead source is connected.
 *
 * ── Not connected (stage 760) ─────────────────────────────────────────────
 *
 *   panel   46,190 · 1636x430 r24 on `--ss-grad-ag-dark`
 *   head    82,74 · 44/600 white, with a 52px `#26D34A` disc between the words
 *   sub     82,172 · 700 wide · 23/400 `rgba(255,255,255,0.55)`
 *   cta     82,300 · h58 r10 `#26D34A` · 18/700
 *   preview right:36,96 · 520x310 r14 `#FCFDFE`, shadow
 *           `0 30px 70px -40px rgba(0,0,0,0.8)`, over a `jobfinder-hero` starfield
 *   chips   1206,170 · 236x64 r16 "Not connected" · 1462,170 · 220x64 "Import CSV"
 *
 * ── Connected (stage 1180) ────────────────────────────────────────────────
 *
 *   tabs    46,190 · 520x56 r14 white; each half 252x46 r10; the active one
 *           **`#9CEFFF`**, both labels 16/600 `#0C0C0C`
 *   filters search 600,190 · 330x56; two 170x56 drops at 950 and 1140
 *   actions Export Clients 1330,190 · h56 · Find Clients 1508,190 on `#26D34A`
 *   table   46,312 · 1636x806 r20; headers y26; rows **92 -> 170** when opened,
 *           revealing Contact Lead on `#0C0C0C` and four hairline actions
 *
 * ── Why this is honest about being empty ──────────────────────────────────
 *
 * There is no lead-capture capability in the registry: nothing scrapes
 * businesses, no third-party CRM is integrated, and `Clienforce` is a fictional
 * product in the design. The prototype's own handlers are all `this.toast(...)`
 * — "Lead capture run started — mock", "CSV imported — 24 leads added".
 *
 * So this builds the screen and its interactions exactly, and the connect and
 * import paths move to the connected state with **no leads**, saying what would
 * fill it. A table pre-populated with Sunnyvale Innovations would be the most
 * convincing fiction in the product: four rows that look like real pipeline.
 */

type Tab = 'search' | 'saved';

export function AgencyClientFinder({ onConnected }: { onConnected: (v: boolean) => void }) {
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Tab>('saved');

  /* Lifted so the stage can grow 760 -> 1180, which the design does on connect. */
  function connect() {
    setConnected(true);
    setTab('saved');
    onConnected(true);
  }

  if (!connected) {
    return (
      <>
        <section className="absolute left-ag-tool-x top-[190px] h-[430px] w-ag-tool-wide overflow-hidden rounded-[24px] bg-ag-dark">
          {/* The starfield the design lays over the gradient. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a decorative full-bleed backdrop off the prototype */}
          <img src="/agency/jobfinder-hero.png" alt="" aria-hidden className="absolute left-0 top-0 h-full w-full object-cover" />

          <div className="absolute left-[82px] top-[74px] flex items-center gap-[18px]">
            <span className="whitespace-nowrap text-[44px] font-semibold leading-none text-white">Connect to</span>
            <span
              aria-hidden
              className="flex h-[52px] w-[52px] items-center justify-center rounded-full text-[30px] font-extrabold italic text-white"
              style={{ background: 'var(--ss-ag-clienforce)' }}
            >
              f
            </span>
            <span className="whitespace-nowrap text-[44px] font-semibold leading-none text-white">Clienforce</span>
          </div>

          <p className="absolute left-[82px] top-[172px] w-[700px] text-[23px] font-normal leading-[1.35]" style={{ color: 'rgba(255,255,255,0.55)' }}>
            An incredibly powerful tool designed to seamlessly connect businesses with potential clients
            and customers.
          </p>

          <button
            type="button"
            onClick={connect}
            className="absolute left-[82px] top-[300px] flex h-[58px] items-center rounded-[10px] px-[24px] text-[18px] font-bold text-white transition-[background-color,transform] hover:bg-[#1FBE41] active:scale-[0.985]"
            style={{ background: 'var(--ss-ag-clienforce)' }}
          >
            + Connect Clienforce
          </button>

          {/* The product preview the design floats over the panel's right half. */}
          <div
            className="absolute right-[36px] top-[96px] h-[310px] w-[520px] overflow-hidden rounded-[14px]"
            style={{ background: '#FCFDFE', boxShadow: '0 30px 70px -40px rgba(0,0,0,0.8)' }}
          >
            <div className="absolute left-0 top-0 flex h-[44px] w-full items-center gap-[16px] px-[18px]" style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.15)' }}>
              <span className="text-[12px] font-semibold" style={{ color: 'rgb(91,91,91)' }}>Contacts</span>
              {['Analytics', 'Playbook', 'Widgets', 'Chrome Ext', 'Settings'].map((t) => (
                <span key={t} className="text-[12px] font-medium" style={{ color: '#9B9B9B' }}>{t}</span>
              ))}
            </div>

            <span className="absolute left-[18px] top-[60px] text-[13px] font-bold text-ink">Capture Automation</span>
            <span className="absolute left-[18px] top-[82px] w-[280px] text-[11px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
              With rules, the agent will automatically find &amp; add new clients
            </span>
            <span
              className="absolute left-[18px] top-[120px] flex h-[30px] items-center rounded-[7px] px-[10px] text-[11.5px] font-semibold text-ink"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
            >
              + Add New Rule
            </span>
            <div className="absolute left-[18px] top-[166px] flex gap-[8px]">
              {['Industry', 'Location', '10km', '10 Leads/Run'].map((d) => (
                <span
                  key={d}
                  className="flex h-[28px] items-center gap-[6px] rounded-[6px] px-[9px] text-[10.5px] font-medium"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)', color: 'rgb(91,91,91)' }}
                >
                  <span className="whitespace-nowrap">{d}</span>
                  <svg width="8" height="5" viewBox="0 0 13 8" fill="none" aria-hidden className="block">
                    <path d="m1 1 5.5 6L12 1" stroke="#838383" strokeWidth="1.8" />
                  </svg>
                </span>
              ))}
            </div>

            {/* "Sample Leads Preview" — part of the connector's own screenshot. */}
            <div
              className="absolute right-[16px] top-[60px] h-[230px] w-[170px] rounded-[10px] bg-white"
              style={{ boxShadow: '0 10px 30px -18px rgba(12,12,12,0.4), inset 0 0 0 1px rgba(131,131,131,0.15)' }}
            >
              <span className="absolute left-[12px] top-[10px] text-[11.5px] font-bold text-ink">Sample Leads Preview</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="relative h-[52px]" style={{ marginTop: i === 0 ? 32 : 6 }}>
                  <span aria-hidden className="absolute left-[12px] top-[14px] block h-[26px] w-[26px] rounded-full" style={{ background: '#DCEFE2' }} />
                  <span aria-hidden className="absolute left-[46px] top-[16px] block h-[7px] w-[76px] rounded-[3px]" style={{ background: '#E8EDEA' }} />
                  <span aria-hidden className="absolute left-[46px] top-[28px] block h-[5px] w-[60px] rounded-[3px]" style={{ background: '#DFF2E4' }} />
                  <span
                    aria-hidden
                    className="absolute right-[12px] top-[16px] flex h-[20px] items-center rounded-[10px] px-[8px] text-[9px] font-bold text-white"
                    style={{ background: 'var(--ss-ag-clienforce)' }}
                  >
                    Connect
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* the two status chips, level above the panel */}
        <div
          className="absolute left-[1206px] top-[170px] z-[3] flex h-[64px] w-[236px] items-center justify-center gap-[12px] rounded-[16px] bg-white"
          style={{ boxShadow: '0 14px 34px -20px rgba(12,12,12,0.45)' }}
        >
          <span
            aria-hidden
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[17px] font-extrabold text-white"
            style={{ background: 'var(--ss-ag-clienforce)' }}
          >
            f
          </span>
          <span className="text-[17px] font-bold text-ink">Not connected</span>
        </div>

        <button
          type="button"
          onClick={connect}
          className="absolute left-[1462px] top-[170px] z-[3] flex h-[64px] w-[220px] items-center justify-center gap-[12px] rounded-[16px] bg-white transition-shadow hover:shadow-card"
          style={{ boxShadow: '0 14px 34px -20px rgba(12,12,12,0.45)' }}
        >
          <span
            aria-hidden
            className="flex h-[30px] items-center rounded-[6px] px-[7px] text-[11px] font-bold"
            style={{ background: '#EFEFEF', color: 'rgb(91,91,91)' }}
          >
            CSV
          </span>
          <span className="text-[17px] font-bold text-ink">Import CSV</span>
        </button>
      </>
    );
  }

  /* ── connected ─────────────────────────────────────────────────────── */
  return (
    <>
      <div
        className="absolute left-ag-tool-x top-[190px] flex h-[56px] w-[520px] items-center rounded-[14px] bg-white p-[5px]"
        style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
        role="tablist"
        aria-label="Client Finder"
      >
        {(
          [
            ['search', 'My Search'],
            ['saved', 'Saved Leads'],
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

      <span className="absolute left-ag-tool-x top-[272px] text-[17px] font-semibold" style={{ color: 'rgb(91,91,91)' }}>
        0 Results
      </span>

      <label
        className="absolute left-[600px] top-[190px] flex h-[56px] w-[330px] items-center rounded-[14px] bg-white px-[18px]"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
      >
        <input
          placeholder="Search clients"
          aria-label="Search clients"
          className="w-full bg-transparent text-[15.5px] font-medium text-ink outline-none"
        />
        <svg width="18" height="18" viewBox="0 0 26 26" fill="none" aria-hidden className="ml-[10px] block shrink-0">
          <circle cx="11" cy="11" r="8" stroke="#838383" strokeWidth="2" />
          <path d="m17 17 6 6" stroke="#838383" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </label>

      {[
        { x: 950, label: 'Sources' },
        { x: 1140, label: 'Folder' },
      ].map((d) => (
        <span
          key={d.label}
          className="absolute top-[190px] flex h-[56px] w-[170px] items-center justify-between rounded-[14px] bg-white px-[18px] text-[15.5px] font-semibold text-ink"
          style={{ left: d.x, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)', opacity: 0.55 }}
          title="Filters need leads to filter"
        >
          <span className="whitespace-nowrap">{d.label}</span>
          <svg width="12" height="7" viewBox="0 0 13 8" fill="none" aria-hidden className="block">
            <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ))}

      <span
        className="absolute left-[1330px] top-[190px] flex h-[56px] items-center rounded-[14px] bg-white px-[20px] text-[15.5px] font-semibold text-ink"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)', opacity: 0.55 }}
        title="Nothing to export yet"
      >
        Export Clients
      </span>

      <span
        className="absolute left-[1508px] top-[190px] flex h-[56px] items-center rounded-[14px] px-[22px] text-[15.5px] font-bold text-white"
        style={{ background: 'var(--ss-ag-clienforce)', opacity: 0.55 }}
        title="No lead-capture tool exists yet"
      >
        Find Clients
      </span>

      <section
        className="absolute left-ag-tool-x top-[312px] h-[806px] w-ag-tool-wide rounded-[20px] bg-white"
        style={{ boxShadow: '0 20px 50px -42px rgba(12,12,12,0.4)' }}
      >
        {[
          { x: 30, label: 'Business Name' },
          { x: 760, label: 'Location' },
          { x: 1010, label: 'Ranking' },
          { x: 1230, label: 'Status' },
          { x: 1500, label: 'View' },
        ].map((h) => (
          <span
            key={h.label}
            className="absolute top-[26px] whitespace-nowrap text-[16px] font-semibold"
            style={{ left: h.x, color: 'rgb(91,91,91)' }}
          >
            {h.label}
          </span>
        ))}
        <div aria-hidden className="absolute left-0 top-[64px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

        {/*
          Empty, and it says why rather than showing the design's four fixture
          leads. Nothing in the registry captures leads — no scraper, no CRM
          integration — and "Clienforce" is a product invented for the mock.
        */}
        <div className="absolute left-[30px] right-[30px] top-[110px] text-center">
          <p className="text-[19px] font-bold text-ink">
            {tab === 'saved' ? 'No saved leads yet' : 'No search has been run'}
          </p>
          <p className="mx-auto mt-[12px] max-w-[620px] text-[15.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
            Lead capture is not wired up: no tool in the registry finds businesses or reads a CRM, and
            the connector this screen offers does not exist yet. Connecting and importing move you here
            so the flow is walkable — the rows arrive when the capability does.
          </p>
        </div>

        <div aria-hidden className="absolute left-0 top-[740px] h-px w-full" style={{ background: 'rgba(131,131,131,0.1)' }} />
        <span className="absolute left-[30px] top-[760px] text-[16px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
          Page 1 of 1
        </span>
      </section>
    </>
  );
}
