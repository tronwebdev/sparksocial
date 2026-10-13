'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@/lib/tools';
import { uploadToStorage } from '@/lib/uploadToStorage';
import { invalidateAgentIdentity } from '@/lib/useAgentIdentity';
import { DropZone, SectionLabel } from './kit';
import { ProtoScale } from './Stage';

/**
 * `F6`'s fourth group — "Name your agent", and the face and voice it uses.
 *
 * The naming step is the one the prototype puts most weight on and the build had
 * nowhere to ask: `brands.agent_name` arrived with `F4` (the agent-identity
 * record) and only the settings screen ever wrote it, so every brand met an
 * "Unnamed agent" on its Command Center and the campaign wizard's "Here's what
 * *{name}* will do" had no name to use.
 *
 * ── What used to be drawn here and disabled ───────────────────────────────
 *
 * Until now this screen rendered the prototype at full fidelity and then turned
 * five of its controls off, each with a tooltip explaining which tool did not
 * exist, and put two raw vendor-id text fields underneath as the real interface.
 * That was the honest thing to ship at the time and it was still a screen that
 * asked a florist for a HeyGen avatar id.
 *
 * Four tools now close the gap, so every control does what it looks like:
 *
 *   genome.avatar.generate            "Generate Avatar" — synthesise a presenter
 *   genome.avatar.from_image          the photo drop zone
 *   genome.voice.clone_from_sample    the audio drop zone and the record button
 *   voice.preview                     the test box and its player
 *
 * The two id fields are gone. `genome.avatar_config.set` still exists for
 * somebody who genuinely has a trained avatar, and Settings is where that
 * belongs — not in front of a new customer.
 *
 * ── Uploads go through storage, never through the API ─────────────────────
 *
 * Both drop zones and the recorder follow the same path every other upload in
 * this app takes: `asset.upload_url` for a presigned PUT, bytes straight to
 * storage from the browser, then the resulting URL handed to the tool. Bytes
 * never transit the API container.
 *
 * ── The one control still inert ───────────────────────────────────────────
 *
 * Sora Cameo. There is no integration and no vendor API to write one against;
 * it stays drawn, disabled and labelled Optional rather than being quietly
 * deleted from a design somebody approved.
 */

type Busy = null | 'avatar-generate' | 'avatar-upload' | 'voice-upload' | 'recording' | 'preview';

/** What `asset.upload_url` hands back. */
interface Presigned {
  uploadUrl: string;
  readUrl: string;
  key: string;
}

export function AgentStep({ genomeId, brandName }: { genomeId: string; brandName: string }) {
  const [name, setName] = useState('');
  const [testLine, setTestLine] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  /** The portrait currently representing the agent, for the preview tile. */
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [hasVoice, setHasVoice] = useState(false);

  /** The last `voice.preview` result, played by the pill player. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  /**
   * Read once, because somebody may have named it already and an empty field
   * would read as "not set".
   *
   * ── The bug this comment used to describe and then have ──────────────
   *
   * It read `res.output.agentName`. `brand.governance.get` does not return
   * that: the name comes back inside the derived identity, as
   * `agentIdentity.name` (`brand.governance.set` is the side that takes a bare
   * `agentName`, which is what made the mistake plausible). So the read was
   * always `undefined`, the field never prefilled, and anyone who named their
   * agent and came back to this step saw an empty box and concluded it had not
   * saved. It had.
   *
   * The hand-written type parameter is why the compiler was no help — asserting
   * `{ agentName?: string }` on a response that has no such field type-checks
   * perfectly. It now names the shape it actually receives.
   */
  useEffect(() => {
    void (async () => {
      const res = await invoke<{ agentIdentity?: { name: string; named: boolean } }>(
        'brand.governance.get',
        {},
      );
      if (res.status !== 'succeeded') return;
      /* `named` distinguishes a real name from the `UNNAMED_AGENT` fallback the
         tool substitutes — putting "Your agent" in the box as if somebody had
         typed it is the same class of lie as showing nothing. */
      const id = res.output.agentIdentity;
      if (id?.named && id.name) {
        setName(id.name);
        setSaved(id.name);
      }
    })();
  }, []);

  /**
   * Whether this brand already has an avatar and a voice, so returning to the
   * step shows what is set rather than an empty screen that implies nothing is.
   */
  useEffect(() => {
    void (async () => {
      const res = await invoke<{
        genome?: { constraints?: { heygen_avatar_id?: string; elevenlabs_voice_id?: string } };
      }>('genome.get', { genomeId });
      if (res.status !== 'succeeded') return;
      const c = res.output.genome?.constraints;
      if (c?.heygen_avatar_id) setHasAvatar(true);
      if (c?.elevenlabs_voice_id) setHasVoice(true);
    })();
  }, [genomeId]);

  /** Stop any playing preview when the step unmounts, or it keeps talking. */
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
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
    /* The "Ask Spark?" orb caches the name per brand, and this is the only
       thing in the app that changes it — so this is the only place that has to
       say so. Without it the orb keeps the old name until the tab reloads.
       See `lib/useAgentIdentity.ts`. */
    invalidateAgentIdentity(genomeId);
  }

  /**
   * `asset.upload_url` → PUT → the storage URL, which is what every tool here
   * takes. Returns `null` and sets the error, so callers read as a straight line.
   */
  async function putBytes(file: Blob, filename: string, contentType: string): Promise<string | null> {
    const presigned = await invoke<Presigned>('asset.upload_url', {
      genomeId,
      filename,
      contentType,
      sizeBytes: file.size,
    });
    if (presigned.status !== 'succeeded') {
      setError(presigned.status === 'failed' ? presigned.error.message : 'That upload needs approval first.');
      return null;
    }
    // `uploadToStorage` owns the failure wording, because `fetch`'s own is the
    // literal string "Failed to fetch" — which is what a missing CORS rule on
    // the bucket shows a user beside a drop zone.
    const put = await uploadToStorage(presigned.output.uploadUrl, file, contentType);
    if (!put.ok) {
      setError(put.message);
      return null;
    }
    return presigned.output.readUrl;
  }

  /** Clear both banners; every action starts from a clean slate. */
  function begin(next: Busy) {
    setError(null);
    setNotice(null);
    setBusy(next);
  }

  async function generateAvatar() {
    begin('avatar-generate');
    const res = await invoke<{ imageUrl: string }>('genome.avatar.generate', { genomeId }, crypto.randomUUID());
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Generating an avatar needs approval first.');
      return;
    }
    setAvatarUrl(res.output.imageUrl);
    setHasAvatar(true);
    setNotice('Generated a presenter and set it as your avatar.');
  }

  async function uploadAvatar(file: File) {
    const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    begin('avatar-upload');
    const url = await putBytes(file, file.name, contentType);
    if (!url) {
      setBusy(null);
      return;
    }
    const res = await invoke('genome.avatar.from_image', { genomeId, imageUrl: url, contentType }, crypto.randomUUID());
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Setting an avatar needs approval first.');
      return;
    }
    /* Show the uploaded file itself rather than re-fetching: the browser already
       has it, and HeyGen returns an id, not a renderable image. */
    setAvatarUrl(URL.createObjectURL(file));
    setHasAvatar(true);
    setNotice('Avatar set from your photo.');
  }

  /** Shared by the drop zone and the recorder — both end up as one audio blob. */
  async function cloneVoice(blob: Blob, filename: string, contentType: string) {
    const url = await putBytes(blob, filename, contentType);
    if (!url) {
      setBusy(null);
      return;
    }
    const res = await invoke<{ requiresVerification: boolean }>(
      'genome.voice.clone_from_sample',
      { genomeId, name: `${brandName} — agent voice`, samples: [{ url, contentType }] },
      crypto.randomUUID(),
    );
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Cloning a voice needs approval first.');
      return;
    }
    setHasVoice(true);
    setNotice(
      res.output.requiresVerification
        ? 'Voice created. ElevenLabs needs it verified in their dashboard before it will narrate.'
        : 'Voice created. Type a line on the right to hear it.',
    );
  }

  async function uploadVoice(file: File) {
    begin('voice-upload');
    await cloneVoice(file, file.name, file.type || 'audio/mpeg');
  }

  /**
   * Record in the browser, then take the same path as an uploaded file.
   *
   * `audio/webm` because it is what Chrome and Firefox actually produce from
   * `MediaRecorder`; Safari gives `audio/mp4`. Both are read server-side and
   * handed to ElevenLabs as bytes, so neither needs transcoding here.
   */
  async function toggleRecord() {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    begin('recording');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setBusy(null);
      setError('No microphone available, or permission was declined. You can upload a file instead.');
      return;
    }

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      setBusy('voice-upload');
      void cloneVoice(blob, `recording.${type.includes('mp4') ? 'm4a' : 'webm'}`, type);
    };
    recorderRef.current = recorder;
    recorder.start();
  }

  async function playTest() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    // Replay what was already synthesised rather than paying for it twice.
    if (previewUrl) {
      void audioRef.current?.play();
      setPlaying(true);
      return;
    }
    const line = testLine.trim();
    if (!line) {
      setError('Type a line to hear it first.');
      return;
    }
    begin('preview');
    const res = await invoke<{ url: string }>('voice.preview', { genomeId, text: line }, crypto.randomUUID());
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Previewing the voice needs approval first.');
      return;
    }
    setPreviewUrl(res.output.url);
  }

  /** A new line means the cached audio is stale — drop it so the next play re-synthesises. */
  function changeTestLine(next: string) {
    setTestLine(next);
    if (previewUrl) {
      audioRef.current?.pause();
      setPlaying(false);
      setPreviewUrl(null);
    }
  }

  const recording = busy === 'recording';

  /*
    `…193231` and the prototype's Agent Setup screen, at its own numbers: a
    432x65 name field, a 444x198 avatar section at radius 19.14, a 431x71 Cameo
    card, and an 896x308 voice section holding a 397x151 drop zone, a 397x101
    record panel, a 391x134 test box and a 391x46 player pill.
  */
  return (
    <ProtoScale native={896}>
      <div style={{ position: 'relative', width: 896, height: 700 }} onBlur={() => void save()}>
        {/* Name your agent */}
        <div style={{ position: 'absolute', left: 4, top: 0 }}>
          <SectionLabel>Name your agent</SectionLabel>
        </div>
        <input
          type="text"
          value={name}
          placeholder="Enter text"
          aria-label="Agent name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          style={{
            position: 'absolute', left: 4, top: 41, width: 432, height: 65, borderRadius: 10,
            background: '#FFFFFF', border: 'none', outline: 'none', padding: '0 24px',
            fontSize: 18, fontWeight: 500, color: '#0C0C0C',
          }}
        />

        {/* Content Avatar */}
        <div style={{ position: 'absolute', left: 452, top: 0 }}>
          <SectionLabel>Content Avatar</SectionLabel>
        </div>
        <button
          type="button"
          onClick={() => void generateAvatar()}
          disabled={busy !== null}
          title="Generate a synthetic presenter from your brand description. No real person is involved."
          style={{
            position: 'absolute', left: 719, top: -11, width: 177, height: 44, borderRadius: 10.38,
            background: '#FFFFFF', boxShadow: 'inset 0 0 0 0.69px rgba(12,12,12,0.1)', border: 'none',
            cursor: busy ? 'progress' : 'pointer', opacity: busy && busy !== 'avatar-generate' ? 0.45 : 1,
          }}
        >
          <svg width="20" height="19" viewBox="0 0 20 19" style={{ position: 'absolute', left: 12, top: 12, display: 'block' }} aria-hidden>
            <defs>
              <linearGradient id="agent-sparkle" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6CE8FF" />
                <stop offset="0.27" stopColor="#F56BFF" />
                <stop offset="0.67" stopColor="#A341FF" />
                <stop offset="1" stopColor="#FEDEB5" />
              </linearGradient>
            </defs>
            <path d="M10 0.8 11.9 6.4 17.6 8.3 11.9 10.2 10 15.8 8.1 10.2 2.4 8.3 8.1 6.4Z" fill="url(#agent-sparkle)" />
          </svg>
          <span style={{ position: 'absolute', left: 40, top: 12, fontSize: 16, fontWeight: 500, color: '#0C0C0C' }}>
            {busy === 'avatar-generate' ? 'Generating…' : 'Generate Avatar'}
          </span>
        </button>

        <div
          style={{
            position: 'absolute', left: 452, top: 41, width: 444, height: 198, borderRadius: 19.14,
            background: '#F3F4F8', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)',
          }}
        >
          <DropZone
            left={20}
            top={17}
            width={255}
            accept="image/png,image/jpeg"
            formats="Png, Jpeg — one clear face"
            onFile={(f) => void uploadAvatar(f)}
            busy={busy === 'avatar-upload'}
            disabled={busy !== null && busy !== 'avatar-upload'}
          />
          <span style={{ position: 'absolute', left: 307, top: 16, fontSize: 14, color: '#838383' }}>Avatar Preview</span>
          <div
            style={{
              position: 'absolute', left: 294, top: 45.2, width: 129.7, height: 129.7, borderRadius: 15,
              background: 'linear-gradient(180deg,#D1FFF4 0%,#DFF3FF 100%)', boxShadow: '0 0 0 5px #FFFFFF',
              overflow: 'hidden',
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Agent avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : hasAvatar ? (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#838383', textAlign: 'center', padding: 8 }}>
                Avatar set
              </span>
            ) : null}
          </div>
        </div>

        {/* Cameo — the one control with nothing behind it. */}
        <div style={{ position: 'absolute', left: 4, top: 135, display: 'flex', alignItems: 'center', gap: 12 }}>
          <SectionLabel info="Import your Sora cameo likeness for AI video posts.">Connect Cameo Account</SectionLabel>
          <span style={{ fontSize: 16, color: '#838383', opacity: 0.6 }}>Optional</span>
        </div>
        <div
          title="No Cameo integration exists yet — there is no public API to build one against."
          style={{
            position: 'absolute', left: 3, top: 169, width: 431, height: 71, borderRadius: 19.14,
            background: '#F3F4F8', boxShadow: 'inset 0 0 0 1.28px rgba(12,12,12,0.1)', opacity: 0.55,
          }}
        >
          <span style={{ position: 'absolute', left: 24, top: 25, fontSize: 18, fontWeight: 500, color: '#838383' }}>Sora Avatar Cameo Import</span>
          <div style={{ position: 'absolute', left: 303, top: 13, width: 113, height: 44, borderRadius: 10.38, background: '#FFFFFF', boxShadow: 'inset 0 0 0 0.69px rgba(12,12,12,0.1)' }}>
            <span style={{ position: 'absolute', left: 35, top: 13, fontSize: 16, fontWeight: 500, color: '#838383' }}>+ Connect</span>
          </div>
        </div>

        {/* Agent Voice */}
        <div style={{ position: 'absolute', left: 4, top: 271 }}>
          <SectionLabel info="Upload or record a voice sample — Spark clones it for video voiceovers.">
            Agent Voice (for media)
          </SectionLabel>
        </div>
        <div
          style={{
            position: 'absolute', left: 0, top: 318, width: 896, height: 308, borderRadius: 19.14,
            background: '#F3F4F8', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)',
          }}
        >
          <DropZone
            left={22}
            top={20}
            width={397}
            height={151}
            accept="audio/*"
            prompt="Drop audio files here or browse"
            formats="Mp3, Wav — 30 seconds is plenty"
            glyph="audio"
            onFile={(f) => void uploadVoice(f)}
            busy={busy === 'voice-upload'}
            disabled={busy !== null && busy !== 'voice-upload'}
          />
          <div
            style={{
              position: 'absolute', left: 22, top: 187, width: 397, height: 101, borderRadius: 12.76,
              boxShadow: 'inset 0 0 0 1.26px rgba(12,12,12,0.1)',
            }}
          >
            <button
              type="button"
              onClick={() => void toggleRecord()}
              disabled={busy !== null && !recording}
              aria-pressed={recording}
              style={{
                position: 'absolute', left: 125, top: 31, width: 144, height: 38.65, borderRadius: 12,
                background: recording ? '#F01C1C' : '#FFFFFF', border: 'none',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                cursor: busy && !recording ? 'not-allowed' : 'pointer',
                opacity: busy && !recording ? 0.45 : 1,
                transition: 'background 0.2s ease',
              }}
            >
              <svg width="14" height="19" viewBox="0 0 14 19" fill="none" style={{ position: 'absolute', left: 15, top: 10, display: 'block' }} aria-hidden>
                <rect x="4" y="0.9" width="6" height="10.5" rx="3" stroke={recording ? '#FFFFFF' : '#0C0C0C'} strokeWidth="1.6" />
                <path d="M1 8.5a6 6 0 0 0 12 0M7 14.5v3" stroke={recording ? '#FFFFFF' : '#0C0C0C'} strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span style={{ position: 'absolute', left: 39, top: 11, fontSize: 13.6, color: recording ? '#FFFFFF' : '#838383' }}>
                {recording ? 'Stop recording' : 'Tap to Record'}
              </span>
            </button>
          </div>

          <div style={{ position: 'absolute', left: 458, top: 20, width: 288, fontSize: 18, lineHeight: 1.28, color: '#838383' }}>
            Test Agent Voice, type a message to test voice output
          </div>
          <textarea
            value={testLine}
            onChange={(e) => changeTestLine(e.target.value)}
            placeholder={hasVoice ? 'Enter text' : 'Add a voice first, then type here'}
            maxLength={280}
            aria-label="Test the agent voice"
            style={{
              position: 'absolute', left: 457, top: 76, width: 391, height: 134, borderRadius: 10,
              background: '#FFFFFF', border: 'none', resize: 'none', padding: '15px 19px',
              fontSize: 18, fontWeight: 500, color: '#0C0C0C',
            }}
          />
          <div style={{ position: 'absolute', left: 457, top: 236, width: 391, height: 46, borderRadius: 100, background: '#F3F4F8', boxShadow: 'inset 0 0 0 1.28px rgba(12,12,12,0.1)' }}>
            <button
              type="button"
              onClick={() => void playTest()}
              disabled={busy !== null && busy !== 'preview'}
              aria-label={playing ? 'Pause the test line' : 'Speak the test line'}
              style={{
                position: 'absolute', left: 10, top: 7, width: 32, height: 32, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: busy === 'preview' ? 'progress' : 'pointer',
              }}
            >
              {playing ? (
                <svg width="12" height="15" viewBox="0 0 12 15" fill="none" aria-hidden>
                  <rect x="0.5" width="3.8" height="15" rx="1.4" fill="#A341FF" />
                  <rect x="7.7" width="3.8" height="15" rx="1.4" fill="#A341FF" />
                </svg>
              ) : (
                <svg width="11" height="12" viewBox="0 0 11 12" fill="none" aria-hidden>
                  <path d="M1 1.5v9l9-4.5-9-4.5Z" fill={busy === 'preview' ? '#838383' : '#A341FF'} />
                </svg>
              )}
            </button>
            <span style={{ position: 'absolute', left: 50, top: 15, fontSize: 13, color: '#838383' }}>
              {busy === 'preview' ? 'Synthesising…' : previewUrl ? 'Ready — press play' : `${testLine.length}/280`}
            </span>
          </div>
          {previewUrl ? (
            <audio
              ref={audioRef}
              src={previewUrl}
              autoPlay
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          ) : null}
        </div>

        {error ? (
          <p role="alert" style={{ position: 'absolute', left: 4, top: 644, fontSize: 16, color: '#F01C1C' }}>
            {error}
          </p>
        ) : notice ? (
          <p role="status" style={{ position: 'absolute', left: 4, top: 644, fontSize: 16, color: '#838383' }}>
            {notice}
          </p>
        ) : saved ? (
          <p style={{ position: 'absolute', left: 4, top: 644, fontSize: 16, color: '#838383' }}>Saved as {saved}.</p>
        ) : null}
      </div>
    </ProtoScale>
  );
}
