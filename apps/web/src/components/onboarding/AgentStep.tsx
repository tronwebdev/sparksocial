'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@/lib/tools';
import { uploadToStorage, type PresignedUpload } from '@/lib/uploadToStorage';
import { invalidateAgentIdentity } from '@/lib/useAgentIdentity';
import { DropZone, SectionLabel, SelectField } from './kit';
import { VoiceWaveform } from '@/components/common/VoiceWaveform';
import { clockMMSS as clock, DEFAULT_STOCK_VOICE_ID, STOCK_VOICES } from '@sparksocial/shared';
import { ProtoScale } from './Stage';
import { notify, notifyResult } from '@/lib/notify';
import { Busy as BusyLabel, SparkLoader } from '@/components/brand/SparkLoader';

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
 * ── Sora Cameo, commented out ─────────────────────────────────────────────
 *
 * It used to be drawn, disabled and labelled Optional, on the argument that
 * hiding it would hide a real gap. The counter-argument won: a permanently
 * dead control on the last screen of onboarding is not a note to the team, it
 * is a thing a customer tries to click. OpenAI publishes no Cameo API, so
 * there is no date on which this becomes live by itself.
 *
 * The markup is kept in place, commented, with its coordinates — so restoring
 * it is a deletion of two comment markers rather than an archaeology exercise
 * — and `docs/GAPS.md` holds the gap. Its slot now carries the stock voice
 * picker.
 *
 * ── Consent is captured where the likeness is made ────────────────────────
 *
 * `guard.rights` refuses any avatar or voice format without an active consent
 * record for the person being cloned, and nothing in onboarding was creating
 * one: `PersonalizeStep`, the only component that called
 * `genome.consent.grant`, was never rendered by anything. So a brand could
 * clone a voice here, hear it play back in the test box, and then be refused
 * at generation time with no record of why.
 *
 * The attestation is asked at the moment the likeness is about to be created
 * rather than as a field sitting on the page, because that is when it is
 * truthful: "I have this person's permission" is a statement about an act, and
 * a checkbox ticked five minutes earlier on a different part of the screen is
 * not the same statement. `genome.avatar.generate` never asks, because no real
 * person is involved — its own summary says so.
 */

type Busy = null | 'avatar-generate' | 'avatar-upload' | 'voice-upload' | 'recording' | 'preview';

export function AgentStep({ genomeId, brandName }: { genomeId: string; brandName: string }) {
  const [name, setName] = useState('');
  const [testLine, setTestLine] = useState('');
  /** The name as last saved, so a blur with nothing changed does not save again. */
  const [saved, setSaved] = useState<string | null>(null);
  /**
   * The one message that stays on the screen: the test box's own "type a line
   * first". Everything an action comes to — saved, failed, sent for approval —
   * is a notification instead.
   */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  /** The portrait currently representing the agent, for the preview tile. */
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  /**
   * Whether a voice has been *cloned* — a recording or upload that became an
   * ElevenLabs voice. Not the same as "this brand can speak": see `canSpeak`.
   */
  const [hasVoice, setHasVoice] = useState(false);

  /** Transport state for the test-voice player: seconds, not a fraction, so the clock is the source. */
  const [previewAt, setPreviewAt] = useState(0);
  const [previewLength, setPreviewLength] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  /** The last `voice.preview` result, played by the pill player. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  /**
   * The take, before it is cloned.
   *
   * Recording and uploading both land here rather than going straight to the
   * vendor. The screen had no step between "stop" and "a voice exists": a
   * muted microphone and a good take were indistinguishable until ElevenLabs
   * answered, minutes later and one screen away. Now the clip is drawn and
   * playable, and nothing leaves the browser until somebody says use it.
   */
  const [captured, setCaptured] = useState<{ blob: Blob; name: string; type: string } | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipProgress, setClipProgress] = useState(0);
  const [clipPlaying, setClipPlaying] = useState(false);
  const clipRef = useRef<HTMLAudioElement | null>(null);
  /** The live stream while recording, for the analyser. */
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);

  /** The brand's chosen stock voice — what its videos are narrated in without a clone. */
  const [stockVoiceId, setStockVoiceId] = useState(DEFAULT_STOCK_VOICE_ID);

  /**
   * Whether there is any voice to speak the test line in.
   *
   * The test box used to read `hasVoice`, which is only ever set by a
   * successful *clone*. Adding the stock picker above made that wrong on
   * arrival: `stockVoiceId` defaults to Rachel, so every brand can already
   * speak, and the box still said "Add a voice first, then type here" to
   * someone who had done nothing wrong and had nothing left to do. The field
   * was never actually disabled, and `content.voice.generate` resolves
   * `stockVoiceId` perfectly well — so the copy was the only thing broken,
   * which is the kind of wrong that reads as "this screen is stuck".
   *
   * Kept as a separate derived value rather than folded into `hasVoice`,
   * because the two questions are genuinely different: the recorder's own
   * controls care whether a clone exists, and only this box cares whether
   * *anything* can talk.
   */
  const canSpeak = hasVoice || stockVoiceId.length > 0;

  /**
   * A likeness waiting on its attestation.
   *
   * Holds the work to run *after* consent is granted, so the upload and the
   * grant cannot get out of order: nothing is cloned until there is a record
   * naming whose likeness it is.
   */
  const [pendingConsent, setPendingConsent] = useState<
    | { kind: 'avatar_clone' | 'voice_clone'; what: string; run: (subject: string) => Promise<void> }
    | null
  >(null);
  const [subject, setSubject] = useState('');

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
      const res = await invoke<{
        agentIdentity?: { name: string; named: boolean };
        stockVoiceId?: string;
      }>('brand.governance.get', {});
      if (res.status !== 'succeeded') return;
      /* `named` distinguishes a real name from the `UNNAMED_AGENT` fallback the
         tool substitutes — putting "Your agent" in the box as if somebody had
         typed it is the same class of lie as showing nothing. */
      const id = res.output.agentIdentity;
      if (id?.named && id.name) {
        setName(id.name);
        setSaved(id.name);
      }
      if (res.output.stockVoiceId) setStockVoiceId(res.output.stockVoiceId);
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

  /**
   * One object URL per clip, revoked when it is replaced.
   *
   * Without the revoke each re-record leaks a blob for the life of the tab,
   * and a voice sample is megabytes rather than kilobytes.
   */
  useEffect(() => {
    if (!captured) {
      setClipUrl(null);
      return;
    }
    const url = URL.createObjectURL(captured.blob);
    setClipUrl(url);
    setClipProgress(0);
    setClipPlaying(false);
    return () => URL.revokeObjectURL(url);
  }, [captured]);

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
    const res = await invoke('brand.governance.set', { agentName: next || null });
    const done = next ? { title: 'Agent named', body: `Saved as ${next}.` } : 'Agent name cleared';
    if (!notifyResult(res, done, 'Couldn’t name your agent')) return;
    setSaved(next);
    /* The "Ask Spark?" orb caches the name per brand, and this is the only
       thing in the app that changes it — so this is the only place that has to
       say so. Without it the orb keeps the old name until the tab reloads.
       See `lib/useAgentIdentity.ts`. */
    invalidateAgentIdentity(genomeId);
  }

  /** The stock voice is a governance setting, saved on pick rather than on blur. */
  async function saveStockVoice(next: string) {
    setStockVoiceId(next);
    /* A new pick invalidates the cached preview — otherwise pressing play
       replays the previous voice and the picker looks like it did nothing. */
    setPreviewUrl(null);
    setError(null);
    const res = await invoke('brand.governance.set', { stockVoiceId: next });
    notifyResult(res, { title: 'Voice set', body: 'Type a line on the right to hear it.' }, 'Couldn’t change the voice');
  }

  /**
   * Record the attestation, then do the thing it was for.
   *
   * Consent first and the clone second: if the order were reversed and the
   * consent write failed, the genome would point at a likeness nobody had
   * agreed to — configured, and refused at generation time with no record of
   * why. `PersonalizeStep` had this ordering right; it was simply never
   * rendered.
   */
  async function grantAndRun() {
    const who = subject.trim();
    if (!pendingConsent || !who) return;

    const { kind, run } = pendingConsent;
    setPendingConsent(null);
    setSubject('');

    const granted = await invoke(
      'genome.consent.grant',
      { kind, subject: who },
      /*
       * The key is mandatory, not a nicety. `genome.consent.grant` is
       * `idempotent: false` — a second grant is a second attestation — so the
       * invoke middleware refuses the call outright without one. Omitting it
       * is what made `PersonalizeStep` fail every single time it ran, and no
       * unit test would have caught it: the refusal is in the middleware, not
       * in the tool. Fresh per press, so a double click is neither replayed as
       * a no-op nor rejected.
       */
      crypto.randomUUID(),
    );
    if (!notifyResult(granted, undefined, 'Couldn’t record consent')) {
      setBusy(null);
      return;
    }

    await run(who);
  }

  /** Abandon the pending likeness rather than leaving the upload half-done. */
  function cancelConsent() {
    setPendingConsent(null);
    setSubject('');
    setBusy(null);
  }

  /**
   * `asset.upload_url` → PUT → the storage URL, which is what every tool here
   * takes. Returns `null` and says why, so callers read as a straight line.
   */
  async function putBytes(file: Blob, filename: string, contentType: string): Promise<string | null> {
    const presigned = await invoke<PresignedUpload>('asset.upload_url', {
      genomeId,
      filename,
      contentType,
      sizeBytes: file.size,
    });
    if (!notifyResult(presigned, undefined, 'Couldn’t upload that file')) return null;
    // `uploadToStorage` owns the failure wording, because `fetch`'s own is the
    // literal string "Failed to fetch" — which is what a missing CORS rule on
    // the bucket shows a user beside a drop zone.
    const put = await uploadToStorage(presigned.output.uploadUrl, file, contentType, presigned.output.headers);
    if (!put.ok) {
      notify.error('Couldn’t upload that file', { body: put.message });
      return null;
    }
    return presigned.output.readUrl;
  }

  /**
   * Seek to the point on the track that was pressed.
   *
   * The design binds this to a click on the 281px track. The knob is also
   * draggable here, which the design does not specify — but it draws a knob,
   * and a knob that cannot be dragged is a control lying about what it is.
   */
  function seekTo(clientX: number) {
    const el = trackRef.current;
    const audio = audioRef.current;
    if (!el || !audio || !Number.isFinite(audio.duration) || audio.duration === 0) return;

    const box = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    audio.currentTime = fraction * audio.duration;
    setPreviewAt(audio.currentTime);
  }

  function startScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!previewUrl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  }

  /** Clear the test box's hint; every action starts from a clean slate. */
  function begin(next: Busy) {
    setError(null);
    setBusy(next);
  }

  async function generateAvatar() {
    begin('avatar-generate');
    const res = await invoke<{ imageUrl: string }>('genome.avatar.generate', { genomeId }, crypto.randomUUID());
    setBusy(null);
    const done = { title: 'Avatar generated', body: 'A synthetic presenter is now your avatar.' };
    if (!notifyResult(res, done, 'Couldn’t generate an avatar')) return;
    setAvatarUrl(res.output.imageUrl);
    setHasAvatar(true);
  }

  /**
   * A photo is a real person's face, so it asks before it clones.
   *
   * The bytes go up first and the clone waits behind the attestation: the
   * upload is harmless on its own (nothing enters the Asset Graph until a tool
   * is called with a role), and asking for a name before the file has even
   * transferred would mean collecting a legal statement about an upload that
   * might then fail.
   */
  async function uploadAvatar(file: File) {
    const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    begin('avatar-upload');
    const url = await putBytes(file, file.name, contentType);
    if (!url) {
      setBusy(null);
      return;
    }
    setPendingConsent({
      kind: 'avatar_clone',
      what: 'this photo',
      run: () => setAvatarFrom(file, url, contentType),
    });
  }

  async function setAvatarFrom(file: File, url: string, contentType: string) {
    setBusy('avatar-upload');
    const res = await invoke('genome.avatar.from_image', { genomeId, imageUrl: url, contentType }, crypto.randomUUID());
    setBusy(null);
    if (!notifyResult(res, 'Avatar set from your photo', 'Couldn’t set your avatar')) return;
    /* Show the uploaded file itself rather than re-fetching: the browser already
       has it, and HeyGen returns an id, not a renderable image. */
    setAvatarUrl(URL.createObjectURL(file));
    setHasAvatar(true);
  }

  /** Shared by the drop zone and the recorder — both end up as one audio blob. */
  async function cloneVoice(blob: Blob, filename: string, contentType: string) {
    const url = await putBytes(blob, filename, contentType);
    if (!url) {
      setBusy(null);
      return;
    }
    setPendingConsent({
      kind: 'voice_clone',
      what: 'this recording',
      run: () => runClone(url, contentType),
    });
  }

  async function runClone(url: string, contentType: string) {
    setBusy('voice-upload');
    const res = await invoke<{ requiresVerification: boolean }>(
      'genome.voice.clone_from_sample',
      { genomeId, name: `${brandName} — agent voice`, samples: [{ url, contentType }] },
      crypto.randomUUID(),
    );
    setBusy(null);
    if (!notifyResult(res, undefined, 'Couldn’t create the voice')) return;
    setHasVoice(true);
    /* Created either way; whether it can narrate yet is the difference between
       done and something still to do. */
    if (res.output.requiresVerification) {
      notify.warning('Voice created — verify it to use it', {
        body: 'ElevenLabs needs it verified in their dashboard before it will narrate.',
      });
    } else {
      notify.success('Voice created', { body: 'Type a line on the right to hear it.' });
    }
  }

  /*
   * An uploaded file takes the same route as a recording: look at it, hear it,
   * then decide. A file picked from disk is the one somebody is *most* likely
   * to be wrong about — it is named rather than heard — so skipping the
   * review for uploads would skip it in the case that needs it most.
   */
  function uploadVoice(file: File) {
    setError(null);
    setCaptured({ blob: file, name: file.name, type: file.type || 'audio/mpeg' });
  }

  /** The take is good: upload it, take consent, clone. */
  async function useCaptured() {
    if (!captured) return;
    begin('voice-upload');
    const clip = captured;
    setCaptured(null);
    await cloneVoice(clip.blob, clip.name, clip.type);
  }

  /** Play or pause the take. Separate from the test-voice player below — different audio, different element. */
  function toggleClip() {
    const el = clipRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => notify.error('That clip could not be played back'));
    else el.pause();
  }

  function discardCaptured() {
    setCaptured(null);
    setError(null);
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
    setCaptured(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setBusy(null);
      setLiveStream(null);
      notify.error('Couldn’t start recording', {
        body: 'No microphone available, or permission was declined. You can upload a file instead.',
      });
      return;
    }

    setLiveStream(stream);
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      setLiveStream(null);
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      setBusy(null);
      // Review, not upload. Nothing leaves the browser until it is heard.
      setCaptured({ blob, name: `recording.${type.includes('mp4') ? 'm4a' : 'webm'}`, type });
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
    if (!notifyResult(res, undefined, 'Couldn’t preview the voice')) return;
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
   * How far through the clip, 0..1. Guarded on the duration rather than the
   * elapsed time: `audio.duration` is `NaN` until metadata loads, and
   * `0 / NaN` is `NaN`, which would put the knob at `leftNaN` — removed by the
   * browser, so it simply vanishes rather than erroring.
   */
  const previewFraction =
    previewLength > 0 && Number.isFinite(previewLength)
      ? Math.min(1, Math.max(0, previewAt / previewLength))
      : 0;

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
          {/*
            The constraint lives here, not in the drop zone's `formats` line.

            That line reads "Png, Jpeg up to 500MB" because `Onboarding.dc.html`
            says so, and CLAUDE.md makes the `.dc.html` the source of truth for
            copy as much as for spacing. It had been rewritten to "one clear
            face" while wiring this up — true, useful, and not the design's text
            to change. `info` is the app's own affordance, so the vendor's rule
            goes there instead of overwriting a designed string.
          */}
          <SectionLabel info="HeyGen needs exactly one clearly visible face, larger than 200x200 pixels.">
            Content Avatar
          </SectionLabel>
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
            {busy === 'avatar-generate' ? <BusyLabel size={16}>Generating…</BusyLabel> : 'Generate Avatar'}
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
            formats="Png, Jpeg up to 500MB"
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

        {/*
          ── Sora Cameo, commented out ───────────────────────────────────

          OpenAI publishes no Cameo API, so this had no integration behind it
          and no date on which it would get one. It was drawn disabled at 55%
          opacity with a tooltip saying so, which reads to the team as a note
          and to a customer as a broken button on the last screen of
          onboarding.

          Kept here verbatim with its coordinates — left 3, top 169, 431x71,
          radius 19.14 — so restoring it means removing two comment markers.
          The slot now carries the stock voice picker below.

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
        */}

        {/*
          ── The stock voice, in Cameo's slot ────────────────────────────

          Not in the design, and the screen was incoherent without it: it asks
          what your agent sounds like and offered only "clone a real person's
          voice". A brand that does not want to clone anybody had no answer,
          though five real ElevenLabs ids and a `stockVoiceId` field to store
          the choice both already existed — reachable only from Settings.

          `content.voice.generate` already resolves `stockVoiceId` and falls
          back to the same default, so picking one here changes what the
          brand's videos actually sound like.
        */}
        <div style={{ position: 'absolute', left: 4, top: 135 }}>
          <SectionLabel info="The voice your videos are narrated in when you have not cloned one. Spark uses this by default.">
            Agent Voice (stock)
          </SectionLabel>
        </div>
        <div style={{ position: 'absolute', left: 3, top: 172 }}>
          <SelectField
            value={stockVoiceId}
            onChange={(v) => void saveStockVoice(v)}
            ariaLabel="Stock voice"
            width={431}
            options={STOCK_VOICES.map((v) => ({ value: v.id, label: `${v.name} — ${v.character}` }))}
          />
        </div>

        {/* Agent Voice */}
        <div style={{ position: 'absolute', left: 4, top: 271 }}>
          <SectionLabel info="Upload or record a voice sample — Spark clones it for video voiceovers. Thirty seconds of clear speech is enough; more does not improve it.">
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
            formats="Mp3, Wav up to 500MB"
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
            {/*
              ── The record control, in three states ─────────────────────

              Idle is the design's own: a 144x38.65 button centred at x125 in
              the 397x101 box, untouched. Recording and review are not in the
              design — there is no waveform in `SparkSocial Onboarding.dc.html`
              — so they are built inside the same box rather than next to it,
              and the button keeps its measurements and simply moves left to
              make room.

              Two small things here ARE the design and were missed first time:
              the label while recording is "Recording…" (not "Stop recording"),
              and the mic glyph pulses — `recordAnim: 'ss-pulse 1s ease-in-out
              infinite'`.
            */}
            <button
              type="button"
              onClick={() => void toggleRecord()}
              disabled={(busy !== null && !recording) || captured !== null}
              aria-pressed={recording}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              style={{
                position: 'absolute',
                left: recording || captured ? 10 : 125,
                top: recording || captured ? 31 : 31,
                width: 144, height: 38.65, borderRadius: 12,
                background: recording ? '#F01C1C' : '#FFFFFF', border: 'none',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                cursor: busy && !recording ? 'not-allowed' : 'pointer',
                opacity: (busy && !recording) || captured ? 0.45 : 1,
                transition: 'background 0.2s ease, left 0.25s cubic-bezier(0.22,1,0.36,1)',
              }}
            >
              <svg
                width="14" height="19" viewBox="0 0 14 19" fill="none" aria-hidden
                style={{
                  position: 'absolute', left: 15, top: 10, display: 'block',
                  animation: recording ? 'ss-pulse 1s ease-in-out infinite' : 'none',
                }}
              >
                <rect x="4" y="0.9" width="6" height="10.5" rx="3" stroke={recording ? '#FFFFFF' : '#0C0C0C'} strokeWidth="1.6" />
                <path d="M1 8.5a6 6 0 0 0 12 0M7 14.5v3" stroke={recording ? '#FFFFFF' : '#0C0C0C'} strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span style={{ position: 'absolute', left: 39, top: 11, fontSize: 13.6, color: recording ? '#FFFFFF' : '#838383' }}>
                {recording ? 'Recording…' : 'Tap to Record'}
              </span>
            </button>

            {/* Live level, so a muted microphone is visible while it is still fixable. */}
            {recording ? (
              <div style={{ position: 'absolute', left: 166, top: 31, width: 221, height: 38.65, display: 'flex', alignItems: 'center' }}>
                <VoiceWaveform mode="live" stream={liveStream} width={221} height={38} color="#F01C1C" />
              </div>
            ) : null}

            {/* The take: look at it, hear it, then decide. */}
            {captured && !recording ? (
              <>
                <button
                  type="button"
                  onClick={toggleClip}
                  aria-label={clipPlaying ? 'Pause the recording' : 'Play the recording'}
                  style={{
                    position: 'absolute', left: 166, top: 36, width: 28, height: 28, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#FFFFFF', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', cursor: 'pointer',
                  }}
                >
                  {clipPlaying ? (
                    <svg width="9" height="11" viewBox="0 0 12 15" fill="none" aria-hidden>
                      <rect x="0.5" width="3.8" height="15" rx="1.4" fill="#A341FF" />
                      <rect x="7.7" width="3.8" height="15" rx="1.4" fill="#A341FF" />
                    </svg>
                  ) : (
                    <svg width="9" height="10" viewBox="0 0 11 12" fill="none" aria-hidden>
                      <path d="M1 1.5v9l9-4.5-9-4.5Z" fill="#A341FF" />
                    </svg>
                  )}
                </button>

                <div style={{ position: 'absolute', left: 202, top: 33, width: 185, height: 34 }}>
                  <VoiceWaveform mode="clip" blob={captured.blob} progress={clipProgress} width={185} height={34} />
                </div>

                <div style={{ position: 'absolute', left: 10, top: 74, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => void useCaptured()}
                    style={{
                      height: 23, padding: '0 12px', borderRadius: 7, background: '#0C0C0C', border: 'none',
                      fontSize: 12, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer',
                    }}
                  >
                    Use this recording
                  </button>
                  <button
                    type="button"
                    onClick={discardCaptured}
                    style={{ height: 23, padding: '0 10px', borderRadius: 7, background: 'transparent', border: 'none', fontSize: 12, color: '#838383', cursor: 'pointer' }}
                  >
                    Discard
                  </button>
                  <span style={{ fontSize: 12, color: '#838383' }}>{captured.name}</span>
                </div>

                {clipUrl ? (
                  <audio
                    ref={clipRef}
                    src={clipUrl}
                    onTimeUpdate={(e) => {
                      const el = e.currentTarget;
                      setClipProgress(el.duration > 0 ? el.currentTime / el.duration : 0);
                    }}
                    onPlay={() => setClipPlaying(true)}
                    onPause={() => setClipPlaying(false)}
                    onEnded={() => {
                      setClipPlaying(false);
                      setClipProgress(0);
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          <div style={{ position: 'absolute', left: 458, top: 20, width: 288, fontSize: 18, lineHeight: 1.28, color: '#838383' }}>
            Test Agent Voice, type a message to test voice output
          </div>
          <textarea
            value={testLine}
            onChange={(e) => changeTestLine(e.target.value)}
            placeholder={canSpeak ? 'Enter text' : 'Add a voice first, then type here'}
            maxLength={280}
            aria-label="Test the agent voice"
            style={{
              position: 'absolute', left: 457, top: 76, width: 391, height: 134, borderRadius: 10,
              background: '#FFFFFF', border: 'none', resize: 'none', padding: '15px 19px',
              fontSize: 18, fontWeight: 500, color: '#0C0C0C',
            }}
          />
          {/*
            ── The test-voice player, as the design draws it ───────────────

            `SparkSocial Onboarding.dc.html`'s `VoicePlayer`, measured: the
            391x46 pill at 457,236 radius 100; a 32px play circle at 10,7;
            elapsed at 41,17 in 10.5/500 `#000`; a seekable 281x17.9 track at
            65,14 — a black 281x7 bar at top 6, a gradient fill over it, and a
            17.9px white knob with a 0.78px inset ring; the duration at 354,17.

            What was here instead was the pill, the play button, and a single
            status string where the whole transport should have been. So the
            one control on this screen whose entire job is to let you *listen*
            to something had no way to see where you were in it, no way to go
            back three seconds, and no idea how long the clip was.
          */}
          {/*
            The 280-character cap, which the design does not draw and the
            player no longer has room for.

            Not decoration: `voice.preview` enforces the ceiling at its schema
            because ElevenLabs bills per character, so a line that silently
            stops at 280 is a bill the writer cannot see. Right-aligned in the
            26px gap the design leaves between the textarea and the player.
          */}
          <span
            style={{
              position: 'absolute', left: 457, top: 214, width: 391, textAlign: 'right',
              fontSize: 12, color: testLine.length >= 280 ? '#F01C1C' : '#838383',
            }}
          >
            {testLine.length}/280
          </span>

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
                <svg width="12" height="15" viewBox="0 0 12 15" fill="none" aria-hidden style={{ display: 'block' }}>
                  <rect x="0.5" width="3.8" height="15" rx="1.4" fill="#A341FF" />
                  <rect x="7.7" width="3.8" height="15" rx="1.4" fill="#A341FF" />
                </svg>
              ) : (
                /* The design's own play glyph, not an approximated triangle. */
                <svg width="15" height="18" viewBox="0 0 17 20" fill="none" aria-hidden style={{ display: 'block', marginLeft: 2 }}>
                  <path
                    d="M3.2.3C2.6-.1 1.8-.1 1.1.3.4.6 0 1.4 0 2.1v15.6c0 .8.4 1.5 1.1 1.9.7.4 1.5.4 2.1 0l12.8-7.8c.6-.4 1-1.1 1-1.8s-.4-1.4-1-1.8L3.2.3Z"
                    fill={busy === 'preview' ? '#838383' : '#A341FF'}
                  />
                </svg>
              )}
            </button>

            <span style={{ position: 'absolute', left: 41, top: 17, fontSize: 10.5, fontWeight: 500, color: '#000000' }}>
              {clock(previewAt)}
            </span>

            <div
              ref={trackRef}
              role="slider"
              tabIndex={previewUrl ? 0 : -1}
              aria-label="Position in the test clip"
              aria-valuemin={0}
              aria-valuemax={Math.round(previewLength)}
              aria-valuenow={Math.round(previewAt)}
              aria-valuetext={`${clock(previewAt)} of ${clock(previewLength)}`}
              onPointerDown={startScrub}
              onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && seekTo(e.clientX)}
              onKeyDown={(e) => {
                /* Arrow keys, because a slider nobody can reach without a
                   mouse is not a control. Five seconds is the usual nudge. */
                const audio = audioRef.current;
                if (!audio || !Number.isFinite(audio.duration)) return;
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const delta = e.key === 'ArrowLeft' ? -5 : 5;
                  audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + delta));
                  setPreviewAt(audio.currentTime);
                }
              }}
              style={{
                position: 'absolute', left: 65, top: 14, width: 281, height: 17.9,
                cursor: previewUrl ? 'pointer' : 'default', touchAction: 'none',
              }}
            >
              <div aria-hidden style={{ position: 'absolute', left: 0, top: 6, width: 281, height: 7, borderRadius: 13.1, background: '#0C0C0C' }} />
              <div
                aria-hidden
                style={{
                  position: 'absolute', left: 0.8, top: 6.45, height: 6, borderRadius: 18.8,
                  background: 'linear-gradient(90deg,#6CE8FF 0%,#F56BFF 27.26%,#A341FF 66.83%,#FEDEB5 100%)',
                  /* 279 and 263, the design's own numbers: the fill is inset by
                     0.8 at each end, and the knob's travel stops at the track's
                     width minus its own 17.9. */
                  width: Math.round(previewFraction * 279),
                }}
              />
              <div
                aria-hidden
                style={{
                  position: 'absolute', left: Number((previewFraction * 263).toFixed(1)), top: 0,
                  width: 17.9, height: 17.9, borderRadius: '50%', background: '#FFFFFF',
                  boxShadow: 'inset 0 0 0 0.78px #000000',
                }}
              />
            </div>

            <span style={{ position: 'absolute', left: 354, top: 17, fontSize: 10.5, fontWeight: 500, color: '#000000' }}>
              {clock(previewLength)}
            </span>
          </div>

          {previewUrl ? (
            <audio
              ref={audioRef}
              src={previewUrl}
              autoPlay
              onLoadedMetadata={(e) => setPreviewLength(e.currentTarget.duration)}
              onTimeUpdate={(e) => setPreviewAt(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                /* Back to the start, so the next press replays rather than
                   doing nothing at a finished clip. */
                setPreviewAt(0);
                if (audioRef.current) audioRef.current.currentTime = 0;
              }}
            />
          ) : null}
        </div>

        {/*
          ── The attestation ─────────────────────────────────────────────

          Shown over the step at the moment a likeness is about to be created,
          because that is the moment the statement is about. It is not a
          checkbox: `genome.consent.grant` records a *subject*, and the rights
          guardrail checks consent per person, so a tick with nobody's name on
          it would satisfy neither.

          Cancelling abandons the upload. The bytes are already in storage and
          are left there — nothing has entered the Asset Graph, because that
          needs a tool call with a role, and deleting them would be a second
          failure path guarding against no harm.
        */}
        {pendingConsent ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm consent"
            style={{
              position: 'absolute', inset: 0, zIndex: 10, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.82)',
            }}
          >
            <div style={{ width: 520, borderRadius: 19.14, background: '#FFFFFF', boxShadow: '0 24px 60px -20px rgba(0,0,0,0.35)', padding: '28px 32px' }}>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0C0C0C' }}>
                Whose {pendingConsent.kind === 'avatar_clone' ? 'face' : 'voice'} is this?
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 16, lineHeight: 1.5, color: '#838383' }}>
                Spark records who gave permission before it copies a real person&rsquo;s{' '}
                {pendingConsent.kind === 'avatar_clone' ? 'likeness' : 'voice'}. Without this,{' '}
                {pendingConsent.what} is stored but never used in a post.
              </p>
              <input
                type="text"
                value={subject}
                autoFocus
                placeholder="Full name"
                aria-label="Name of the person"
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && subject.trim() && void grantAndRun()}
                style={{
                  marginTop: 18, width: '100%', height: 57, borderRadius: 10, background: '#F3F4F8',
                  border: 'none', outline: 'none', padding: '0 20px', fontSize: 18, color: '#0C0C0C',
                }}
              />
              <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: 1.45, color: '#838383' }}>
                By continuing you confirm this person has agreed to their{' '}
                {pendingConsent.kind === 'avatar_clone' ? 'likeness' : 'voice'} being used in this
                brand&rsquo;s content. You can withdraw it at any time in Settings.
              </p>
              <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
                <button
                  type="button"
                  onClick={cancelConsent}
                  style={{ height: 48, padding: '0 20px', borderRadius: 11, background: '#F3F4F8', border: 'none', fontSize: 17, fontWeight: 500, color: '#838383', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void grantAndRun()}
                  disabled={!subject.trim()}
                  style={{
                    height: 48, padding: '0 22px', borderRadius: 11, background: '#0C0C0C', border: 'none',
                    fontSize: 17, fontWeight: 600, color: '#FFFFFF',
                    cursor: subject.trim() ? 'pointer' : 'not-allowed', opacity: subject.trim() ? 1 : 0.4,
                  }}
                >
                  Confirm and continue
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/*
          `Synthesising…` used to live inside the player, in the slot the
          design gives to the elapsed time. It moved here rather than being
          dropped: the greyed play glyph alone is too quiet for a wait that is
          a paid vendor call, and the design has no room for a status string
          between a clock and a seek track. What each action came to — saved,
          created, failed — is a notification, so this line is only ever the
          wait or the test box's hint.
        */}
        {error ? (
          <p role="alert" style={{ position: 'absolute', left: 4, top: 644, fontSize: 16, color: '#F01C1C' }}>
            {error}
          </p>
        ) : busy === 'preview' ? (
          // The 30px mark centres on the line, so the row starts 7px above where the text did.
          <div style={{ position: 'absolute', left: 4, top: 637 }}>
            <SparkLoader size="inline" label="Synthesising…" />
          </div>
        ) : null}
      </div>
    </ProtoScale>
  );
}
