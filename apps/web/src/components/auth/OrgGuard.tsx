'use client';

import { useEffect, useState } from 'react';
import { useAuth, useOrganizationList, useUser } from '@clerk/nextjs';

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
 * It activates rather than asks. Clerk's `TaskChooseOrganization` is where a
 * user *chooses*; by the time they reach the shell the choice has been made and
 * re-prompting would be a second decision about something already decided.
 */
export function OrgGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded: authLoaded, orgId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { setActive, createOrganization, isLoaded: listLoaded } = useOrganizationList();

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
        // No membership at all. Clerk's task flow should have prevented this,
        // but a session predating `force_organization_selection` can reach here
        // — and an org-less session cannot make a single tool call, so creating
        // one beats rendering a shell where everything 403s.
        if (!createOrganization) return;
        const name = user.firstName ? `${user.firstName}'s workspace` : 'My workspace';
        const org = await createOrganization({ name });
        await setActive({ organization: org.id });
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : 'Could not select a workspace.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, orgId, user, setActive, createOrganization]);

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
