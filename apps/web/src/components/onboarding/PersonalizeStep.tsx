'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';

/**
 * `ONB-05` — the agent personalization step.
 *
 * §ONB-05 asks for *"alias, avatar upload/presets, optional cameo import,
 * optional voice record/upload + Sora auth popup"*. What is here is the part
 * that has tools behind it, and the omissions are deliberate rather than
 * unfinished:
 *
 *   - **No alias field.** Nothing in the registry accepts one. This page's own
 *     rule is that a screen may not collect something no tool can save, and a
 *     text box that quietly discards what you typed is worse than its absence.
 *   - **No avatar upload or voice recording.** `genome.avatar_config.set` takes
 *     a HeyGen avatar id and an ElevenLabs voice id — ids for likenesses trained
 *     *on the vendor's side*, by a step this product does not perform (see the
 *     tool's own comment on why there is no `content.avatar.train`). An upload
 *     control here would imply training happens on submit.
 *   - **No Sora popup.** The PRD defers Sora to v1.1 with priority MONITOR and
 *     says the surface is not stable for third-party use.
 *
 * ── Why consent is on the same screen and not a later one ─────────────────
 *
 * `guard.rights` refuses any avatar or voice format without an active consent
 * record for the person being cloned. Configuring an avatar id without one
 * produces a genome that looks personalised and fails at generation time, which
 * is the least useful moment to find out. So the two are one action: naming the
 * person is what makes the id usable, and this step will not save an id without
 * it.
 *
 * Both tools are `human_only` and both refuse without an attributable user,
 * which is correct for a legal attestation and is why this step exists at all
 * rather than being something SPARK infers.
 */
export function PersonalizeStep({ genomeId }: { genomeId: string }) {
  const [heygenAvatarId, setHeygenAvatarId] = useState('');
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const wantsAvatar = heygenAvatarId.trim().length > 0;
  const wantsVoice = elevenlabsVoiceId.trim().length > 0;
  const wantsSomething = wantsAvatar || wantsVoice;

  async function save() {
    if (!wantsSomething) return;
    if (!subject.trim()) {
      setMessage({ kind: 'err', text: 'Name the person this likeness belongs to — SPARK will not use it otherwise.' });
      return;
    }

    setBusy(true);
    setMessage(null);

    /**
     * Consent first, then the ids.
     *
     * If the order were reversed and the consent write failed, the genome would
     * be left pointing at a likeness nobody has agreed to — configured, and
     * refused at generation time with no record of why. This way a failure
     * leaves the genome exactly as it was.
     *
     * One grant per kind, because `genome.consent.grant` records a single
     * `kind`/`subject` pair and the rights guardrail checks them separately.
     */
    for (const kind of [wantsAvatar ? 'avatar_clone' : null, wantsVoice ? 'voice_clone' : null].filter(
      (k): k is string => k !== null,
    )) {
      const res = await invoke(
        'genome.consent.grant',
        { kind, subject: subject.trim() },
        /**
         * `genome.consent.grant` is `idempotent: false` — a second grant is a
         * second attestation — so the middleware requires a key and refuses the
         * call without one. Omitting it made this step fail every time, which is
         * exactly what live testing caught and no unit test would: the failure is
         * in the middleware, not the tool.
         *
         * Unique per submission, same shape `ConsentPanel` uses, so a double
         * click is neither replayed as a no-op nor rejected.
         */
        `consent:${kind}:${subject.trim()}:${Date.now()}`,
      );
      if (res.status !== 'succeeded') {
        setBusy(false);
        setMessage({
          kind: 'err',
          text: res.status === 'failed' ? res.error.message : 'Recording consent needs approval before it can run.',
        });
        return;
      }
    }

    const res = await invoke<{ version: number }>('genome.avatar_config.set', {
      genomeId,
      ...(wantsAvatar ? { heygenAvatarId: heygenAvatarId.trim() } : {}),
      ...(wantsVoice ? { elevenlabsVoiceId: elevenlabsVoiceId.trim() } : {}),
    });
    setBusy(false);

    if (res.status !== 'succeeded') {
      setMessage({
        kind: 'err',
        // The consent record stands even though the ids did not save. That is
        // the right way round — a consent record with no avatar is harmless,
        // and saying so stops somebody re-granting it and creating a duplicate.
        text: `${res.status === 'failed' ? res.error.message : 'That needs approval before it can run.'} The consent record was saved; you can set the ids in Settings.`,
      });
      return;
    }
    setMessage({ kind: 'ok', text: 'Saved. SPARK can use this likeness now.' });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[16px] text-ink-muted">
        Optional. If someone has already had an avatar or voice trained — on HeyGen or ElevenLabs — point SPARK
        at it and say whose it is. Skip this and SPARK writes and films nothing that needs a face.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[13px] text-ink-muted" htmlFor="onb-heygen">
            HeyGen avatar id
          </label>
          <Input
            id="onb-heygen"
            value={heygenAvatarId}
            onChange={(e) => setHeygenAvatarId(e.target.value)}
            placeholder="Leave blank if none"
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-[13px] text-ink-muted" htmlFor="onb-voice">
            ElevenLabs voice id
          </label>
          <Input
            id="onb-voice"
            value={elevenlabsVoiceId}
            onChange={(e) => setElevenlabsVoiceId(e.target.value)}
            placeholder="Leave blank if none"
            className="mt-1"
          />
        </div>
      </div>

      {wantsSomething ? (
        <div className="rounded-xl border border-border p-4">
          <label className="block text-[13px] font-medium text-ink" htmlFor="onb-subject">
            Whose likeness is this?
          </label>
          <p className="mt-1 text-[13px] text-ink-muted">
            Recorded as a consent record against your account. SPARK refuses to generate a face or a voice
            without one, so this is not a formality — it is what makes the ids above usable.
          </p>
          <Input
            id="onb-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Emeka Okafor, owner"
            className="mt-2"
          />
        </div>
      ) : null}

      {message ? (
        <p className={`text-[14px] ${message.kind === 'ok' ? 'text-success' : 'text-[var(--ss-danger)]'}`}>
          {message.text}
        </p>
      ) : null}

      {wantsSomething ? (
        <div>
          <Button variant="outline" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save likeness'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
