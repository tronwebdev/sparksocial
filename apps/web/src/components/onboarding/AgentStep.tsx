'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, SectionLabel, TextInput } from './kit';
import { ProtoScale } from './Stage';

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
    `…193231` and the prototype's Agent Setup screen, at its own numbers: a
    432x65 name field, a 444x198 avatar section at radius 19.14, a 431x71 Cameo
    card, and an 896x308 voice section holding a 397x151 drop zone, a 397x101
    record panel, a 391x134 test box and a 391x46 player pill.

    ── One honest departure, running through the whole screen ─────────────

    The prototype asks for an uploaded avatar image, an uploaded or recorded
    voice sample, and a test box that speaks typed text. Checked against the
    schemas, none of the three exists:

      genome.avatar_config.set   { genomeId, heygenAvatarId?, elevenlabsVoiceId? }
                                 - ids, NOT an uploaded image
      genome.voice.set           { genomeId, voice } - the brand's tone of voice,
                                 NOT audio
      content.generate_voiceover { contentItemId, genomeId, beatId, script, … }
                                 - voices a beat of real content, so it cannot
                                 speak a loose sentence

    So those controls are drawn at full fidelity and disabled, each saying why,
    and the two fields that DO reach the backend sit beneath them. Inventing
    upload endpoints would have been worse than a visible gap.
  */
  return (
    <ProtoScale native={896}>
      <div style={{ position: 'relative', width: 896, height: 640 }} onBlur={() => void save()}>
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
          disabled
          title="Nothing generates an avatar image — the backend stores a HeyGen avatar id."
          style={{
            position: 'absolute', left: 719, top: -11, width: 177, height: 44, borderRadius: 10.38,
            background: '#FFFFFF', boxShadow: 'inset 0 0 0 0.69px rgba(12,12,12,0.1)', border: 'none',
            opacity: 0.45, cursor: 'not-allowed',
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
          <span style={{ position: 'absolute', left: 40, top: 12, fontSize: 16, fontWeight: 500, color: '#0C0C0C' }}>Generate Avatar</span>
        </button>

        <div
          title="No tool accepts an avatar image upload."
          style={{
            position: 'absolute', left: 452, top: 41, width: 444, height: 198, borderRadius: 19.14,
            background: '#F3F4F8', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)', opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          <DropZone left={20} top={17} width={255} accept="image/*" formats="Png, Jpeg up to 500MB" onFile={() => {}} disabled />
          <span style={{ position: 'absolute', left: 307, top: 16, fontSize: 14, color: '#838383' }}>Avatar Preview</span>
          <div
            style={{
              position: 'absolute', left: 294, top: 45.2, width: 129.7, height: 129.7, borderRadius: 15,
              background: 'linear-gradient(180deg,#D1FFF4 0%,#DFF3FF 100%)', boxShadow: '0 0 0 5px #FFFFFF',
            }}
          />
        </div>

        {/* Cameo */}
        <div style={{ position: 'absolute', left: 4, top: 135, display: 'flex', alignItems: 'center', gap: 12 }}>
          <SectionLabel info="Import your Sora cameo likeness for AI video posts.">Connect Cameo Account</SectionLabel>
          <span style={{ fontSize: 16, color: '#838383', opacity: 0.6 }}>Optional</span>
        </div>
        <div
          title="No Cameo integration exists in the tool registry."
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
          <div title="No tool accepts a voice sample upload." style={{ opacity: 0.55, pointerEvents: 'none' }}>
            <DropZone
              left={22}
              top={20}
              width={397}
              height={151}
              accept="audio/*"
              prompt="Drop audio files here or browse"
              formats="Mp3, Wav up to 500MB"
              onFile={() => {}}
              disabled
            />
          </div>
          <div
            title="In-browser recording is not wired, and nothing would accept the audio."
            style={{ position: 'absolute', left: 22, top: 187, width: 397, height: 101, borderRadius: 12.76, boxShadow: 'inset 0 0 0 1.26px rgba(12,12,12,0.1)', opacity: 0.55 }}
          >
            <div style={{ position: 'absolute', left: 125, top: 31, width: 144, height: 38.65, borderRadius: 12, background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <span style={{ position: 'absolute', left: 39, top: 11, fontSize: 13.6, color: '#838383' }}>Tap to Record</span>
            </div>
          </div>

          <div style={{ position: 'absolute', left: 458, top: 20, width: 288, fontSize: 18, lineHeight: 1.28, color: '#838383' }}>
            Test Agent Voice, type a message to test voice output
          </div>
          <textarea
            value={testLine}
            onChange={(e) => setTestLine(e.target.value)}
            placeholder="Enter text"
            disabled
            aria-label="Test the agent voice (unavailable)"
            title="content.generate_voiceover voices a beat of real content — it needs a contentItemId, so it cannot speak a loose sentence."
            style={{
              position: 'absolute', left: 457, top: 76, width: 391, height: 134, borderRadius: 10,
              background: '#FFFFFF', border: 'none', resize: 'none', padding: '15px 19px',
              fontSize: 18, fontWeight: 500, color: '#0C0C0C', opacity: 0.55,
            }}
          />
          <div style={{ position: 'absolute', left: 457, top: 236, width: 391, height: 46, borderRadius: 100, background: '#F3F4F8', boxShadow: 'inset 0 0 0 1.28px rgba(12,12,12,0.1)', opacity: 0.55 }}>
            <div style={{ position: 'absolute', left: 10, top: 7, width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="11" height="12" viewBox="0 0 11 12" fill="none" aria-hidden>
                <path d="M1 1.5v9l9-4.5-9-4.5Z" fill="#838383" />
              </svg>
            </div>
          </div>
        </div>

        {/* The two fields the backend actually stores. */}
        <div style={{ position: 'absolute', left: 4, top: 660, display: 'grid', gridTemplateColumns: '432px 432px', columnGap: 27 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontSize: 16, color: '#838383' }}>HeyGen avatar id</span>
            <TextInput value={heygenId} onChange={setHeygenId} onEnter={() => void saveIds({})} placeholder="Leave blank if you have none" ariaLabel="HeyGen avatar id" width={432} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontSize: 16, color: '#838383' }}>ElevenLabs voice id</span>
            <TextInput value={elevenId} onChange={setElevenId} onEnter={() => void saveIds({})} placeholder="Leave blank if you have none" ariaLabel="ElevenLabs voice id" width={432} />
          </label>
        </div>

        {error ? (
          <p role="alert" style={{ position: 'absolute', left: 4, top: 770, fontSize: 16, color: '#F01C1C' }}>
            {error}
          </p>
        ) : null}
        {saved ? (
          <p style={{ position: 'absolute', left: 4, top: 770, fontSize: 16, color: '#838383' }}>Saved as {saved}.</p>
        ) : null}
      </div>
    </ProtoScale>
  );
}
