'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke, type ToolResult } from '@/lib/tools';
import { notifyResult } from '@/lib/notify';

/**
 * The agency website and its custom domain, for the wizard and Portal Home.
 *
 * `domainsAvailable` is whether `agency.domain.*` is registered on this
 * deployment — it is only when the Render API settings are in the env group —
 * read by calling `agency.domain.status` and seeing whether the tool exists.
 */

export interface AgencySiteView {
  slug: string;
  url: string;
  subdomainUrl: string;
  domain?: string;
  published: boolean;
  content: { headline: string };
}

export interface DomainView {
  domain: string;
  verified: boolean;
  records: Array<{ type: 'CNAME' | 'A'; host: string; value: string; note?: string }>;
}

export function useAgencySite() {
  const [site, setSite] = useState<AgencySiteView | null | undefined>(undefined);
  const [domain, setDomain] = useState<DomainView | null>(null);
  const [domainsAvailable, setDomainsAvailable] = useState<boolean | null>(null);
  const [rootDomain, setRootDomain] = useState('sparkai.social');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, d] = await Promise.all([
      invoke<{ site: AgencySiteView | null; rootDomain: string }>('agency.site.get', {}),
      invoke<DomainView | null>('agency.domain.status', {}),
    ]);
    if (s.status === 'succeeded') {
      setSite(s.output.site);
      setRootDomain(s.output.rootDomain);
    } else {
      setSite(null);
    }
    if (d.status === 'succeeded') {
      setDomainsAvailable(true);
      setDomain(d.output);
    } else {
      setDomainsAvailable(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** One action at a time; a failure is announced here, so callers only act on success. */
  async function run<T>(label: string, failTitle: string, call: () => Promise<ToolResult<T>>) {
    setBusy(label);
    const res = await call();
    setBusy(null);
    if (!notifyResult(res, undefined, failTitle)) return undefined;
    return res.output;
  }

  return {
    site,
    domain,
    domainsAvailable,
    rootDomain,
    busy,
    reload,
    /** Saves the profile first, so the site is written from what is on screen. */
    generate: async (saveProfile: () => Promise<boolean>) => {
      setBusy('generate');
      const saved = await saveProfile();
      setBusy(null);
      if (!saved) return;
      const out = await run('generate', 'Couldn’t write the site', () =>
        invoke<{ site: AgencySiteView }>('agency.site.generate', {}, crypto.randomUUID()),
      );
      if (out) setSite(out.site);
    },
    setPublished: async (published: boolean) => {
      const out = await run(
        'publish',
        published ? 'Couldn’t publish the site' : 'Couldn’t take the site down',
        () => invoke<{ site: AgencySiteView }>('agency.site.set', { published }),
      );
      if (out) setSite(out.site);
    },
    connect: async (name: string) => {
      const out = await run('connect', 'Couldn’t link the domain', () =>
        invoke<DomainView>('agency.domain.connect', { domain: name }),
      );
      if (out) {
        setDomain(out);
        void reload();
      }
    },
    check: async () => {
      const out = await run('check', 'Couldn’t check the domain', () => invoke<DomainView | null>('agency.domain.status', {}));
      if (out !== undefined) setDomain(out);
    },
    remove: async () => {
      const out = await run('remove', 'Couldn’t remove the domain', () =>
        invoke<{ removed: string | null }>('agency.domain.remove', {}),
      );
      if (out) {
        setDomain(null);
        void reload();
      }
    },
  };
}

export type AgencySiteApi = ReturnType<typeof useAgencySite>;
