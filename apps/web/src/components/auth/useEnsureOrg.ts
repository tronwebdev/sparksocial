'use client';

import { useOrganizationList, useUser } from '@clerk/nextjs';
import { useCallback } from 'react';

/**
 * The API rejects any session without an active organization — every genome,
 * asset and tool_call row is keyed by org, so an org-less session is not a valid
 * caller (`apps/api/src/clerk-auth.ts`).
 *
 * **P0 stopgap.** Real onboarding (ONB-01→ONB-06, P2) is where a user names their
 * workspace and their first brand genome is created. Until that exists, a fresh
 * sign-up would land on a shell where every request 403s, so this creates a
 * personal org and activates it. Delete this hook when onboarding lands — do not
 * build on it.
 */
export function useEnsureOrg() {
  const { user } = useUser();
  const { createOrganization, setActive, isLoaded } = useOrganizationList();

  return useCallback(async () => {
    if (!isLoaded || !user || !createOrganization || !setActive) return;
    if (user.organizationMemberships.length > 0) {
      await setActive({ organization: user.organizationMemberships[0]!.organization.id });
      return;
    }
    const name = user.firstName ? `${user.firstName}'s workspace` : 'My workspace';
    const org = await createOrganization({ name });
    await setActive({ organization: org.id });
  }, [isLoaded, user, createOrganization, setActive]);
}
