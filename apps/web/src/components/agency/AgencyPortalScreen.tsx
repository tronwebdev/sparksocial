'use client';

import { useEffect, useState } from 'react';
import { AgencyStage } from './AgencyStage';
import { AgencyGrowthTools, AgencyHomeHero, AgencyHomeSummary } from './AgencyHome';
import { AgencyClientTable, clientTableHeight } from './AgencyClientTable';
import { AgencyClientFinder } from './AgencyClientFinder';
import { AgencyJobFinder } from './AgencyJobFinder';
import { AgencyWizard, WIZ_HEIGHTS, emptyWizardDraft, type WizardDraft } from './AgencyWizard';
import { connectedAccounts, useAgencyRoster } from './useAgencyRoster';
import { useAgencySite } from './useAgencySite';
import { useNotifications } from '@/lib/notifications';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';

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
 * ── Launched, and what the wizard remembers ──────────────────────────────
 *
 * `agency.profile.get` — the wizard's answers saved on the org, and whether it
 * has been launched. This used to be `ss-agency-launched` in `localStorage`,
 * the prototype's own key, so the portal was launched in one browser and not
 * in any other, and "Edit Wizard" opened an empty form. The old key is still
 * read once, so an agency launched that way does not drop back to the
 * pre-launch hero; its next save moves it to the server.
 */

const LEGACY_LATCH = 'ss-agency-launched';

/** The wizard's draft as `agency.profile.set` takes it. */
function toProfile(d: WizardDraft) {
  return {
    model: d.model === 1 ? 'personal_brand' : 'local_business',
    name: d.name,
    yourName: d.yourName,
    phone: d.phone,
    email: d.email.trim(),
    tagline: d.tagline,
    tone: d.tone,
    timezone: d.timezone,
    colors: d.colors,
    titleFont: d.titleFont,
    service: d.service,
    layout: d.layout,
    template: d.template,
    domain: d.domain,
  };
}

type SavedProfile = ReturnType<typeof toProfile> & {
  collateral?: { facebookCover?: string; linkedinBanner?: string };
};

function fromProfile(p: SavedProfile): WizardDraft {
  return { ...emptyWizardDraft(), ...p, model: p.model === 'personal_brand' ? 1 : 0 };
}

type View = 'home' | 'clientFinder' | 'jobFinder';
/** 0..3 while the wizard is open; `null` when it is closed. */
type WizStep = 0 | 1 | 2 | 3;

export function AgencyPortalScreen() {
  const [view, setView] = useState<View>('home');
  const [launched, setLaunched] = useState(false);
  const [rowOpen, setRowOpen] = useState(false);
  /**
   * True once the pipeline has anything in it. The design grows this view
   * 760 → 1180 on connecting a lead source; the real trigger is having leads,
   * because the source it depicts does not exist. See `AgencyClientFinder`.
   */
  const [cfHasLeads, setCfHasLeads] = useState(false);
  const [wizStep, setWizStep] = useState<WizStep | null>(null);
  const [draft, setDraft] = useState<WizardDraft>(emptyWizardDraft);
  const [saving, setSaving] = useState(false);
  const [collateral, setCollateral] = useState<{ facebookCover?: string; linkedinBanner?: string }>({});
  const [generating, setGenerating] = useState<'facebook_cover' | 'linkedin_banner' | null>(null);
  /** Why the last save failed, shown on the wizard's last step. */
  const [saveNote, setSaveNote] = useState<string | null>(null);
  /** The design's Search Workspace box, filtering the roster by brand name. */
  const [query, setQuery] = useState('');

  const { roster, error, reload } = useAgencyRoster();
  const { toast } = useNotifications();
  const accounts = connectedAccounts(roster?.brands);
  const site = useAgencySite();

  /* Read once on mount — `localStorage` is not available while prerendering. */
  useEffect(() => {
    let legacy = false;
    try {
      legacy = window.localStorage.getItem(LEGACY_LATCH) === '1';
    } catch {
      /* Private mode. Not launched is the safe reading. */
    }
    setLaunched(legacy);
    void invoke<{ profile: SavedProfile | null; launched: boolean }>('agency.profile.get', {}).then((res) => {
      if (res.status !== 'succeeded') return;
      if (res.output.profile) {
        setDraft(fromProfile(res.output.profile));
        setCollateral(res.output.profile.collateral ?? {});
      }
      setLaunched(res.output.launched || legacy);
    });
    const hash = window.location.hash;
    if (hash === '#wizard') setWizStep(0);
    else if (hash === '#clientFinder') setView('clientFinder');
    else if (hash === '#jobFinder') setView('jobFinder');
  }, []);

  let height =
    view === 'clientFinder'
      ? cfHasLeads
        ? 1180
        : 760
      : view === 'jobFinder'
        ? 1200
        : (rowOpen ? 1430 : 1330) + (launched ? 0 : 75);

  if (wizStep !== null) height = Math.max(height, 30 + WIZ_HEIGHTS[wizStep] + 40);

  /** Saves the wizard's answers on the org. Launch also stamps it launched. */
  async function save(launch: boolean): Promise<boolean> {
    const res = await invoke('agency.profile.set', { profile: toProfile(draft), launch });
    if (res.status === 'succeeded') {
      setSaveNote(null);
      return true;
    }
    setSaveNote(res.status === 'failed' ? userMessage(res.error) : 'Saving the agency needs an approval first.');
    return false;
  }

  /** Portal Home's banner cards. */
  async function generateBanner(kind: 'facebook_cover' | 'linkedin_banner') {
    if (generating) return;
    setGenerating(kind);
    const res = await invoke<{ url: string }>('agency.collateral.generate', { kind }, crypto.randomUUID());
    setGenerating(null);
    if (res.status === 'succeeded') {
      setCollateral((c) => ({ ...c, [kind === 'facebook_cover' ? 'facebookCover' : 'linkedinBanner']: res.output.url }));
      return;
    }
    toast({
      title: 'The banner wasn’t made',
      body: res.status === 'failed' ? userMessage(res.error) : 'That needs an approval first.',
      topic: 'generic',
    });
  }

  async function launch() {
    setSaving(true);
    const ok = await save(true);
    setSaving(false);
    if (!ok) return;
    try {
      window.localStorage.removeItem(LEGACY_LATCH);
    } catch {
      /* Nothing to clean up. */
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

  /*
    The home view's 1330 is the design's, for its three mock clients. The stage
    clips at its own height, so a real org with seven brands had its last four
    rows cut off below it. The stage grows to the table, keeping the design's
    175 of space beneath it.
  */
  if (view === 'home' && wizStep === null) {
    height = Math.max(height, (launched ? 674 : 745) + clientTableHeight(visible.length, rowOpen) + 175);
  }

  const toolTitle =
    view === 'clientFinder' ? (cfHasLeads ? 'Client Pipeline' : 'Client Finder') : view === 'jobFinder' ? 'Job Finder' : undefined;

  return (
    <AgencyStage height={height} toolTitle={toolTitle} toolIcon={view === 'clientFinder'} onBack={() => setView('home')}>
      {view === 'home' ? (
        <>
          {launched ? (
            <AgencyHomeSummary
              totals={roster?.totals ?? { brands: 0, quiet: 0 }}
              accounts={accounts}
              onEditWizard={() => setWizStep(0)}
              websiteUrl={site.site?.published ? site.site.url : null}
              collateral={collateral}
              onGenerate={(kind) => void generateBanner(kind)}
              generating={generating}
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
            onDeleted={() => void reload()}
          />

          {/*
            "My Clients" and the workspace search — 56,688 and 1226,674 in the
            design, and only in the pre-launch state: the launched card already
            titles the section, so the prototype drops both there.
          */}
          {launched ? null : (
            <>
              <h2 className="absolute left-[56px] top-[688px] text-24 font-bold leading-none text-ink">My Clients</h2>
              <label
                className="absolute left-[1226px] top-[674px] flex h-[58px] w-[460px] items-center rounded-[13px] bg-white pl-[20px] pr-[18px]"
                style={{ boxShadow: '0 10px 26px -20px rgba(12,12,12,0.35)' }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Workspace"
                  aria-label="Search Workspace"
                  className="h-full w-[390px] bg-transparent text-16 font-medium text-ink outline-none"
                />
                <svg width="19" height="19" viewBox="0 0 26 26" fill="none" aria-hidden className="ml-auto block">
                  <circle cx="11" cy="11" r="8" stroke="rgb(91,91,91)" strokeWidth="2" />
                  <path d="m17 17 6 6" stroke="rgb(91,91,91)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </label>
            </>
          )}

          {error ? (
            <p className="absolute left-[56px] text-15 text-destructive" style={{ top: launched ? 494 : 721 }}>
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {view === 'clientFinder' ? (
        <AgencyClientFinder
          onHasLeads={setCfHasLeads}
          /* `lead.convert` attaches a won lead to a real workspace, so the
             picker needs the org's brands — the same roster the table reads. */
          brands={(roster?.brands ?? []).map((b) => ({ brandId: b.brandId, name: b.name }))}
        />
      ) : null}
      {view === 'jobFinder' ? <AgencyJobFinder /> : null}

      {wizStep !== null ? (
        <AgencyWizard
          step={wizStep}
          draft={draft}
          onDraft={setDraft}
          accounts={accounts}
          onBack={() => setWizStep((s) => (s === null || s === 0 ? null : ((s - 1) as WizStep)))}
          onNext={() => {
            if (wizStep === 3) {
              void launch();
              return;
            }
            /* Each Continue saves, so closing half-way keeps what was entered. A
               failure is held for the last step, where Launch tries again. */
            void save(false);
            setWizStep((s) => (s === null ? 0 : ((s + 1) as WizStep)));
          }}
          onClose={() => setWizStep(null)}
          busy={saving}
          note={wizStep === 3 ? saveNote : null}
          onSaveProfile={() => save(false)}
          site={site}
        />
      ) : null}
    </AgencyStage>
  );
}
