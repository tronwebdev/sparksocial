'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { notifyResult } from '@/lib/notify';
import { Busy } from '@/components/brand/SparkLoader';

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
  /* The form's own validation only — what a save came to is a notification. */
  const [invalid, setInvalid] = useState<string | null>(null);

  const [overrideReason, setOverrideReason] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideInvalid, setOverrideInvalid] = useState<string | null>(null);

  async function save() {
    if (!genome) return;
    if (!heygenAvatarId.trim() && !elevenlabsVoiceId.trim()) {
      setInvalid('Enter at least one id.');
      return;
    }
    setBusy(true);
    setInvalid(null);
    const res = await invoke<{ genomeId: string; version: number }>('genome.avatar_config.set', {
      genomeId: genome.genomeId,
      ...(heygenAvatarId.trim() ? { heygenAvatarId: heygenAvatarId.trim() } : {}),
      ...(elevenlabsVoiceId.trim() ? { elevenlabsVoiceId: elevenlabsVoiceId.trim() } : {}),
    });
    setBusy(false);
    notifyResult(res, 'Avatar and voice saved', 'Couldn’t save the avatar and voice');
  }

  async function setOverride(enabled: boolean) {
    if (!genome) return;
    if (enabled && overrideReason.trim().length < 10) {
      setOverrideInvalid('Say why in at least 10 characters — this is recorded against the genome.');
      return;
    }
    setOverrideBusy(true);
    setOverrideInvalid(null);
    const res = await invoke<{ avatarEnabled: boolean }>('genome.avatar_override.set', {
      genomeId: genome.genomeId,
      enabled,
      ...(enabled ? { reason: overrideReason.trim() } : {}),
    });
    setOverrideBusy(false);
    // Refused without a licensed, consented person to clone — `content.generate_avatar_video` checks the same two facts before spending.
    const ok = notifyResult(
      res,
      enabled
        ? { title: 'Avatar turned on', body: 'Explicitly on for this genome.' }
        : { title: 'Override cleared', body: 'Back to the derived default.' },
      'Couldn’t change the avatar override',
    );
    if (ok && enabled) setOverrideReason('');
  }

  return (
    <section className="rounded-[16px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white p-6 max-sm:p-4">
      <h2 className="text-18 font-semibold text-ink">Avatar &amp; voice</h2>
      <p className="mt-1 text-13 text-ink-muted">
        Which trained HeyGen avatar and ElevenLabs voice this brand generates from. Set this after training
        completes on the vendor's side — training itself happens outside SparkSocial.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-1 gap-1">
          <label className="text-12 font-medium text-ink-muted" htmlFor="heygen-id">
            HeyGen avatar id
          </label>
          <input
            id="heygen-id"
            value={heygenAvatarId}
            onChange={(e) => setHeygenAvatarId(e.target.value)}
            placeholder="e.g. abc123"
            className="h-10 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white px-3 text-14 text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 gap-1">
          <label className="text-12 font-medium text-ink-muted" htmlFor="elevenlabs-id">
            ElevenLabs voice id
          </label>
          <input
            id="elevenlabs-id"
            value={elevenlabsVoiceId}
            onChange={(e) => setElevenlabsVoiceId(e.target.value)}
            placeholder="e.g. xyz789"
            className="h-10 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white px-3 text-14 text-ink placeholder:text-ink-placeholder"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={busy || !genome} onClick={() => void save()}>
          {busy ? <Busy>Saving…</Busy> : 'Save'}
        </Button>
        {invalid ? <span className="text-13 text-destructive">{invalid}</span> : null}
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <h3 className="text-15 font-semibold text-ink">Founder-POV avatar override</h3>
        <p className="mt-1 text-13 text-ink-muted">
          Avatar is off by default for any genome whose proof asset isn't a person — correct for most SaaS and
          agency brands. If you specifically want a founder-POV avatar anyway, turn it on here explicitly.
          Requires a licensed person available (set in onboarding) and an active likeness-consent record on file
          — the same two facts avatar video generation checks before spending.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-1">
          <label className="text-12 font-medium text-ink-muted" htmlFor="avatar-override-reason">
            Why (recorded against the genome)
          </label>
          <input
            id="avatar-override-reason"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="e.g. Founder wants to appear on camera for LinkedIn thought leadership"
            className="h-10 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white px-3 text-14 text-ink placeholder:text-ink-placeholder"
          />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" disabled={overrideBusy || !genome} onClick={() => void setOverride(true)}>
            {overrideBusy ? <Busy>Saving…</Busy> : 'Turn on'}
          </Button>
          <Button size="sm" variant="outline" disabled={overrideBusy || !genome} onClick={() => void setOverride(false)}>
            {overrideBusy ? <Busy>Saving…</Busy> : 'Clear override'}
          </Button>
          {overrideInvalid ? <span className="text-13 text-destructive">{overrideInvalid}</span> : null}
        </div>
      </div>
    </section>
  );
}
