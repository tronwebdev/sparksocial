'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, PreviewPanel, SectionLabel, TextField, Hint } from './kit';

/**
 * `F6`'s fourth group — "Name your agent", and the face it uses.
 *
 * The naming step is the one the prototype puts most weight on and the build had
 * nowhere to ask: `brands.agent_name` arrived with `F4` (the agent-identity
 * record) and only the settings screen ever wrote it, so every brand met an
 * "Unnamed agent" on its Command Center and the campaign wizard's "Here's what
 * *{name}* will do" had no name to use.
 *
 * ── Why the name saves on blur and not on Continue ────────────────────────
 *
 * Every optional step in this flow saves as it goes, so leaving early loses
 * nothing. It also means the completion screen can greet the agent by name
 * without threading the value through three screens of state.
 *
 * The avatar and voice sit below it, unchanged — `PersonalizeStep` already owns
 * that and it is the same question ("what does it look and sound like") one
 * screen down.
 */
export function AgentStep({ genomeId, brandName }: { genomeId: string; brandName: string }) {
  const [name, setName] = useState('');
  const [heygenId, setHeygenId] = useState('');
  const [elevenId, setElevenId] = useState('');
  const [testLine, setTestLine] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read once, because somebody may have named it already and an empty field
  // would read as "not set" and then overwrite it with nothing on blur.
  useEffect(() => {
    void (async () => {
      const res = await invoke<{ agentName?: string }>('brand.governance.get', {});
      if (res.status === 'succeeded' && res.output.agentName) {
        setName(res.output.agentName);
        setSaved(res.output.agentName);
      }
    })();
  }, []);

  async function save() {
    const next = name.trim();
    if (next === (saved ?? '')) return;
    setError(null);
    const res = await invoke('brand.governance.set', { agentName: next || null });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Naming it needs approval first.');
      return;
    }
    setSaved(next);
  }

  /**
   * The HeyGen / ElevenLabs ids, which is what the backend actually stores.
   *
   * `genome.avatar_config.set` takes `{ genomeId, heygenAvatarId?,
   * elevenlabsVoiceId? }` and refuses a call with neither. It does NOT take an
   * uploaded image or an audio file — see the note on the render below for why
   * that matters to this screen.
   */
  async function saveIds(next: { heygen?: string; eleven?: string }) {
    const heygen = (next.heygen ?? heygenId).trim();
    const eleven = (next.eleven ?? elevenId).trim();
    if (!heygen && !eleven) return;

    setError(null);
    const res = await invoke(
      'genome.avatar_config.set',
      {
        genomeId,
        ...(heygen ? { heygenAvatarId: heygen } : {}),
        ...(eleven ? { elevenlabsVoiceId: eleven } : {}),
      },
      crypto.randomUUID(),
    );
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Saving that needs approval first.');
    }
  }

  /*
    `…193231`, with one honest departure that runs through the whole screen.

    The capture asks for an uploaded avatar image, an uploaded or recorded voice
    sample, and a "Test Agent Voice" box that speaks typed text. None of the
    three exists:

      · nothing accepts an avatar image — `genome.avatar_config.set` stores a
        HeyGen *id*, and `content.generate_avatar_video` renders from an avatar
        that already exists
      · nothing accepts a voice sample — `genome.voice.set` stores the brand's
        tone of voice, not audio, and the ElevenLabs voice is likewise an *id*
      · `content.generate_voiceover` needs `{ contentItemId, beatId, script }`;
        it voices a beat of real content and cannot speak a loose sentence

    So the capture's drop zones, Tap to Record, Generate Avatar and Cameo connect
    are drawn and disabled, each saying why, and the two fields that DO reach the
    backend sit beneath them. The alternative was inventing upload endpoints, or
    quietly dropping half the screen — both worse than a visible gap.
  */
  return (
    <div className="flex flex-col gap-5" onBlur={() => void save()}>
      <div className="grid grid-cols-2 gap-x-[18px] gap-y-4">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Name your agent</SectionLabel>
          <TextField
            value={name}
            onChange={setName}
            onEnter={() => void save()}
            placeholder="Enter text"
            ariaLabel="Agent name"
          />

          <SectionLabel
            className="mt-2"
            info="Import an existing Sora avatar cameo instead of uploading one."
            trailing={<span className="text-13 text-ink-muted">Optional</span>}
          >
            Connect Cameo Account
          </SectionLabel>
          <div className="flex items-center gap-2">
            <TextField
              value=""
              onChange={() => {}}
              placeholder="Sora Avatar Cameo Import"
              ariaLabel="Sora avatar cameo import (unavailable)"
              className="flex-1 opacity-50"
            />
            <button
              type="button"
              disabled
              title="No Cameo integration exists in the tool registry yet."
              className="flex h-[42px] shrink-0 items-center rounded-[10px] bg-primary px-3 text-13 text-primary-foreground opacity-40"
            >
              + Connect
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel
            trailing={
              <button
                type="button"
                disabled
                title="Nothing generates an avatar image — the backend stores a HeyGen avatar id."
                className="flex items-center gap-1.5 rounded-[8px] border border-border bg-white px-2.5 py-1.5 text-13 text-ink opacity-40"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" fill="currentColor" />
                </svg>
                Generate Avatar
              </button>
            }
          >
            Content Avatar
          </SectionLabel>

          <div className="flex items-start gap-3 opacity-50" title="No tool accepts an avatar image upload.">
            <div className="pointer-events-none flex-1">
              <DropZone accept="image/*" formats="Png, Jpeg up to 500MB" onFile={() => {}} />
            </div>
            <div className="pointer-events-none">
              <PreviewPanel label="Avatar Preview" />
            </div>
          </div>

          {/* What the backend does take. */}
          <label className="mt-1 flex flex-col gap-1.5">
            <span className="text-13 text-ink-muted">HeyGen avatar id</span>
            <TextField
              value={heygenId}
              onChange={setHeygenId}
              onEnter={() => void saveIds({})}
              placeholder="Leave blank if you have none"
              ariaLabel="HeyGen avatar id"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[14px] border border-border p-3">
        <SectionLabel info="A short sample of the voice SPARK should speak in.">
          Agent Voice (for media)
        </SectionLabel>

        <div className="grid grid-cols-2 gap-x-[18px]">
          <div className="flex flex-col gap-2 opacity-50" title="No tool accepts a voice sample upload.">
            <div className="pointer-events-none">
              <DropZone
                accept="audio/*"
                formats="Mp3, Wav up to 500MB"
                prompt="Drop audio files here or browse"
                onFile={() => {}}
              />
            </div>
            <button
              type="button"
              disabled
              title="In-browser recording is not wired, and nothing would accept the audio."
              className="flex items-center justify-center gap-1.5 self-center rounded-[10px] border border-border bg-white px-3 py-2 text-13 text-ink"
            >
              <svg width="12" height="16" viewBox="0 0 12 16" fill="none" aria-hidden>
                <rect x="4" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M1.5 7a4.5 4.5 0 0 0 9 0M6 11.5V15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Tap to Record
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <Hint>Test Agent Voice, type a message to text voice output</Hint>
            <textarea
              value={testLine}
              onChange={(e) => setTestLine(e.target.value)}
              rows={3}
              disabled
              aria-label="Test the agent voice (unavailable)"
              placeholder="Enter text"
              title="content.generate_voiceover voices a beat of real content — it needs a contentItemId, so it cannot speak a loose sentence."
              className="ss-field w-full resize-none rounded-[10px] border border-border bg-white px-3 py-2 text-14 text-ink opacity-50 outline-none placeholder:text-ink-placeholder"
            />

            <label className="flex flex-col gap-1.5">
              <span className="text-13 text-ink-muted">ElevenLabs voice id</span>
              <TextField
                value={elevenId}
                onChange={setElevenId}
                onEnter={() => void saveIds({})}
                placeholder="Leave blank if you have none"
                ariaLabel="ElevenLabs voice id"
              />
            </label>
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-13 text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-13 text-ink-muted">Saved as {saved}.</p> : null}
    </div>
  );
}
