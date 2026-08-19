import type { DraftCaptureBrief } from '@sparksocial/capture';
import type { TextWriter } from '@sparksocial/generate';
import type { EngagementClassifier, ReplyWriter } from '@sparksocial/engage';
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

/**
 * Deterministic pseudo-embeddings at the **real** dimension.
 *
 * The dimension used to be 8 while `schema.ts` declared 1536, so this fake and
 * production disagreed about the shape of the data. Now both read
 * `EMBEDDING_DIM` from `@sparksocial/shared`.
 *
 * Superseded in production by `embedClient()` in `embed-client.ts`, which picks
 * the real provider when a key is configured.
 */
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
 * Keyed on the `prompt_ref` category (the part before the first dot), not the
 * full key or the playbook — same reasoning `text-writer.ts`'s real prompt
 * gives for teaching the model the naming convention rather than hardcoding
 * every key: a `prompt_ref` this map has never seen still gets a sensible
 * generic line via `FALLBACK_LINE`, rather than throwing.
 */
const LINE_TEMPLATES: Record<string, (business: string) => string> = {
  hook: (b) => `${b}: here's a look at how we do it.`,
  proof: (b) => `The numbers behind ${b}'s work, in one line.`,
  offer: (b) => `${b} has room this week — get in touch.`,
  local: (b) => `${b}, right here in the neighbourhood.`,
  teach: (b) => `One thing ${b} wants you to know.`,
  text: (b) => `An update from ${b}.`,
  quote: (b) => `"Quality is never an accident." — ${b}`,
  data: (b) => `${b}, by the numbers.`,
};
const FALLBACK_LINE = (b: string) => `${b} — see what we've been working on.`;

/**
 * Dev counterpart to `text-writer.ts`'s `textWriter()`. Deterministic and
 * uniform on purpose — same warning as `devBriefWriter`: usable, not varied.
 */
export function devTextWriter(): TextWriter {
  return {
    async write({ genome, promptRef }) {
      const category = promptRef.split('.')[0] ?? '';
      const line = LINE_TEMPLATES[category] ?? FALLBACK_LINE;
      return line(genome.identity.business_name);
    },
  };
}

const REPLY_TEMPLATES: Record<string, (business: string) => string> = {
  comment: (b) => `Thanks so much for the comment — glad you're here! — ${b}`,
  dm: (b) => `Thanks for reaching out — someone from ${b} will follow up shortly!`,
  story_reply: (b) => `Appreciate you watching — thanks for the reply! — ${b}`,
};
const FALLBACK_REPLY = (b: string) => `Thanks for reaching out to ${b} — we'll get back to you soon!`;

/**
 * Dev counterpart to `reply-writer.ts`'s `replyWriter()`. Deterministic and
 * uniform on purpose — same warning as `devTextWriter`: usable, not varied,
 * so `engage.reply.draft` exercises the whole draft → approve → send path
 * without an `ANTHROPIC_API_KEY`.
 */
export function devReplyWriter(): ReplyWriter {
  return {
    async write({ genome, kind }) {
      const line = REPLY_TEMPLATES[kind] ?? FALLBACK_REPLY;
      return line(genome.identity.business_name);
    },
  };
}

const SALES_WORDS = ['price', 'pricing', 'cost', 'book', 'buy', 'order', 'interested', 'how much', 'available'];
const PRAISE_WORDS = ['love', 'amazing', 'great', 'awesome', 'thank', 'thanks', 'beautiful', 'perfect'];

/**
 * Dev counterpart to `engage-classifier.ts`'s `engageClassifier()`. Fixed
 * keyword rules, not real judgment — same warning as `devTextWriter`: usable,
 * not smart, so `engage.classify` still exercises the whole ingest → classify
 * → feed path without an `ANTHROPIC_API_KEY`.
 */
export function devEngageClassifier(): EngagementClassifier {
  return {
    async classify({ text }) {
      const lower = text.toLowerCase();
      if (SALES_WORDS.some((w) => lower.includes(w))) {
        return { category: 'sales_opportunity', intentScore: 0.7, reason: 'Contains buying-intent keywords (dev fallback rule).' };
      }
      if (text.includes('?')) {
        return { category: 'needs_review', intentScore: 0.5, reason: 'Contains a question a human should see first (dev fallback rule).' };
      }
      if (PRAISE_WORDS.some((w) => lower.includes(w))) {
        return {
          category: 'auto_handled',
          intentScore: 0.6,
          suggestedReply: 'Thank you so much — really appreciate you saying that!',
          reason: 'Positive engagement, safe to auto-handle (dev fallback rule).',
        };
      }
      return { category: 'needs_review', intentScore: 0.3, reason: 'No fallback rule matched; defaulting to human review.' };
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
