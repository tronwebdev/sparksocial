'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@/lib/tools';

/**
 * Guarantees the org has **at least one genome** before the shell renders.
 *
 * `OrgGuard` guarantees a session has an active organization; it says nothing
 * about whether that organization ever finished onboarding. A session can
 * reach this point with an org and zero genomes in perfectly ordinary ways —
 * the crawl step errors out and the tab gets closed, a browser refresh lands
 * mid-flow, someone logs in on a second device having never finished setup
 * on the first. Every route under `(app)` calls tools that expect a genome to
 * already exist; without this, that session reaches a shell where each panel
 * fails or renders empty, with no single place telling the user what to do
 * about it — `WorkspaceSwitcher`'s own "No brands yet" is the one honest
 * corner of that shell, and nothing forces anyone to land on it rather than
 * on `/calendar`, `/assets`, or anywhere else.
 *
 * Composed with `OrgGuard` in `(app)/layout.tsx`, in that order — this needs
 * a verified `orgId` on the session before `genome.list` means anything.
 */
export function GenomeGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ genomes: unknown[] }>('genome.list', {});
      if (cancelled) return;

      if (res.status !== 'succeeded') {
        // A gate that fails open would let an org-less-looking error hide
        // behind a redirect it did not ask for; name it instead.
        setFailed(res.status === 'failed' ? res.error.message : 'That needs approval before it can run.');
        return;
      }

      if (res.output.genomes.length === 0) {
        router.replace('/onboarding');
        return;
      }

      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only, same as `OrgGuard` — `(app)/layout.tsx`
    // persists across navigations within the shell, so this runs once per
    // real session entry, not once per route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[14px] text-ink-muted">Opening your workspace…</p>
      </div>
    );
  }

  return <>{children}</>;
}
