/**
 * The sounds a notification makes, one per kind.
 *
 * Synthesised with the Web Audio API rather than shipped as files: five short
 * tones are a few lines here and nothing to download, cache or license, and
 * they can be tuned in place. Each is under half a second and quiet — a cue,
 * not an alarm:
 *
 *   success  two notes rising            something worked
 *   info     one soft note               something to know
 *   pending  two soft ticks              waiting on someone or something
 *   warning  two level notes             something needs you
 *   error    two notes falling           something failed
 *
 * Off with one switch (Settings → Notifications → On this device), stored in
 * this browser only: whether a laptop beeps is a fact about that laptop.
 *
 * Browsers refuse audio until the page has had a user gesture, so the context
 * is created on the first pointer or key press and every sound before that is
 * silently skipped rather than queued — a chime for something that happened
 * before you touched the page would arrive out of context.
 */

export type SoundKind = 'success' | 'error' | 'warning' | 'info' | 'pending';

const KEY = 'ss:notification-sound';

interface Note {
  freq: number;
  at: number;
  dur: number;
  type?: OscillatorType;
}

const PATTERNS: Record<SoundKind, Note[]> = {
  success: [
    { freq: 784, at: 0, dur: 0.13 },
    { freq: 1175, at: 0.09, dur: 0.26 },
  ],
  info: [{ freq: 880, at: 0, dur: 0.22 }],
  pending: [
    { freq: 659, at: 0, dur: 0.09 },
    { freq: 659, at: 0.15, dur: 0.11 },
  ],
  warning: [
    { freq: 740, at: 0, dur: 0.13, type: 'triangle' },
    { freq: 740, at: 0.18, dur: 0.16, type: 'triangle' },
  ],
  error: [
    { freq: 494, at: 0, dur: 0.16, type: 'triangle' },
    { freq: 370, at: 0.14, dur: 0.32, type: 'triangle' },
  ],
};

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* Private mode: the switch still works for this page view. */
  }
  memo = on;
}

let memo: boolean | null = null;
let ctx: AudioContext | null = null;

function unlock() {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
}

if (typeof window !== 'undefined') {
  const once = () => {
    unlock();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

export function playSound(kind: SoundKind) {
  if (typeof window === 'undefined') return;
  if (!(memo ?? soundEnabled())) return;
  if (!ctx) return; // no gesture yet — see the note above
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = 0.08;
    master.connect(ctx.destination);
    for (const n of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.value = n.freq;
      const t0 = start + n.at;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(1, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(env).connect(master);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.02);
    }
  } catch {
    /* Audio is a nicety. A browser that refuses it loses the chime, not the notification. */
  }
}
