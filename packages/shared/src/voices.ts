import { z } from 'zod';

/**
 * THE VOICE CATALOGUE — `M5`'s "Ai Voice" picker, and `3.3`'s "named voice options".
 *
 * ── The problem this solves, and the one it does not ──────────────────────
 *
 * `content.scene.voice` shipped with an enum — `brand` or `stock` — and a comment
 * saying the prototype's named voice ("Maya · warm, conversational") could not be
 * built because nothing lists available voices and nothing stores one per brand
 * beyond a single cloned `elevenlabs_voice_id`. That was true, and it was the
 * right call at the time: storing a made-up name would have put a control on
 * screen that resolved to nothing.
 *
 * This closes it the same way `brandFonts.ts` closed the font picker. These are
 * **ElevenLabs premade voice ids** — stable, documented, available to every
 * account, and already the source of `STOCK_VOICE_ID` in
 * `packages/generate/src/voice.ts`. A short curated list of real ids is a real
 * control; a text field asking somebody to paste a voice id is not.
 *
 * ── Why five, and why these ───────────────────────────────────────────────
 *
 * Same reasoning as the six fonts: a picker with one entry is not a choice, and a
 * picker with fifty is a research task. Five distinct registers cover the range a
 * small business actually needs, and each is described by what it *sounds like*
 * rather than by its name, because "Rachel" tells a brand owner nothing.
 *
 * ── What is still not here ────────────────────────────────────────────────
 *
 * Not the brand's own cloned voice. That stays `brand` on the scene, resolved
 * from `genome.constraints.elevenlabs_voice_id` and gated on a `voice_clone`
 * consent record — a cloned likeness is a different kind of thing from a stock
 * voice and must not become one entry in a dropdown beside them.
 *
 * Not a preview. Playing a sample means a TTS call per voice per listen, and
 * ElevenLabs bills per character. Worth adding when somebody asks; not worth
 * spending on before they do.
 */

export interface StockVoice {
  /** The ElevenLabs voice id. Sent straight to the vendor. */
  id: string;
  /** What a person calls it. */
  name: string;
  /** What it sounds like — the part that actually helps somebody choose. */
  character: string;
}

export const STOCK_VOICES: readonly StockVoice[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', character: 'Calm, even, unhurried — the safe default' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', character: 'Direct and confident, a little clipped' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', character: 'Warm and conversational, like talking to one person' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', character: 'Low and steady, reads as authoritative' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', character: 'Bright and energetic, good over fast cuts' },
] as const;

/**
 * The default when a brand has expressed no preference.
 *
 * Deliberately the same id `packages/generate/src/voice.ts` has used as
 * `STOCK_VOICE_ID` since it was written, so adding this catalogue changes the
 * sound of exactly nothing until somebody picks something else.
 */
export const DEFAULT_STOCK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export const StockVoiceIdSchema = z
  .string()
  .refine((id) => STOCK_VOICES.some((v) => v.id === id), {
    message: 'Not one of the available voices.',
  });

export function stockVoice(id: string | undefined): StockVoice | undefined {
  return id ? STOCK_VOICES.find((v) => v.id === id) : undefined;
}

/** `Sarah — warm and conversational…`, for a label. Falls back to the id so a stale value still reads as something. */
export function voiceLabel(id: string | undefined): string {
  const v = stockVoice(id);
  if (!v) return id ?? 'Default voice';
  return `${v.name} — ${v.character}`;
}
