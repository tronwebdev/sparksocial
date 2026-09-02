'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk, useOrganizationList, useUser } from '@clerk/nextjs';
import { Stage } from '@/components/onboarding/Stage';

/**
 * Workspaces — `ui build/SparkSocial Account Home.dc.html`.
 *
 * Where signing in lands. Built on the prototype's 1728×800 stage, so every
 * number below is native canvas px and `Stage` does the scaling — the same
 * device the onboarding screens use, which is why it is imported rather than
 * re-derived here.
 *
 * ── Why it lives outside both route groups ────────────────────────────────
 *
 * Not in `(app)`: that layout runs `OrgGuard`, which activates an organization
 * before rendering. A picker that cannot be reached until something has already
 * been picked is not a picker. Not in `(auth)` either — that layout paints the
 * sky backdrop, and this screen has its own. A top-level route gets the root
 * layout alone, and `middleware.ts` protects everything it does not explicitly
 * list, so being signed in is still required.
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
 * everyone else, from data already in hand. Same shape, no fabricated faces.
 */

/** The prototype's five card fills, cycled — a workspace has no colour of its own. */
const CARD_BG = ['#C9F0FA', '#D9F4DC', '#FBDCD4', '#FBF0D4', '#EDDBF8'] as const;
/** Its five workspace glyphs, likewise cycled where an org has no image set. */
const CARD_ICON = [
  '/workspaces/ws-icon-3.png',
  '/workspaces/ws-icon-2.png',
  '/workspaces/ws-icon-1.png',
  '/workspaces/ws-icon-4.png',
  '/workspaces/ws-icon-5.png',
] as const;

const GRID_W = 1644;
const GAP = 18;
const CARD_W = (GRID_W - 4 * GAP) / 5; // 314.4

const MUTED = '#5B5B5B';

export default function WorkspacesPage() {
  const router = useRouter();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const { isLoaded, userMemberships, setActive, createOrganization } = useOrganizationList({
    userMemberships: { infinite: true, pageSize: 20 },
  });

  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2300);
    return () => clearTimeout(t);
  }, [toast]);

  const memberships = userMemberships?.data ?? [];

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memberships
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !q || m.organization.name.toLowerCase().includes(q));
  }, [memberships, query]);

  async function open(organizationId: string) {
    if (!setActive || busy) return;
    setBusy(true);
    await setActive({ organization: organizationId });
    /*
      A full navigation rather than `router.push`, because the session token has
      just changed. `OrgGuard` and every tool call read `org_id` off it, and a
      client-side transition can render the shell against the token the page was
      loaded with — which is the "signed in but nothing loads" failure its own
      docstring describes.
    */
    window.location.assign('/');
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!createOrganization || !setActive || busy || !newName.trim()) return;
    setBusy(true);
    try {
      const org = await createOrganization({ name: newName.trim() });
      await setActive({ organization: org.id });
      /*
        Onboarding, not the dashboard — the prototype's own note on this button
        says a new workspace "flows through onboarding brand setup", and a
        workspace with no genome has nothing for the dashboard to show.
      */
      window.location.assign('/onboarding');
    } catch {
      setBusy(false);
      setToast('That workspace could not be created.');
    }
  }

  const firstName = user?.firstName ?? user?.username ?? 'Account';

  return (
    <Stage background="linear-gradient(180deg, #F6FAFC 0%, #EDF3F7 55%, #E9F0F5 100%)" contentHeight={800}>
      {/* ── top bar ──────────────────────────────────────────────────────── */}
      <span
        style={{
          position: 'absolute',
          left: 46,
          top: 44,
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: '#0C0C0C',
          whiteSpace: 'nowrap',
        }}
      >
        Sparksocial
      </span>

      <div
        style={{
          position: 'absolute',
          left: 952,
          top: 38,
          height: 56,
          borderRadius: 28,
          background: '#FFFFFF',
          boxShadow: '0 10px 26px -18px rgba(12,12,12,0.35)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
        }}
      >
        <BarButton onClick={() => router.push('/settings')} label="Account Settings">
          <svg width="17" height="17" viewBox="0 0 22 22" fill="none" aria-hidden>
            <circle cx="9" cy="7" r="2.8" stroke={MUTED} strokeWidth="1.6" />
            <path d="M3 17c1-2.7 3.2-4.2 6-4.2 1 0 1.9.2 2.7.5" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" />
            <path d="m15.8 12.6.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4Z" stroke={MUTED} strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </BarButton>
        {/*
          Agency multi-tenancy is P6 and explicitly out of the Aug 29 alpha
          (`CLAUDE.md`, "Scope"). There is no portal route to send this to, so it
          says so rather than 404ing.
        */}
        <BarButton disabled title="The agency portal is not part of this release." label="Agency Portal">
          <svg width="16" height="15" viewBox="0 0 16 15" fill="none" aria-hidden>
            <rect x="1" y="4" width="14" height="10" rx="2.4" stroke={MUTED} strokeWidth="1.4" />
            <path d="M5.5 4V2.8A1.8 1.8 0 0 1 7.3 1h1.4a1.8 1.8 0 0 1 1.8 1.8V4" stroke={MUTED} strokeWidth="1.4" />
          </svg>
        </BarButton>
      </div>

      <button
        type="button"
        disabled
        title="The notification centre is not built yet."
        aria-label="Notifications (unavailable)"
        style={{
          position: 'absolute',
          left: 1354,
          top: 38,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#FFFFFF',
          border: 'none',
          boxShadow: '0 10px 26px -18px rgba(12,12,12,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.55,
          cursor: 'not-allowed',
        }}
      >
        <svg width="20" height="21" viewBox="0 0 22 22" fill="none" aria-hidden>
          <path d="M11 3a5.6 5.6 0 0 1 5.6 5.6c0 3 .8 4.8 1.6 5.9.3.4 0 1-.5 1H4.3c-.5 0-.8-.6-.5-1 .8-1.1 1.6-2.9 1.6-5.9A5.6 5.6 0 0 1 11 3Z" stroke={MUTED} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9 18.6a2.1 2.1 0 0 0 4 0" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <div
        style={{
          position: 'absolute',
          left: 1428,
          top: 38,
          width: 254,
          height: 56,
          borderRadius: 28,
          background: '#FFFFFF',
          boxShadow: '0 10px 26px -18px rgba(12,12,12,0.35)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 8,
            top: 8,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: user?.imageUrl ? `#BDEBFA url('${user.imageUrl}') center / cover no-repeat` : '#BDEBFA',
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 36,
            top: 32,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#13D711',
            boxShadow: '0 0 0 2px #FFFFFF',
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 60,
            top: 17,
            maxWidth: 122,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 16.5,
            fontWeight: 700,
            color: '#0C0C0C',
          }}
        >
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
          style={{
            position: 'absolute',
            right: 6,
            top: 8,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
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
            style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'none', border: 'none', cursor: 'default' }}
          />
          <div
            style={{
              position: 'absolute',
              left: 1428,
              top: 102,
              width: 254,
              borderRadius: 16,
              background: '#FFFFFF',
              boxShadow: '0 30px 70px -30px rgba(12,12,12,0.45)',
              padding: 8,
              zIndex: 50,
            }}
          >
            <MenuItem active label="Profile" onClick={() => openUserProfile()}>
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                <rect x="2.5" y="2.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="11" cy="9" r="2.6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5.8 17.6c1.1-2.4 3-3.7 5.2-3.7s4.1 1.3 5.2 3.7" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </MenuItem>
            <MenuItem label="Account Settings" onClick={() => router.push('/settings')}>
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 2.6v2.2M11 17.2v2.2M2.6 11h2.2M17.2 11h2.2M4.9 4.9l1.6 1.6M15.5 15.5l1.6 1.6M4.9 17.1l1.6-1.6M15.5 6.5l1.6-1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </MenuItem>
            {/* Neither exists as a route. Drawn, disabled, and honest about it. */}
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

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: 42,
          top: 118,
          width: GRID_W,
          height: 272,
          borderRadius: 20,
          overflow: 'hidden',
          background: '#05070C',
        }}
      >
        <img
          src="/workspaces/jobfinder-hero.png"
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }}
        />
        <div
          style={{
            position: 'absolute',
            right: 140,
            top: -120,
            width: 520,
            height: 520,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(140,80,220,0.36) 0%, rgba(90,50,160,0.18) 55%, rgba(0,0,0,0) 75%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -80,
            bottom: -260,
            width: 620,
            height: 620,
            borderRadius: '50%',
            boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.12)',
            background: 'rgba(20,24,36,0.35)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 330,
            top: 88,
            width: 152,
            height: 64,
            borderRadius: 34,
            background: 'linear-gradient(140deg, #2A3350 0%, #171C2E 100%)',
            boxShadow: '0 24px 50px -18px rgba(120,80,240,0.55), inset 0 1px 4px rgba(255,255,255,0.18)',
          }}
        >
          <span style={{ position: 'absolute', left: 26, top: 24, width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 0 16px rgba(255,255,255,0.9)' }} />
          <span style={{ position: 'absolute', right: 26, top: 24, width: 16, height: 16, borderRadius: '50%', background: '#8FD4FF', boxShadow: '0 0 16px rgba(143,212,255,0.9)' }} />
        </div>
        <img
          src="/workspaces/ws-hero-robot.png"
          alt=""
          style={{ position: 'absolute', right: 560, top: 36, width: 58, height: 58, objectFit: 'cover', borderRadius: 14, boxShadow: '0 0 0 2.5px rgba(255,255,255,0.85)' }}
        />
        <img
          src="/workspaces/ws-avatar-2.jpg"
          alt=""
          style={{ position: 'absolute', right: 690, bottom: 44, width: 40, height: 40, objectFit: 'cover', borderRadius: 12, boxShadow: '0 0 0 2.5px rgba(255,255,255,0.85)' }}
        />

        <span style={{ position: 'absolute', left: 50, top: 44, fontSize: 34, fontWeight: 700, color: '#FFFFFF' }}>
          Workspaces
        </span>
        <span
          style={{
            position: 'absolute',
            left: 50,
            top: 100,
            fontSize: 17,
            fontWeight: 400,
            color: 'rgba(255,255,255,0.65)',
            whiteSpace: 'nowrap',
          }}
        >
          Organize your projects and collaborate efficiently in dedicated workspaces.
        </span>

        <div style={{ position: 'absolute', left: 50, top: 156, width: 454, height: 54, borderRadius: 27, background: '#FFFFFF' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search workspaces"
            style={{
              position: 'absolute',
              left: 22,
              top: 0,
              width: 380,
              height: 54,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 15.5,
              fontWeight: 500,
              color: '#0C0C0C',
            }}
          />
          <svg width="19" height="19" viewBox="0 0 26 26" fill="none" aria-hidden style={{ position: 'absolute', right: 20, top: 18, display: 'block' }}>
            <circle cx="11" cy="11" r="8" stroke={MUTED} strokeWidth="2" />
            <path d="m17 17 6 6" stroke={MUTED} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {creating ? (
          <form
            onSubmit={create}
            style={{ position: 'absolute', left: 520, top: 156, display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workspace name"
              aria-label="New workspace name"
              style={{
                width: 260,
                height: 54,
                borderRadius: 12,
                border: 'none',
                outline: 'none',
                background: '#FFFFFF',
                padding: '0 18px',
                fontSize: 15.5,
                fontWeight: 500,
                color: '#0C0C0C',
              }}
            />
            <button type="submit" disabled={busy || !newName.trim()} style={createBtnStyle}>
              <span style={{ fontSize: 15.5, fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                {busy ? 'Creating…' : 'Create'}
              </span>
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} style={{ ...createBtnStyle, position: 'absolute', left: 520, top: 156 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={{ display: 'block' }}>
              <path d="M7 1v12M1 7h12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 15.5, fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap' }}>
              Create Workspace
            </span>
          </button>
        )}
      </div>

      {/* ── cards ────────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: 42,
          top: 424,
          width: GRID_W,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: GAP,
        }}
      >
        {!isLoaded ? (
          <span style={{ fontSize: 17, color: MUTED }}>Loading your workspaces…</span>
        ) : cards.length === 0 ? (
          <span style={{ gridColumn: '1 / -1', fontSize: 17, color: MUTED }}>
            {query.trim()
              ? `No workspace matches “${query.trim()}”.`
              : 'No workspaces yet — create one to get started.'}
          </span>
        ) : (
          cards.map(({ m, i }, col) => {
            const org = m.organization;
            const others = Math.max(0, (org.membersCount ?? 1) - 1);
            return (
              <div key={org.id} style={{ display: 'contents' }}>
                <div
                  style={{
                    position: 'relative',
                    height: 264,
                    borderRadius: 22,
                    background: CARD_BG[i % CARD_BG.length],
                    /* The notch the arrow button sits in, cut out of the corner. */
                    WebkitMaskImage:
                      'radial-gradient(circle 36px at calc(100% - 30px) 30px, transparent 35px, #000 36px)',
                    maskImage:
                      'radial-gradient(circle 36px at calc(100% - 30px) 30px, transparent 35px, #000 36px)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void open(org.id)}
                    aria-label={`Open ${org.name}`}
                    style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 64, background: 'none', border: 'none', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 22,
                      top: 26,
                      width: 92,
                      height: 92,
                      borderRadius: '50%',
                      boxShadow: '0 0 0 3px rgba(255,255,255,0.9)',
                      pointerEvents: 'none',
                      background: `#FFFFFF url('${org.imageUrl || CARD_ICON[i % CARD_ICON.length]}') center / cover no-repeat`,
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 24,
                      top: 138,
                      maxWidth: CARD_W - 48,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 20,
                      fontWeight: 700,
                      color: '#0C0C0C',
                      pointerEvents: 'none',
                    }}
                  >
                    {org.name}
                  </span>
                  <span style={{ position: 'absolute', left: 24, top: 172, fontSize: 14, fontWeight: 500, color: '#7B7B7B', pointerEvents: 'none' }}>
                    Created{' '}
                    {org.createdAt
                      ? new Date(org.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </span>

                  <div style={{ position: 'absolute', left: 24, bottom: 20, display: 'flex', alignItems: 'center' }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        boxShadow: '0 0 0 2px #FFFFFF',
                        display: 'inline-block',
                        background: user?.imageUrl ? `#DCEAF6 url('${user.imageUrl}') center / cover no-repeat` : '#DCEAF6',
                      }}
                    />
                    {others > 0 ? (
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: '#57D9F2',
                          boxShadow: '0 0 0 2px #FFFFFF',
                          marginLeft: -9,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#0C0C0C',
                        }}
                      >
                        +{others}
                      </span>
                    ) : null}
                  </div>

                  {/*
                    Rename and delete are drawn because the prototype draws them,
                    and both are mocks there (`"Rename workspace — mock"`). Rename
                    goes to the team settings screen, which is the real one.
                    Delete is left inert on purpose: `organization.destroy()` takes
                    every genome, asset and scheduled post with it, and a 40px
                    circle on a picker is the wrong place to put that.
                  */}
                  <CardAction
                    onClick={() => router.push('/settings/team')}
                    title={`Rename ${org.name} in team settings`}
                    label={`Edit ${org.name}`}
                    right={66}
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                      <path d="m12.4 4.2 3.4 3.4M2.2 17.8l.7-3.3a2 2 0 0 1 .54-1L11.2 5.7a1.7 1.7 0 0 1 2.4 0l1.4 1.4a1.7 1.7 0 0 1 0 2.4l-7.8 7.8a2 2 0 0 1-1 .54l-3.3.7-.7-.74Z" stroke={MUTED} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </CardAction>
                  <CardAction
                    disabled
                    title="Deleting a workspace removes all of its data — it is not done from here."
                    label={`Delete ${org.name} (unavailable)`}
                    right={18}
                  >
                    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
                      <path d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5.6 6.8v4.6M8.4 6.8v4.6" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </CardAction>
                </div>

                {/*
                  Absolutely positioned against the grid, not the card, exactly as
                  the prototype has it: `left` walks the columns and the static top
                  puts it 4px down, which lands its 26px centre on the notch at
                  (cardW − 30, 30).
                */}
                <button
                  type="button"
                  onClick={() => void open(org.id)}
                  aria-label={`Open ${org.name}`}
                  className="ss-ws-arrow"
                  style={{
                    position: 'absolute',
                    left: Math.round(col * (CARD_W + GAP) + CARD_W - 56),
                    marginTop: 4,
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: 'none',
                    border: 'none',
                    boxShadow: 'inset 0 0 0 1.5px rgba(12,12,12,0.25)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 10 10" fill="none" aria-hidden style={{ display: 'block' }}>
                    <path d="M1 9 9 1M9 1H3M9 1v6" stroke="#0C0C0C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      {toast ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 34,
            transform: 'translateX(-50%)',
            background: '#0C0C0C',
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 500,
            padding: '13px 22px',
            borderRadius: 12,
            boxShadow: '0 12px 32px -8px rgba(0,0,0,0.4)',
            zIndex: 100,
            whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      ) : null}
    </Stage>
  );
}

const createBtnStyle: React.CSSProperties = {
  height: 54,
  padding: '0 22px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(90deg, #8B3DFF 0%, #37C7F4 100%)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
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
      title={title}
      style={{
        height: 42,
        padding: '0 15px',
        borderRadius: 21,
        background: 'none',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
      <span style={{ fontSize: 15.5, fontWeight: 500, color: MUTED, whiteSpace: 'nowrap' }}>{label}</span>
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
      style={{
        width: '100%',
        height: 48,
        borderRadius: 11,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        gap: 12,
        opacity: disabled ? 0.5 : 1,
        background: active
          ? 'linear-gradient(90deg, rgba(108,232,255,0.5) 0%, rgba(148,238,255,0.15) 100%)'
          : 'transparent',
      }}
    >
      <span style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#3B3B3B' }}>
        {children}
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 600, color: '#0C0C0C', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

function CardAction({
  children,
  label,
  title,
  right,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  title: string;
  right: number;
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
      style={{
        position: 'absolute',
        right,
        bottom: 18,
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: '#FFFFFF',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
