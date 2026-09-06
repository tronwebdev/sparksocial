'use client';

import { useEffect, useState } from 'react';
import { AgencyStage } from './AgencyStage';
import { AgencyGrowthTools, AgencyHomeHero, AgencyHomeSummary } from './AgencyHome';
import { AgencyClientTable } from './AgencyClientTable';
import { AgencyClientFinder } from './AgencyClientFinder';
import { AgencyJobFinder } from './AgencyJobFinder';
import { AgencyWizard, WIZ_HEIGHTS, emptyWizardDraft, type WizardDraft } from './AgencyWizard';
import { useAgencyRoster, useConnectedAccounts } from './useAgencyRoster';
import { useNotifications } from '@/lib/notifications';

/**
 * The Agency Portal's view switch — the prototype's own `view` / `cfState` /
 * `wizStep` state, in one place.
 *
 * ── Stage height, which is state and not layout ───────────────────────────
 *
 * The design sizes the page to its content, so height is derived exactly as the
 * prototype derives it:
 *
 *   home          1330 · +100 with a workspace row open · +75 before launch
 *   clientFinder   760 · 1180 once connected
 *   jobFinder     1200
 *   wizard open   max(that, 30 + wizard height + 40)
 *
 * ── The launch latch ─────────────────────────────────────────────────────
 *
 * `ss-agency-launched` in `localStorage`, the prototype's own key. It is a
 * per-browser flag rather than server state because there is nothing on the
 * server to hold it: no agency record exists. That is a real limitation and the
 * last wizard step says so, rather than this pretending the portal was
 * provisioned.
 */

const LATCH = 'ss-agency-launched';

type View = 'home' | 'clientFinder' | 'jobFinder';
/** 0..3 while the wizard is open; `null` when it is closed. */
type WizStep = 0 | 1 | 2 | 3;

export function AgencyPortalScreen() {
  const [view, setView] = useState<View>('home');
  const [launched, setLaunched] = useState(false);
  const [rowOpen, setRowOpen] = useState(false);
  const [cfConnected, setCfConnected] = useState(false);
  const [wizStep, setWizStep] = useState<WizStep | null>(null);
  const [draft, setDraft] = useState<WizardDraft>(emptyWizardDraft);
  /** The design's Search Workspace box, filtering the roster by brand name. */
  const [query, setQuery] = useState('');

  const { roster, error } = useAgencyRoster();
  const { toast } = useNotifications();
  const accounts = useConnectedAccounts();

  /* Read once on mount — `localStorage` is not available while prerendering. */
  useEffect(() => {
    try {
      setLaunched(window.localStorage.getItem(LATCH) === '1');
    } catch {
      /* Private mode. Not launched is the safe reading. */
    }
    const hash = window.location.hash;
    if (hash === '#wizard') setWizStep(0);
    else if (hash === '#clientFinder') setView('clientFinder');
    else if (hash === '#jobFinder') setView('jobFinder');
  }, []);

  let height =
    view === 'clientFinder'
      ? cfConnected
        ? 1180
        : 760
      : view === 'jobFinder'
        ? 1200
        : (rowOpen ? 1430 : 1330) + (launched ? 0 : 75);

  if (wizStep !== null) height = Math.max(height, 30 + WIZ_HEIGHTS[wizStep] + 40);

  function launch() {
    try {
      window.localStorage.setItem(LATCH, '1');
    } catch {
      /* The flag is a convenience; the portal still opens this session. */
    }
    setLaunched(true);
    setWizStep(null);
    setView('home');
    /* The prototype's own launch toast, through the app's notification centre
       rather than a bespoke one — the design's toast is the same affordance. */
    toast({ title: 'Agency launched', body: 'Welcome to your Agency Portal.', topic: 'generic' });
  }

  const q = query.trim().toLowerCase();
  const visible = (roster?.brands ?? []).filter((b) => (q === '' ? true : b.name.toLowerCase().includes(q)));

  const toolTitle =
    view === 'clientFinder' ? (cfConnected ? 'Saved Leads' : 'Client Finder') : view === 'jobFinder' ? 'Job Finder' : undefined;

  return (
    <AgencyStage height={height} toolTitle={toolTitle} toolIcon={view === 'clientFinder'} onBack={() => setView('home')}>
      {view === 'home' ? (
        <>
          {launched ? (
            <AgencyHomeSummary
              totals={roster?.totals ?? { brands: 0, quiet: 0 }}
              accounts={accounts}
              onEditWizard={() => setWizStep(0)}
            />
          ) : (
            <AgencyHomeHero onLaunch={() => setWizStep(0)} />
          )}

          <AgencyGrowthTools
            onClientFinder={() => setView('clientFinder')}
            onJobFinder={() => setView('jobFinder')}
          />

          <AgencyClientTable
            top={launched ? 674 : 745}
            brands={visible}
            windowDays={roster?.windowDays ?? 30}
            onOpenRow={setRowOpen}
          />

          {/*
            "My Clients" and the workspace search — 56,688 and 1226,674 in the
            design, and only in the pre-launch state: the launched card already
            titles the section, so the prototype drops both there.
          */}
          {launched ? null : (
            <>
              <h2 className="absolute left-[56px] top-[688px] text-[24px] font-bold leading-none text-ink">My Clients</h2>
              <label
                className="absolute left-[1226px] top-[674px] flex h-[58px] w-[460px] items-center rounded-[13px] bg-white pl-[20px] pr-[18px]"
                style={{ boxShadow: '0 10px 26px -20px rgba(12,12,12,0.35)' }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Workspace"
                  aria-label="Search Workspace"
                  className="h-full w-[390px] bg-transparent text-[15.5px] font-medium text-ink outline-none"
                />
                <svg width="19" height="19" viewBox="0 0 26 26" fill="none" aria-hidden className="ml-auto block">
                  <circle cx="11" cy="11" r="8" stroke="rgb(91,91,91)" strokeWidth="2" />
                  <path d="m17 17 6 6" stroke="rgb(91,91,91)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </label>
            </>
          )}

          {error ? (
            <p className="absolute left-[56px] text-[15px] text-destructive" style={{ top: launched ? 494 : 721 }}>
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {view === 'clientFinder' ? <AgencyClientFinder onConnected={setCfConnected} /> : null}
      {view === 'jobFinder' ? <AgencyJobFinder /> : null}

      {wizStep !== null ? (
        <AgencyWizard
          step={wizStep}
          draft={draft}
          onDraft={setDraft}
          onBack={() => setWizStep((s) => (s === null || s === 0 ? null : ((s - 1) as WizStep)))}
          onNext={() => {
            if (wizStep === 3) {
              launch();
              return;
            }
            setWizStep((s) => (s === null ? 0 : ((s + 1) as WizStep)));
          }}
          onClose={() => setWizStep(null)}
        />
      ) : null}
    </AgencyStage>
  );
}
