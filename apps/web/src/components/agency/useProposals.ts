'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  LineRecurrence,
  ProposalLineItem,
  ProposalService,
  ProposalStatus,
} from '@sparksocial/shared/agencyPipeline';
import { invoke } from '@/lib/tools';

/**
 * `proposal.*` for the Client Finder's lead rows.
 *
 * ── One org-wide read, indexed by lead ────────────────────────────────────
 *
 * The screen needs two things from proposals: a badge on each row saying
 * whether that lead has an offer out, and the list inside the modal when one is
 * opened. Fetching per row would be eight requests a page and would leave a
 * collapsed row unable to say anything; fetching per lead on expand would make
 * the badge appear only after a click, which is the wrong way round — the badge
 * exists to tell you whether clicking is worth it.
 *
 * So: one `proposal.list`, grouped by `leadId` here. It also returns the
 * outstanding and accepted totals the header shows, which no client-side sum
 * over a page could produce correctly.
 */

export interface Proposal {
  id: string;
  leadId: string;
  title: string;
  currency: string;
  status: ProposalStatus;
  termMonths: number;
  lineItems: ProposalLineItem[];
  monthlyCents: number;
  oneOffCents: number;
  totalContractCents: number;
  notes?: string;
  shareExpiresAt?: string;
  sentAt?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ListOutput {
  proposals: Proposal[];
  total: number;
  pipeline: { outstandingCents: number; acceptedCents: number; currency?: string };
}

export interface DraftInput {
  leadId: string;
  title: string;
  currency: string;
  termMonths: number;
  lineItems: Array<{
    service: ProposalService;
    description?: string;
    unitCents: number;
    quantity: number;
    recurrence: LineRecurrence;
  }>;
  notes?: string;
}

/**
 * The tool's own page cap.
 *
 * An agency past 200 proposals would have badges missing on the oldest leads,
 * which is why `total` is returned alongside — the modal says so rather than
 * quietly under-reporting. Paging this properly means a per-lead count in the
 * tool, and that is the change to make when somebody actually hits it.
 */
const CAP = 200;

export function useProposals() {
  const [byLead, setByLead] = useState<Record<string, Proposal[]>>({});
  const [total, setTotal] = useState(0);
  const [pipeline, setPipeline] = useState<ListOutput['pipeline']>({ outstandingCents: 0, acceptedCents: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await invoke<ListOutput>('proposal.list', { limit: CAP, offset: 0 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Reading proposals needs an approval.');
      return;
    }
    setError(null);

    const grouped: Record<string, Proposal[]> = {};
    for (const p of res.output.proposals) {
      (grouped[p.leadId] ??= []).push(p);
    }
    /* Newest first within a lead — the current offer is the one that matters. */
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    setByLead(grouped);
    setTotal(res.output.total);
    setPipeline(res.output.pipeline);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Returns the tool's own message on failure — it is already the right sentence. */
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

  const draft = useCallback((input: DraftInput) => run('proposal.draft', input), [run]);

  const update = useCallback(
    (proposalId: string, patch: Partial<Omit<DraftInput, 'leadId'>>) =>
      run('proposal.update', { proposalId, ...patch }),
    [run],
  );

  const decide = useCallback(
    (proposalId: string, outcome: 'accepted' | 'declined' | 'withdrawn') =>
      run('proposal.decide', { proposalId, outcome }),
    [run],
  );

  /**
   * `proposal.share` is `idempotent: false`, so the key is mandatory — each
   * call mints a *new* credential and invalidates nothing, which is exactly the
   * case a key exists for: a double-submit would scatter two live tokens for
   * one proposal, each independently forwardable.
   *
   * Returns the token, because this is the only call that ever will. Every
   * other read deliberately omits it.
   */
  const share = useCallback(
    async (
      proposalId: string,
      expiresInDays: number,
    ): Promise<{ token?: string; expiresAt?: string; error?: string }> => {
      setBusy(true);
      try {
        const res = await invoke<{ token: string; expiresAt: string }>(
          'proposal.share',
          { proposalId, expiresInDays, markSent: true },
          crypto.randomUUID(),
        );
        if (res.status !== 'succeeded') {
          return { error: res.status === 'failed' ? res.error.message : 'Sending needs an approval first.' };
        }
        await load();
        return { token: res.output.token, expiresAt: res.output.expiresAt };
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return { byLead, total, pipeline, error, busy, reload: load, draft, update, decide, share };
}
