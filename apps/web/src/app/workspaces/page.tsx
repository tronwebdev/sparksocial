'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useClerk, useOrganizationList, useUser } from '@clerk/nextjs';
import { invoke } from '@/lib/tools';
import { writeSelectedGenome } from '@/lib/selectedGenome';
import { NotificationBell } from '@/components/notifications/NotificationBell';

/**
 * Workspaces — `ui build/SparkSocial Account Home.dc.html`.
 *
 * Where signing in lands.
 *
 * ── Why this no longer uses `Stage` ───────────────────────────────────────
 *
 * It did, because the prototype does: a 1728×800 canvas scaled by
 * `innerWidth / 1728`. That is fine for a design file and unusable as a
 * product. At 390px the scale is 0.226, so the 26px wordmark renders at 5.9px
 * and the 15.5px labels at 3.5px — the whole screen becomes a legible-only-if-
 * you-zoom photograph of a desktop app. The onboarding screens can live with it
 * because they are a guided flow nobody runs on a phone mid-signup; this is the
 * screen you land on every time you sign in.
 *
 * So the layout is real: a `max-w-[1728px]` container with the prototype's 42px
 * gutters, which reproduces its measurements exactly at 1728 and reflows below.
 * Everything inside the hero that is decoration — the orbs, the robot, the
 * floating avatar — is still absolutely placed, and hidden under `lg` where
 * there is no room for it.
 *
 * ── Why it lives outside both route groups ────────────────────────────────
 *
 * Not in `(app)`: that layout runs `OrgGuard`, which activates an organization
 * before rendering. A picker that cannot be reached until something has already
 * been picked is not a picker. Not in `(auth)` either — that layout paints the
 * sky backdrop, and this screen has its own. A top-level route gets the root
 * layout alone, and `middleware.ts` protects everything it does not list.
 *
 * ── A workspace is a Clerk organization ──────────────────────────────────
 *
 * `apps/api/src/clerk-auth.ts` reads `org_id` off the session token, so picking
 * a card is `setActive({ organization })` — the thing that makes every
 * subsequent tool call resolve to that tenant's data. The prototype's cards are
 * five fixtures; these are the caller's real memberships.
 *
 * The prototype draws three member avatars per card. Clerk's membership list
 * carries `membersCount` but not the members themselves — those need a fetch per
 * organization, which for a five-card grid is five round trips before anything
 * paints. So the stack shows the viewer's own avatar and a count bubble for
 * everyone else, from data already in hand. Same shape, no invented faces.
 */

/** The prototype's five card fills, cycled — a brand has no colour of its own. */
const CARD_BG = ['#C9F0FA', '#D9F4DC', '#FBDCD4', '#FBF0D4', '#EDDBF8'] as const;
/** Its five workspace glyphs, likewise cycled where an org has no image set. */
const CARD_ICON = [
  '/workspaces/ws-icon-3.png',
  '/workspaces/ws-icon-2.png',
  '/workspaces/ws-icon-1.png',
  '/workspaces/ws-icon-4.png',
  '/workspaces/ws-icon-5.png',
] as const;

const MUTED = '#5B5B5B';

/** One brand in this account, as `genome.list` returns it. */
interface BrandCard {
  genomeId: string;
  brandId: string;
  name: string;
  updatedAt: string;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const { user } = useUser();
  const { orgId } = useAuth();
  const { signOut, openUserProfile } = useClerk();
  const { isLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true, pageSize: 20 },
  });

  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /**
   * The brands in this account.
   *
   * This screen listed *organisations* and its create button called
   * `createOrganization`, which is why naming something here and then naming a
   * brand in onboarding read as being asked twice: they were two different
   * records. A person creates one account — `OrgGuard`'s "Name your account" —
   * and then as many brands inside it as they run. Workspace and brand are the
   * same thing (PRD §4, "Brand (Workspace)"), so this lists brands, and the
   * name is typed once, in onboarding, where the genome is actually created.
   *
   * PRD §8.3 `DASH-A-01` describes this level as an "Account Dashboard (brands
   * list…)", which is what it now is.
   */
  const [brands, setBrands] = useState<BrandCard[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<{ genomes: BrandCard[] }>('genome.list', {});
      /* Null stays null on failure so the grid shows its loading state rather
         than an empty one — "you have no brands" is a different claim from
         "we could not ask". */
      if (res.status === 'succeeded') setBrands(res.output.genomes);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2300);
    return () => clearTimeout(t);
  }, [toast]);

  const memberships = userMemberships?.data ?? [];

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (brands ?? [])
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => !q || b.name.toLowerCase().includes(q));
  }, [brands, query]);

  /** Open a brand: select it, then land on its dashboard. */
  function open(genomeId: string) {
    if (busy || !orgId) return;
    setBusy(true);
    writeSelectedGenome(orgId, genomeId);
    /*
      A full navigation rather than `router.push`. The selection is a cookie the
      server reads on the next request, and a client-side transition would
      render the shell against the brand the page was loaded with — the same
      reason the organisation switch below reloads.
    */
    window.location.assign('/home');
  }

  /**
   * Switching account, kept only for somebody who belongs to more than one.
   *
   * A person creates exactly one, so this is normally invisible. It exists
   * because an agency can *invite* you into theirs, and removing the only way
   * to reach it would strand you in yours.
   */
  async function switchAccount(organizationId: string) {
    if (!setActive || busy) return;
    setBusy(true);
    await setActive({ organization: organizationId });
    window.location.assign('/');
  }

  /**
   * Adding a brand is onboarding, and nothing else.
   *
   * This used to `createOrganization` and then send you to onboarding, so the
   * name typed here named an *account* and the name typed there named the
   * brand — the same thing asked for twice, in two records. Onboarding is where
   * `genome.create` runs, so that is the only place a brand is named.
   */
  function addBrand() {
    if (busy) return;
    setBusy(true);
    window.location.assign('/onboarding');
  }

  const firstName = user?.firstName ?? user?.username ?? 'Account';

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: 'linear-gradient(180deg, #F6FAFC 0%, #EDF3F7 55%, #E9F0F5 100%)' }}
    >
      <div className="mx-auto w-full max-w-[1728px] px-4 pb-16 sm:px-8 xl:px-[42px]">
        {/* ── top bar ─────────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center gap-3 pt-6 xl:flex-nowrap xl:pt-[38px]">
          <span
            className="mr-auto whitespace-nowrap text-[20px] font-extrabold tracking-[-0.02em] text-ink sm:text-[26px]"
          >
            Sparksocial
          </span>

          {/*
            The two chips are one 56px pill on the prototype. Under `md` the
            labels go and the pill becomes two icon buttons, because "Account
            Settings" and "Agency Portal" together are 300px of text.
          */}
          <div
            className="flex h-12 items-center rounded-full bg-white px-2 sm:h-14"
            style={{ boxShadow: '0 10px 26px -18px rgba(12,12,12,0.35)' }}
          >
            <BarButton onClick={() => router.push('/settings')} label="Account Settings">
              <svg width="17" height="17" viewBox="0 0 22 22" fill="none" aria-hidden>
                <circle cx="9" cy="7" r="2.8" stroke={MUTED} strokeWidth="1.6" />
                <path d="M3 17c1-2.7 3.2-4.2 6-4.2 1 0 1.9.2 2.7.5" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" />
                <path d="m15.8 12.6.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4Z" stroke={MUTED} strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </BarButton>
            {/*
              Was disabled, titled "not part of this release" — true when
              written, because there was no portal route to send it to. `/agency`
              exists now (`(cc)/agency`), so the button goes there.
            */}
            <BarButton onClick={() => router.push('/agency')} label="Agency Portal">
              <svg width="16" height="15" viewBox="0 0 16 15" fill="none" aria-hidden>
                <rect x="1" y="4" width="14" height="10" rx="2.4" stroke={MUTED} strokeWidth="1.4" />
                <path d="M5.5 4V2.8A1.8 1.8 0 0 1 7.3 1h1.4a1.8 1.8 0 0 1 1.8 1.8V4" stroke={MUTED} strokeWidth="1.4" />
              </svg>
            </BarButton>
          </div>

          {/* Was a disabled placeholder titled "the notification centre is not
              built yet". It is now, and this is the same component the app
              header carries — see `components/notifications/NotificationBell`. */}
          <span className="hidden shrink-0 sm:block">
            <NotificationBell />
          </span>

          {/* 254×56 chip. Under `sm` the name drops and it is the avatar plus
              the kebab, which is the only part that has to stay reachable. */}
          <div className="relative shrink-0">
            <div
              className="flex h-12 items-center gap-2 rounded-full bg-white pl-2 pr-1 sm:h-14 sm:pr-1.5 xl:w-[254px]"
              style={{ boxShadow: '0 10px 26px -18px rgba(12,12,12,0.35)' }}
            >
              <span className="relative block h-10 w-10 shrink-0">
                <span
                  className="block h-10 w-10 rounded-full"
                  style={{
                    background: user?.imageUrl
                      ? `#BDEBFA url('${user.imageUrl}') center / cover no-repeat`
                      : '#BDEBFA',
                  }}
                />
                <span
                  className="absolute -bottom-0.5 -right-0.5 block h-[14px] w-[14px] rounded-full"
                  style={{ background: '#13D711', boxShadow: '0 0 0 2px #FFFFFF' }}
                />
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-[16.5px] font-bold text-ink sm:block">
                {firstName}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                aria-label="Account menu"
                aria-expanded={menuOpen}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent"
              >
                <svg width="4" height="17" viewBox="0 0 4 17" fill={MUTED} aria-hidden>
                  <circle cx="2" cy="2" r="1.8" />
                  <circle cx="2" cy="8.5" r="1.8" />
                  <circle cx="2" cy="15" r="1.8" />
                </svg>
              </button>
            </div>

            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-40 border-0 bg-transparent"
                />
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[254px] rounded-2xl bg-white p-2 shadow-overlay">
                  <MenuItem active label="Profile" onClick={() => openUserProfile()}>
                    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                      <rect x="2.5" y="2.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="11" cy="9" r="2.6" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M5.8 17.6c1.1-2.4 3-3.7 5.2-3.7s4.1 1.3 5.2 3.7" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                  </MenuItem>
                  {/*
                    Switching account, and only when there is more than one to
                    switch to.

                    A person creates exactly one account, so this is normally
                    absent — but an agency can invite you into theirs, and
                    without this there would be no way back out of it. Rendered
                    as one row per membership rather than a submenu: two or three
                    is the realistic count.
                  */}
                  {isLoaded && memberships.length > 1
                    ? memberships.map((m) => (
                        <MenuItem
                          key={m.organization.id}
                          label={`Account: ${m.organization.name}`}
                          active={m.organization.id === orgId}
                          onClick={() => void switchAccount(m.organization.id)}
                        >
                          <svg width="17" height="16" viewBox="0 0 16 15" fill="none" aria-hidden>
                            <rect x="1" y="4" width="14" height="10" rx="2.4" stroke={MUTED} strokeWidth="1.3" />
                            <path d="M5.5 4V2.8A1.8 1.8 0 0 1 7.3 1h1.4a1.8 1.8 0 0 1 1.8 1.8V4" stroke={MUTED} strokeWidth="1.3" />
                          </svg>
                        </MenuItem>
                      ))
                    : null}
                  <MenuItem label="Account Settings" onClick={() => router.push('/settings')}>
                    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M11 2.6v2.2M11 17.2v2.2M2.6 11h2.2M17.2 11h2.2M4.9 4.9l1.6 1.6M15.5 15.5l1.6 1.6M4.9 17.1l1.6-1.6M15.5 6.5l1.6-1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </MenuItem>
                  {/* Neither exists as a route. Drawn, disabled, honest about it. */}
                  <MenuItem label="Bonuses" disabled title="Bonuses are not built yet.">
                    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                      <rect x="2.5" y="7" width="17" height="5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M4.5 12v6.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V12M11 7v13M7.2 7a2.3 2.3 0 1 1 3.8-2.4A2.3 2.3 0 1 1 14.8 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </MenuItem>
                  <MenuItem label="Resources/Trainings" disabled title="Resources and trainings are not built yet.">
                    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                      <path d="M11 4.8C9.2 3.4 6.8 3 3.5 3v14c3.3 0 5.7.4 7.5 1.8 1.8-1.4 4.2-1.8 7.5-1.8V3c-3.3 0-5.7.4-7.5 1.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M11 4.8v14" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </MenuItem>
                  <MenuItem label="Logout" onClick={() => void signOut({ redirectUrl: '/sign-in' })}>
                    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                      <path d="M8.5 2.8H5a2 2 0 0 0-2 2v12.4a2 2 0 0 0 2 2h3.5M14 15l4-4-4-4M18 11H8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </MenuItem>
                </div>
              </>
            ) : null}
          </div>
        </header>

        {/* ── hero ────────────────────────────────────────────────────────── */}
        <section
          className="relative mt-6 overflow-hidden rounded-[20px] px-6 py-8 sm:px-[50px] sm:py-[44px] xl:mt-[24px] xl:min-h-[272px]"
          style={{ background: '#05070C' }}
        >
          <img
            src="/workspaces/jobfinder-hero.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-90"
          />
          {/* Decoration. Hidden below `lg`, where the hero is a third the width
              and these would sit on top of the search field. */}
          <div aria-hidden className="hidden lg:block">
            <div
              className="absolute -top-[120px] right-[140px] h-[520px] w-[520px] rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(140,80,220,0.36) 0%, rgba(90,50,160,0.18) 55%, rgba(0,0,0,0) 75%)',
              }}
            />
            <div
              className="absolute -bottom-[260px] -right-[80px] h-[620px] w-[620px] rounded-full"
              style={{ boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.12)', background: 'rgba(20,24,36,0.35)' }}
            />
            <div
              className="absolute right-[330px] top-[88px] h-16 w-[152px] rounded-[34px]"
              style={{
                background: 'linear-gradient(140deg, #2A3350 0%, #171C2E 100%)',
                boxShadow: '0 24px 50px -18px rgba(120,80,240,0.55), inset 0 1px 4px rgba(255,255,255,0.18)',
              }}
            >
              <span className="absolute left-[26px] top-6 h-4 w-4 rounded-full bg-white" style={{ boxShadow: '0 0 16px rgba(255,255,255,0.9)' }} />
              <span className="absolute right-[26px] top-6 h-4 w-4 rounded-full" style={{ background: '#8FD4FF', boxShadow: '0 0 16px rgba(143,212,255,0.9)' }} />
            </div>
            <img
              src="/workspaces/ws-hero-robot.png"
              alt=""
              className="absolute right-[560px] top-9 h-[58px] w-[58px] rounded-[14px] object-cover"
              style={{ boxShadow: '0 0 0 2.5px rgba(255,255,255,0.85)' }}
            />
            <img
              src="/workspaces/ws-avatar-2.jpg"
              alt=""
              className="absolute bottom-[44px] right-[690px] h-10 w-10 rounded-xl object-cover"
              style={{ boxShadow: '0 0 0 2.5px rgba(255,255,255,0.85)' }}
            />
          </div>

          <div className="relative">
            {/*
              "Brands", not "Workspaces". The two were the same record all along
              (PRD §4, "Brand (Workspace)") and calling it both is what made
              naming one here and naming one in onboarding look like two steps.
              M3 settled the vocabulary: the business is a brand, the
              organisation is an account.
            */}
            <h1 className="text-[26px] font-bold text-white sm:text-[34px]">Brands</h1>
            <p className="mt-2 max-w-[46ch] text-[15px] font-normal sm:mt-3 sm:text-[17px] lg:max-w-none lg:whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Every brand in this account. Open one to work in it, or add another.
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:mt-[22px] sm:flex-row sm:items-center sm:gap-4">
              <div className="relative h-[54px] w-full rounded-[27px] bg-white sm:w-[454px]">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  aria-label="Search brands"
                  className="h-[54px] w-full rounded-[27px] border-0 bg-transparent pl-[22px] pr-12 text-[15.5px] font-medium text-ink outline-none"
                />
                <svg width="19" height="19" viewBox="0 0 26 26" fill="none" aria-hidden className="pointer-events-none absolute right-5 top-[18px] block">
                  <circle cx="11" cy="11" r="8" stroke={MUTED} strokeWidth="2" />
                  <path d="m17 17 6 6" stroke={MUTED} strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* No name field: the brand is named in onboarding, once. */}
              <button type="button" onClick={addBrand} disabled={busy} className={CREATE_CLS} style={CREATE_STYLE}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="block">
                  <path d="M7 1v12M1 7h12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {busy ? 'Opening…' : 'Add Brand'}
              </button>
            </div>
          </div>
        </section>

        {/* ── cards ───────────────────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3 xl:mt-[34px] xl:grid-cols-5">
          {brands === null ? (
            <span className="text-[17px]" style={{ color: MUTED }}>
              Loading your brands…
            </span>
          ) : cards.length === 0 ? (
            <span className="col-span-full text-[17px]" style={{ color: MUTED }}>
              {query.trim()
                ? `No brand matches “${query.trim()}”.`
                : 'No brands yet — add one to get started.'}
            </span>
          ) : (
            cards.map(({ b, i }) => {
              return (
                /*
                  The arrow lives in this wrapper, not the grid.

                  The prototype positions it absolutely against the grid with a
                  computed `left` per column, which only works because its grid
                  is exactly five fixed columns. Anchored to its own cell instead
                  — `right: 4; top: 4`, so its 26px centre lands on the mask's
                  notch at (100% − 30, 30) — it stays correct at every column
                  count, which is what makes the responsive grid possible at all.
                */
                <div key={b.genomeId} className="relative">
                  <div
                    className="relative h-[264px] rounded-[22px]"
                    style={{
                      background: CARD_BG[i % CARD_BG.length],
                      WebkitMaskImage:
                        'radial-gradient(circle 36px at calc(100% - 30px) 30px, transparent 35px, #000 36px)',
                      maskImage:
                        'radial-gradient(circle 36px at calc(100% - 30px) 30px, transparent 35px, #000 36px)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => open(b.genomeId)}
                      aria-label={`Open ${b.name}`}
                      className="absolute inset-x-0 top-0 bottom-16 border-0 bg-transparent"
                    />
                    <span
                      className="pointer-events-none absolute left-[22px] top-[26px] block h-[92px] w-[92px] rounded-full"
                      style={{
                        boxShadow: '0 0 0 3px rgba(255,255,255,0.9)',
                        background: `#FFFFFF url('${CARD_ICON[i % CARD_ICON.length]}') center / cover no-repeat`,
                      }}
                    />
                    <span className="pointer-events-none absolute left-6 top-[138px] block max-w-[calc(100%-48px)] truncate text-[20px] font-bold text-ink">
                      {b.name}
                    </span>
                    <span className="pointer-events-none absolute left-6 top-[172px] text-14 font-medium" style={{ color: '#7B7B7B' }}>
                      {/* `genome.list` returns when the genome last changed, not
                          when the brand was made, so this says which it is. */}
                      Updated{' '}
                      {new Date(b.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>

                    {/*
                      The prototype stacks member avatars here. Those were the
                      *organisation's* members, which is a different set from
                      who can reach this brand (`brand_members`), and
                      `genome.list` carries neither — so rather than showing the
                      signed-in user's face on every card as if it meant
                      something, the slot holds who can reach it, in words, and
                      the team screen is where that is actually managed.
                    */}
                    <button
                      type="button"
                      onClick={() => router.push('/settings/team')}
                      className="absolute bottom-5 left-6 text-14 font-medium underline-offset-2 hover:underline"
                      style={{ color: '#7B7B7B' }}
                    >
                      Manage access
                    </button>

                    {/*
                      Rename and delete are drawn because the prototype draws
                      them, and both are mocks there. Rename goes to the team
                      settings screen, which is the real one. Delete is inert on
                      purpose: `organization.destroy()` takes every genome, asset
                      and scheduled post with it, and a 40px circle on a picker
                      is the wrong place for that.
                    */}
                    <CardAction
                      onClick={() => {
                        if (orgId) writeSelectedGenome(orgId, b.genomeId);
                        router.push('/settings');
                      }}
                      title={`Open ${b.name} settings`}
                      label={`Settings for ${b.name}`}
                      className="right-[66px]"
                    >
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                        <path d="m12.4 4.2 3.4 3.4M2.2 17.8l.7-3.3a2 2 0 0 1 .54-1L11.2 5.7a1.7 1.7 0 0 1 2.4 0l1.4 1.4a1.7 1.7 0 0 1 0 2.4l-7.8 7.8a2 2 0 0 1-1 .54l-3.3.7-.7-.74Z" stroke={MUTED} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </CardAction>
                    <CardAction
                      disabled
                      title="Nothing in the product deletes a brand — it would take every campaign and asset with it."
                      label={`Delete ${b.name} (unavailable)`}
                      className="right-[18px]"
                    >
                      <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
                        <path d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M5.6 6.8v4.6M8.4 6.8v4.6" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </CardAction>
                  </div>

                  <button
                    type="button"
                    onClick={() => open(b.genomeId)}
                    aria-label={`Open ${b.name}`}
                    className="ss-ws-arrow absolute right-1 top-1 flex h-[52px] w-[52px] items-center justify-center rounded-full border-0 bg-transparent"
                    style={{ boxShadow: 'inset 0 0 0 1.5px rgba(12,12,12,0.25)' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 10 10" fill="none" aria-hidden className="block">
                      <path d="M1 9 9 1M9 1H3M9 1v6" stroke="#0C0C0C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-[34px] left-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-xl px-[22px] py-[13px] text-[15px] font-medium text-white"
          style={{ background: '#0C0C0C', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.4)' }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

const CREATE_CLS =
  'flex h-[54px] shrink-0 items-center justify-center gap-2.5 rounded-xl border-0 px-[22px] text-[15.5px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60';
const CREATE_STYLE: React.CSSProperties = {
  background: 'linear-gradient(90deg, #8B3DFF 0%, #37C7F4 100%)',
  boxShadow: '0 14px 30px -14px rgba(120,70,240,0.7)',
};

function BarButton({
  children,
  label,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className="inline-flex h-[42px] items-center gap-[9px] rounded-[21px] border-0 bg-transparent px-3 transition-colors hover:bg-[rgba(131,131,131,0.08)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-[15px]"
    >
      {children}
      {/* `xl`, not `md`. "Account Settings" and "Agency Portal" together are
          ~300px of text, and with the 254px account chip beside them the header
          overflowed at 768 - a horizontal scrollbar on the whole page. */}
      <span className="hidden whitespace-nowrap text-[15.5px] font-medium xl:inline" style={{ color: MUTED }}>
        {label}
      </span>
    </button>
  );
}

function MenuItem({
  children,
  label,
  onClick,
  active,
  disabled,
  title,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-12 w-full items-center gap-3 rounded-[11px] border-0 px-[14px] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: active
          ? 'linear-gradient(90deg, rgba(108,232,255,0.5) 0%, rgba(148,238,255,0.15) 100%)'
          : 'transparent',
      }}
    >
      <span className="inline-flex h-5 w-5 items-center justify-center" style={{ color: '#3B3B3B' }}>
        {children}
      </span>
      <span className="whitespace-nowrap text-[15.5px] font-semibold text-ink">{label}</span>
    </button>
  );
}

function CardAction({
  children,
  label,
  title,
  className,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  title: string;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`absolute bottom-[18px] flex h-10 w-10 items-center justify-center rounded-full border-0 bg-white disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
