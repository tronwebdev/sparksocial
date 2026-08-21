import type { Genome } from '@sparksocial/shared/genome';
import type { Playbook } from '@sparksocial/playbooks';

/**
 * Writes one beat's copy — a hook, a caption, a CTA line, a script beat.
 * Mirrors `@sparksocial/capture`'s `BriefWriter`: an interface the tool is
 * built against, with the real (Anthropic) and dev (template) implementations
 * living in `apps/api`, never imported here. `packages/generate` must not
 * depend on a vendor SDK any more than `packages/capture` does.
 */
/**
 * One entry per beat in the post being written, in running order.
 *
 * The writer produces one beat at a time — deliberately, so "rewrite just the
 * hook" is a thing the product can do — but a beat written with no knowledge of
 * its neighbours repeats them. Observed: the 30-second `body` of a Voice-over
 * B-roll ended "Book a chair today and see the difference at Northside
 * Barbers", and the very next beat was the CTA, "Book a chair". The post said it
 * twice because nothing told the body writer a CTA was coming.
 *
 * `text` is carried for literal beats (a CTA lifted from the genome) because the
 * exact wording is what a neighbouring beat has to avoid restating.
 */
export interface BeatOutlineEntry {
  beatId: string;
  /** `copy` — written by a model. `literal` — lifted from the genome or an asset caption. */
  kind: 'copy' | 'literal';
  promptRef?: string;
  text?: string;
}

export interface TextWriter {
  write(args: {
    genome: Genome;
    playbook: Playbook;
    /** The playbook record's own key for this beat, e.g. `hook.craft`, `proof.data_points`. */
    promptRef: string;
    /** What this specific post is about. Optional — grounding still works from the genome alone. */
    intent?: string;
    /** Which beat this is, so the writer can find itself in `outline`. */
    beatId: string;
    /**
     * The beat's own screen time. `0` for a still or a text-only post.
     *
     * This is the fact that decides how much to write, and the writer used not
     * to receive it: a 3-second hook and a 30-second explainer body arrived at
     * the model as the same request, so both came back one line long. A 30s
     * narration beat was filled with 41 words — under half of what fits.
     */
    durationSec: number;
    /** Every beat in the post, in order. See `BeatOutlineEntry`. */
    outline: BeatOutlineEntry[];
  }): Promise<string>;
}

/**
 * Generates one image from a prompt. Unlike `TextWriter`, there is no honest
 * "always available" fallback — a fake image is a lie a draft would ship
 * with, not a degraded-but-usable stand-in the way pseudo-embeddings are. See
 * `apps/api/src/image-client.ts` for the real implementation and why callers
 * get a clear `UPSTREAM_FAILED`/config error instead of a placeholder.
 */
export interface ImageClient {
  generate(args: { prompt: string; aspectRatio: string }): Promise<{ url: string }>;
}

/**
 * Generates one short video clip from a prompt — generative b-roll, no
 * likeness, no spoken script. Same "no honest fallback" reasoning as
 * `ImageClient`: a fake video clip is a lie a draft would ship with, not a
 * degraded-but-usable stand-in.
 */
export interface VideoClient {
  generate(args: { prompt: string; aspectRatio: string; durationSec: number }): Promise<{ url: string }>;
}

/**
 * Renders `script` as spoken by the genome's registered HeyGen avatar
 * (`genome.constraints.heygen_avatar_id`, set via `genome.avatar_config.set`
 * after training completes out of band). No fallback, same reasoning as
 * `ImageClient` — a stand-in face would be a worse lie than a missing one.
 */
export interface AvatarClient {
  generate(args: { avatarId: string; script: string; aspectRatio: string }): Promise<{ url: string }>;
}

/**
 * Narrates `script` in the genome's registered ElevenLabs voice, or a stock
 * voice when the playbook doesn't need the owner's own cloned voice — see
 * `content.generate_voiceover`'s comment on when each applies.
 */
export interface VoiceClient {
  generate(args: { voiceId: string; script: string }): Promise<{ url: string }>;
}

/**
 * Re-voices an existing video or audio file into `targetLanguage` — ElevenLabs
 * Dubbing, a genuinely async vendor job (submit, then poll until done), same
 * "no honest fallback" reasoning as `ImageClient`/`VideoClient`: a fake dub
 * would misrepresent what the audience actually hears.
 */
export interface DubbingClient {
  dub(args: { sourceUrl: string; targetLanguage: string; mediaType: 'video' | 'audio' }): Promise<{ url: string }>;
}
