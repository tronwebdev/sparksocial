'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LeadSource, LeadStatus } from '@sparksocial/shared/agencyPipeline';
import { invoke } from '@/lib/tools';
import type { Explanation } from '@/components/explain/WhyPopover';
import type { LeadImportRow } from './leadCsv';

/**
 * `lead.*` for the Client Finder.
 *
 * ── One hook, because the screen is one list ──────────────────────────────
 *
 * Every mutation here ends in the same place: the table has to be right again.
 * Splitting create, import and update into separate hooks would mean each one
 * owning a copy of "and then reload", and the copy that gets forgotten is the
 * one where a status change leaves a stale row on screen.
 *
 * ── Paging, and why the request is debounced ──────────────────────────────
 *
 * The search box drives a server query rather than filtering rows in the
 * browser, because the table pages: filtering the current page would hide
 * matches that are on page three, which is worse than not searching. Typing is
 * therefore debounced — a request per keystroke against a 20,000-row pipeline
 * is a request per keystroke too many.
 */

export interface Lead {
  id: string;
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  interest?: string;
  notes?: string;
  rating?: number;
  source: LeadSource;
  status: LeadStatus;
  convertedBrandId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadCounts {
  new: number;
  contacted: number;
  qualified: number;
  won: number;
  lost: number;
}

interface ListOutput {
  leads: Lead[];
  total: number;
  counts: LeadCounts;
}

export interface LeadQuery {
  status?: LeadStatus[];
  source?: LeadSource[];
  search?: string;
  limit: number;
  offset: number;
}

export interface ImportResult {
  imported: number;
  duplicatesSkipped: number;
  duplicatesWithinUpload: number;
  why: Explanation;
}

const ZERO: LeadCounts = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };

/** Long enough to swallow a burst of typing, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function useLeads(query: LeadQuery) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<LeadCounts>(ZERO);
  const [error, setError] = useState<string | null>(null);
  /**
   * `true` until the first response, and never again.
   *
   * The screen chooses between its empty hero and its table on whether the
   * pipeline has anything in it, and a first paint that assumes "empty" would
   * flash the hero at somebody with two hundred leads on every visit.
   */
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /** Drops a response that arrived after a newer request went out. */
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;

    const res = await invoke<ListOutput>('lead.list', {
      ...(query.status?.length ? { status: query.status } : {}),
      ...(query.source?.length ? { source: query.source } : {}),
      ...(query.search?.trim() ? { search: query.search.trim() } : {}),
      limit: query.limit,
      offset: query.offset,
    });

    if (mine !== seq.current) return;

    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Reading the pipeline needs an approval.');
      setLoading(false);
      return;
    }

    setError(null);
    setLeads(res.output.leads);
    setTotal(res.output.total);
    setCounts(res.output.counts);
    setLoading(false);
  }, [query.status, query.source, query.search, query.limit, query.offset]);

  useEffect(() => {
    /* Only the search term is debounced; a filter or a page change is a click. */
    if (!query.search?.trim()) {
      void load();
      return;
    }
    const t = setTimeout(() => void load(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [load, query.search]);

  /**
   * Every mutation returns the tool's own message on failure rather than a
   * generic one: "Sunnyvale Innovations is already in the pipeline" is
   * actionable, and it is the sentence the tool already wrote.
   */
  const run = useCallback(
    async (name: string, input: unknown, key?: string): Promise<string | null> => {
      setBusy(true);
      try {
        const res = await invoke<unknown>(name, input, key);
        if (res.status !== 'succeeded') {
          return res.status === 'failed' ? res.error.message : 'That needs an approval first.';
        }
        await load();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const create = useCallback((row: LeadImportRow & { source?: LeadSource }) => run('lead.create', row), [run]);

  const update = useCallback(
    (leadId: string, patch: Partial<Lead> & { status?: LeadStatus }) => run('lead.update', { leadId, ...patch }),
    [run],
  );

  const convert = useCallback(
    (leadId: string, brandId: string) => run('lead.convert', { leadId, brandId }),
    [run],
  );

  /**
   * `lead.import` is `idempotent: false`, so the key is mandatory — `invoke.ts`
   * refuses the call before the handler runs without one. A fresh uuid per
   * press, because each press is a genuinely new import of a file the person
   * just chose; a stable key would make a second, different file silently
   * return the first file's result.
   */
  const importRows = useCallback(
    async (rows: LeadImportRow[]): Promise<{ result?: ImportResult; error?: string }> => {
      setBusy(true);
      try {
        const res = await invoke<ImportResult>('lead.import', { rows }, crypto.randomUUID());
        if (res.status !== 'succeeded') {
          return { error: res.status === 'failed' ? res.error.message : 'Importing needs an approval first.' };
        }
        await load();
        return { result: res.output };
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return {
    leads,
    total,
    counts,
    error,
    loading,
    busy,
    reload: load,
    create,
    update,
    convert,
    importRows,
    /** Every stage summed — what decides the hero-versus-table question. */
    pipelineSize: counts.new + counts.contacted + counts.qualified + counts.won + counts.lost,
  };
}
