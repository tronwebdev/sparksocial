import type { DraftCaptureBrief } from '@sparksocial/capture';
import { deterministicEmbedding } from './dev-store.js';

/**
 * DEVELOPMENT VENDOR STUBS — captioning, embedding, brief writing.
 *
 * `asset.retrieve`, `asset.ingest_url`, `direct.brief.generate`, and
 * `direct.session.batch` all take these as injected deps (see
 * `packages/assetgraph` and `packages/capture`), so the tools themselves never
 * import a vendor SDK. These stand in for a real multimodal captioner, the
 * `text-embedding-3-large` endpoint, and the LLM that drafts capture briefs,
 * until those are wired.
 *
 * Deterministic on purpose — same input always produces the same output — so
 * results are reproducible in dev and in tests that hit the API.
 */

export function devCaptionClient() {
  return {
    async caption(url: string, mediaType: 'image' | 'video' | 'audio'): Promise<string> {
      return `${mediaType} at ${url}`;
    },
  };
}

/**
 * The four Finish-pipeline deps (`direct.media.ingest`). Deterministic on the
 * media URL so the demo can exercise both the accept and the reject path
 * reproducibly: a URL containing "blurry" reports high blur; anything else
 * reports clean metrics. A real analyzer runs actual signal processing on the
 * file — this stub exists so the pipeline is exercisable end to end without one.
 */
export function devMediaIngestDeps() {
  return {
    async analyze(mediaUrl: string) {
      const blurry = mediaUrl.includes('blurry');
      return {
        blurScore: blurry ? 0.9 : 0.1,
        exposureScore: 0.15,
        shakeScore: 0.1,
        durationSec: 20,
      };
    },
    async detect(_mediaUrl: string) {
      return { startSec: 2, endSec: 20 };
    },
    async dimensions(_mediaUrl: string) {
      return { width: 1920, height: 1080 };
    },
    async run(_plan: unknown, mediaUrl: string) {
      return {
        '9:16': `${mediaUrl}#9x16`,
        '1:1': `${mediaUrl}#1x1`,
        '16:9': `${mediaUrl}#16x9`,
      };
    },
    async embed(text: string) {
      return deterministicEmbedding(text);
    },
  };
}

export function devEmbedClient() {
  return {
    async embed(text: string): Promise<number[]> {
      return deterministicEmbedding(text);
    },
  };
}

/**
 * Concrete, playbook-specific brief templates. A real writer would be an LLM
 * grounded in the genome and the playbook's beat structure; this stub exists so
 * the capture loop is exercisable end to end without one, and it is written to
 * pass `validateBrief` on the first attempt for every direct_finish playbook in
 * the v1 library — same bar a real writer has to clear.
 */
const TEMPLATES: Record<string, Omit<DraftCaptureBrief, 'playbook_id'>> = {
  pb_craft_capture: {
    subject: 'the moment the technique finishes — the last stroke, cut, or fold',
    framing: 'close over the hands, chest height, nothing else in frame',
    orientation: 'vertical',
    duration_sec: 20,
    motion: 'static or a slow push in — no handheld shake',
    audio: 'ambient tool sound only, no speech',
    lighting: 'face a window; avoid a single overhead light',
    do_not: ['do not talk to camera', 'do not use a filter'],
    estimated_effort_sec: 45,
  },
  pb_staff_personality: {
    subject: 'one team member, name and role stated once, then working normally',
    framing: 'waist up, eye level, looking slightly off-camera',
    orientation: 'vertical',
    duration_sec: 20,
    motion: 'static camera on a stand',
    audio: 'natural room sound; a few words to camera are fine',
    lighting: 'face a window or bright doorway',
    do_not: ['do not read from a script', 'do not stand in front of a plain wall'],
    estimated_effort_sec: 40,
  },
  pb_space_atmosphere: {
    subject: 'the room at opening, before customers arrive',
    framing: 'wide shot from the entrance, slow walk-through',
    orientation: 'vertical',
    duration_sec: 15,
    motion: 'slow walking shot, one continuous pass',
    audio: 'ambient room sound, sound on',
    lighting: 'shoot with the lights already on, morning light if possible',
    do_not: ['do not narrate', 'do not include any customer faces'],
    estimated_effort_sec: 35,
  },
  pb_customer_reaction: {
    subject: "the customer's face the moment they see the finished result",
    framing: 'over the shoulder of the result, on the customer\'s face',
    orientation: 'vertical',
    duration_sec: 12,
    motion: 'static, held steady through the reaction',
    audio: 'their real reaction, sound on',
    lighting: 'use the room light already on the chair or table',
    do_not: ['do not film without saying you are filming them first', 'do not stage the reaction'],
    estimated_effort_sec: 30,
  },
  pb_behind_the_build: {
    subject: 'tools or ingredients being laid out before the first customer',
    framing: 'top-down or three-quarter angle on the prep surface',
    orientation: 'vertical',
    duration_sec: 18,
    motion: 'slow pan across the setup, one pass',
    audio: 'ambient prep sound',
    lighting: 'overhead work light is fine here — this is the exception',
    do_not: ['do not rush the pan', 'do not include price tags or supplier boxes'],
    estimated_effort_sec: 40,
  },
  pb_day_in_the_life: {
    subject: 'three short moments across one shift: opening, mid-day work, closing',
    framing: 'handheld is fine, chest height, one subject per clip',
    orientation: 'vertical',
    duration_sec: 45,
    motion: 'brief handheld clips, no long pans',
    audio: 'ambient sound throughout, no narration needed',
    lighting: 'whatever is naturally on at each moment of the day',
    do_not: ['do not restage a moment that already happened', 'do not combine more than three clips'],
    estimated_effort_sec: 75,
  },
};

const FALLBACK: Omit<DraftCaptureBrief, 'playbook_id'> = {
  subject: 'the core activity this format is named for, filmed as it actually happens',
  framing: 'chest height, subject centred, nothing distracting in frame',
  orientation: 'vertical',
  duration_sec: 20,
  motion: 'static camera on a stand',
  audio: 'ambient sound only, no speech',
  lighting: 'face a window; avoid a single overhead light',
  do_not: ['do not talk to camera', 'do not use a filter'],
  estimated_effort_sec: 40,
};

export function devBriefWriter() {
  return {
    async write({ playbook }: { playbook: { playbook_id: string } }): Promise<DraftCaptureBrief> {
      const template = TEMPLATES[playbook.playbook_id] ?? FALLBACK;
      return { playbook_id: playbook.playbook_id, ...template };
    },
  };
}

/**
 * Development genome inference.
 *
 * Returns a deterministic, deliberately *incomplete* profile: identity is
 * filled, but only the dimensions a real crawl could plausibly evidence, and
 * one chip sits under the confidence floor. That shape is the point — it
 * exercises the path where `inferGenome` routes unresolved dimensions into
 * onboarding questions instead of guessing, which is the behaviour §1.2 depends
 * on and the one a happy-path fake would hide.
 *
 * Production swaps in an Opus-backed client; nothing else changes.
 */
export function devInferenceClient() {
  return {
    async infer({ sourceUrl }: { prompt: string; sourceUrl: string }) {
      const host = (() => {
        try {
          return new URL(sourceUrl).hostname.replace(/^www\./, '');
        } catch {
          return 'example.com';
        }
      })();
      const name = host.split('.')[0] ?? 'the business';

      return {
        identity: {
          businessName: name.charAt(0).toUpperCase() + name.slice(1),
          category: 'services',
          oneLiner: `Inferred from ${host}`,
          geography: { scope: 'local', locale: 'en-NG', radiusKm: 10 },
          languages: ['en'],
          priceTier: 'mid',
        },
        // `objective` and `talent_availability` are deliberately absent: a
        // website rarely evidences either, and asking is cheaper than being
        // wrong about the dimensions that route the whole engine.
        dimensions: { proof_asset: ['physical_craft'], capture_capability: ['space'] },
        voice: { tone: ['plain', 'warm'] },
        chips: [
          { field: 'identity.business_name', value: name, confidence: 0.95 },
          { field: 'dimensions.proof_asset', value: 'physical_craft', confidence: 0.72 },
          { field: 'identity.price_tier', value: 'mid', confidence: 0.41 },
        ],
      };
    },
  };
}
