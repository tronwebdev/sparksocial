'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `brand.oauth.*` — connects this brand's own Canva account, the credential
 * the Bulk Connector's `canva` source (packages/recipes/src/runners.ts) reads
 * through. `brand.oauth.connect` only mints the authorize URL; the actual
 * connection completes on Canva's redirect back to the API
 * (apps/api/src/canva-oauth.ts), which then bounces the browser back here
 * with `?canva=connected|denied|failed` — read once on mount below.
 */
export function ConnectionsPanel() {
  const { genome } = useSelectedGenome();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectedBy, setConnectedBy] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function refresh(genomeId: string) {
    const res = await invoke<{ connected: boolean; connectedBy?: string }>('brand.oauth.status', { genomeId, provider: 'canva' });
    if (res.status === 'succeeded') {
      setConnected(res.output.connected);
      setConnectedBy(res.output.connectedBy);
    } else {
      setConnected(false);
    }
  }

  useEffect(() => {
    if (!genome) return;
    void refresh(genome.genomeId);
  }, [genome]);

  useEffect(() => {
    const canva = new URLSearchParams(window.location.search).get('canva');
    if (!canva) return;
    if (canva === 'connected') setMessage({ kind: 'ok', text: 'Canva connected.' });
    else if (canva === 'denied') setMessage({ kind: 'err', text: 'Canva connection was cancelled.' });
    else if (canva === 'failed') setMessage({ kind: 'err', text: 'Canva connection failed — check apps/api logs for the vendor error.' });
    // Drop the query param so a refresh doesn't re-show a stale result.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function connect() {
    if (!genome) return;
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ authorizeUrl: string }>('brand.oauth.connect', { genomeId: genome.genomeId, provider: 'canva' });
    if (res.status === 'succeeded') {
      window.location.href = res.output.authorizeUrl;
      return;
    }
    setBusy(false);
    setMessage({
      kind: 'err',
      text:
        res.status === 'failed'
          ? res.error.message
          : "That request was gated — Canva connections need an owner or admin, which you aren't in this workspace.",
    });
  }

  async function disconnect() {
    if (!genome) return;
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ removed: boolean }>('brand.oauth.disconnect', { genomeId: genome.genomeId, provider: 'canva' });
    setBusy(false);
    if (res.status === 'succeeded') {
      setConnected(false);
      setConnectedBy(undefined);
      setMessage({ kind: 'ok', text: 'Disconnected.' });
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Connections</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        Third-party accounts this brand reads from — currently just Canva, for the Bulk Connector automation
        recipe's canva source.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[14px] font-medium text-ink">Canva</p>
          <p className="text-[13px] text-ink-muted">
            {connected === null
              ? 'Checking…'
              : connected
                ? `Connected${connectedBy ? ` by ${connectedBy}` : ''}.`
                : 'Not connected.'}
          </p>
        </div>
        {connected ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" disabled={busy || !genome} onClick={() => void connect()}>
            {busy ? 'Redirecting…' : 'Connect Canva'}
          </Button>
        )}
      </div>

      {message ? (
        <p className={`mt-3 text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</p>
      ) : null}
    </section>
  );
}
