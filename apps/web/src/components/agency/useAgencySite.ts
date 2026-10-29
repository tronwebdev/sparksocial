'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';

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
  const [error, setError] = useState<string | null>(null);

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

  async function run<T>(label: string, call: () => Promise<{ status: string; output?: T; error?: { code: string; message: string } }>) {
    setBusy(label);
    setError(null);
    const res = await call();
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' && res.error ? userMessage(res.error as never) : 'That needs an approval first.');
      return undefined;
    }
    return res.output as T;
  }

  return {
    site,
    domain,
    domainsAvailable,
    rootDomain,
    busy,
    error,
    reload,
    /** Saves the profile first, so the site is written from what is on screen. */
    generate: async (saveProfile: () => Promise<boolean>) => {
      setBusy('generate');
      const saved = await saveProfile();
      setBusy(null);
      if (!saved) return;
      const out = await run<{ site: AgencySiteView }>('generate', () =>
        invoke('agency.site.generate', {}, crypto.randomUUID()),
      );
      if (out) setSite(out.site);
    },
    setPublished: async (published: boolean) => {
      const out = await run<{ site: AgencySiteView }>('publish', () => invoke('agency.site.set', { published }));
      if (out) setSite(out.site);
    },
    connect: async (name: string) => {
      const out = await run<DomainView>('connect', () => invoke('agency.domain.connect', { domain: name }));
      if (out) {
        setDomain(out);
        void reload();
      }
    },
    check: async () => {
      const out = await run<DomainView | null>('check', () => invoke('agency.domain.status', {}));
      if (out !== undefined) setDomain(out);
    },
    remove: async () => {
      const out = await run<{ removed: string | null }>('remove', () => invoke('agency.domain.remove', {}));
      if (out) {
        setDomain(null);
        void reload();
      }
    },
  };
}

export type AgencySiteApi = ReturnType<typeof useAgencySite>;
