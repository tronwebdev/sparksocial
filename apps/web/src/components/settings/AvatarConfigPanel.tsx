'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `genome.avatar_config.set` — real since P3, unreached from any screen until
 * now. Onboarding deliberately skips this step (its own comment: "no tool
 * behind them yet") — true when written, stale now that the tool exists.
 *
 * Set-only, not a viewer: no tool currently returns a genome's current
 * `heygenAvatarId`/`elevenlabsVoiceId`, so this can record a change but not
 * display what's active today. Worth knowing rather than pretending
 * otherwise — a read-side tool would close that, out of scope here.
 *
 * `genome.avatar_override.set` (below) is the founder-POV escape hatch from
 * `avatarDefault()`'s hard-derived false — see the tool's own doc comment.
 * Also set-only for the same reason: `genome.get` isn't reachable from
 * `apps/web` (only `@sparksocial/shared` may be imported per CLAUDE.md's
 * frontend rule, and no read tool surfaces the current override state), so
 * this records a change without showing whether one is already active.
 */
export function AvatarConfigPanel() {
  const { genome } = useSelectedGenome();
  const [heygenAvatarId, setHeygenAvatarId] = useState('');
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [overrideReason, setOverrideReason] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideMessage, setOverrideMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save() {
    if (!genome) return;
    if (!heygenAvatarId.trim() && !elevenlabsVoiceId.trim()) {
      setMessage({ kind: 'err', text: 'Enter at least one id.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ genomeId: string; version: number }>('genome.avatar_config.set', {
      genomeId: genome.genomeId,
      ...(heygenAvatarId.trim() ? { heygenAvatarId: heygenAvatarId.trim() } : {}),
      ...(elevenlabsVoiceId.trim() ? { elevenlabsVoiceId: elevenlabsVoiceId.trim() } : {}),
    });
    setBusy(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: 'Saved.' });
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  async function setOverride(enabled: boolean) {
    if (!genome) return;
    if (enabled && overrideReason.trim().length < 10) {
      setOverrideMessage({ kind: 'err', text: 'Say why in at least 10 characters — this is recorded against the genome.' });
      return;
    }
    setOverrideBusy(true);
    setOverrideMessage(null);
    const res = await invoke<{ avatarEnabled: boolean }>('genome.avatar_override.set', {
      genomeId: genome.genomeId,
      enabled,
      ...(enabled ? { reason: overrideReason.trim() } : {}),
    });
    setOverrideBusy(false);
    if (res.status === 'succeeded') {
      setOverrideMessage({
        kind: 'ok',
        text: enabled ? 'Avatar explicitly turned on for this genome.' : 'Override cleared — back to the derived default.',
      });
      if (enabled) setOverrideReason('');
    } else {
      // Refused without a licensed, consented person to clone — `content.generate_avatar_video` checks the same two facts before spending.
      setOverrideMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Avatar &amp; voice</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        Which trained HeyGen avatar and ElevenLabs voice this brand generates from. Set this after training
        completes on the vendor's side — training itself happens outside SparkSocial.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="heygen-id">
            HeyGen avatar id
          </label>
          <input
            id="heygen-id"
            value={heygenAvatarId}
            onChange={(e) => setHeygenAvatarId(e.target.value)}
            placeholder="e.g. abc123"
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="elevenlabs-id">
            ElevenLabs voice id
          </label>
          <input
            id="elevenlabs-id"
            value={elevenlabsVoiceId}
            onChange={(e) => setElevenlabsVoiceId(e.target.value)}
            placeholder="e.g. xyz789"
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={busy || !genome} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {message ? (
          <span className={`text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>
            {message.text}
          </span>
        ) : null}
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <h3 className="text-[15px] font-semibold text-ink">Founder-POV avatar override</h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          Avatar is off by default for any genome whose proof asset isn't a person — correct for most SaaS and
          agency brands. If you specifically want a founder-POV avatar anyway, turn it on here explicitly.
          Requires a licensed person available (set in onboarding) and an active likeness-consent record on file
          — the same two facts avatar video generation checks before spending.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="avatar-override-reason">
            Why (recorded against the genome)
          </label>
          <input
            id="avatar-override-reason"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="e.g. Founder wants to appear on camera for LinkedIn thought leadership"
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" disabled={overrideBusy || !genome} onClick={() => void setOverride(true)}>
            {overrideBusy ? 'Saving…' : 'Turn on'}
          </Button>
          <Button size="sm" variant="outline" disabled={overrideBusy || !genome} onClick={() => void setOverride(false)}>
            {overrideBusy ? 'Saving…' : 'Clear override'}
          </Button>
          {overrideMessage ? (
            <span className={`text-[13px] ${overrideMessage.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>
              {overrideMessage.text}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
