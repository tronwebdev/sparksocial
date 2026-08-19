'use client';

import { useEffect, useState } from 'react';
import { useAuth, useOrganizationList, useUser } from '@clerk/nextjs';
import { SparkMark } from '@/components/brand/SparkMark';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Guarantees the session has an **active organization** before the shell renders.
 *
 * Being a *member* of an org is not the same as having one *active on the
 * session*. `apps/api/src/clerk-auth.ts` reads `org_id` off the verified session
 * token, so a session with memberships but no active org fails every single
 * tool call with "No active organization on this session" — which is what a
 * user sees as a shell where nothing loads.
 *
 * That happened for real: the account had an org and an `org:admin` membership,
 * but had landed on `/agents` directly. `useEnsureOrg` only ran on
 * `/meet-spark`, so any other entry point — a deep link, a bookmark, a refresh
 * after the tasks flow — skipped activation entirely. Putting the guard in the
 * shell layout closes every one of those routes at once, which is why it lives
 * here rather than on individual pages.
 *
 * ── Membership: activate. No membership at all: ask ────────────────────────
 *
 * A member with an existing org (someone who accepted an invite, or is
 * returning after `createOrganization` below on a previous visit) just needs
 * it activated on THIS session — no prompt needed, since the choice of which
 * org was already made elsewhere.
 *
 * A session with **no membership at all** — every fresh sign-up, now that the
 * Clerk Dashboard's "Force organization selection" is off and Clerk never
 * intercepts with its own `TaskChooseOrganization` — used to hit a silent
 * fallback here that invented a name — `${firstName}'s workspace}`, or
 * literally "My workspace" whenever `firstName` was empty — and created it
 * without ever showing the user a form. This is that missing form, not a
 * smarter default: it can't be right without knowing what the business is
 * called, and neither can a guess.
 */
export function OrgGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded: authLoaded, orgId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { setActive, createOrganization, isLoaded: listLoaded } = useOrganizationList();

  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const ready = authLoaded && userLoaded && listLoaded;

  useEffect(() => {
    if (!ready || orgId || !user || !setActive) return;

    let cancelled = false;
    void (async () => {
      try {
        const existing = user.organizationMemberships[0];
        if (existing) {
          await setActive({ organization: existing.organization.id });
          return;
        }
        // No membership at all — the case that used to auto-create silently.
        if (!cancelled) setNeedsName(true);
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : 'Could not open your workspace.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, orgId, user, setActive]);

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (!createOrganization || !setActive || creating) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    setFailed(null);
    try {
      const org = await createOrganization({ name: trimmed });
      await setActive({ organization: org.id });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not create your workspace.');
      setCreating(false);
    }
  }

  if (needsName && !orgId) {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6">
        <div className="flex flex-col items-center">
          <SparkMark variant="card" />
          <h1 className="mt-8 text-center text-[26px] font-semibold text-foreground">Name your workspace</h1>
          <p className="mt-2 max-w-[420px] text-center text-[16px] text-ink-muted">
            Everything SPARK makes lives inside a workspace. You can add brands to it, or a second
            workspace, later.
          </p>
        </div>

        <form onSubmit={submitName} className="flex w-[380px] max-w-full flex-col gap-4">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emeka Cuts, or your agency's name"
            aria-label="Workspace name"
            disabled={creating}
          />
          {failed ? (
            <p role="alert" className="text-center text-[14px] text-destructive">
              {failed}
            </p>
          ) : null}
          <Button type="submit" size="cta" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Continue'}
          </Button>
        </form>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-[16px] font-medium text-ink">Could not open your workspace</p>
          <p className="mt-1 text-[14px] text-ink-muted">{failed}</p>
        </div>
      </div>
    );
  }

  // Hold the shell back until the org is on the session. Rendering children
  // first would fire every page's data fetch against a session the API is
  // going to reject, so the user would see a screen full of errors that fix
  // themselves a moment later.
  if (!ready || !orgId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[14px] text-ink-muted">Opening your workspace…</p>
      </div>
    );
  }

  return <>{children}</>;
}
