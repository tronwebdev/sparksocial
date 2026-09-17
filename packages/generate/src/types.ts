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
    /**
     * What the campaign this post belongs to is trying to achieve.
     *
     * The writer never had this. It received the brand, its offer and a call to
     * action, and wrote to those — so a post in a hiring campaign and a post in
     * a sales campaign came out of the same brief. The objective decided which
     * playbooks were picked and then never reached the words.
     *
     * Optional because `content.draft`'s ad-hoc path (CC-02) creates posts with
     * no campaign at all; those fall back to the genome's standing objective.
     */
    objective?: string;
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

  /**
   * The post's hashtags, without the leading `#`.
   *
   * ── Why this is its own call and not part of a beat ───────────────────────
   *
   * Hashtags belong to the *post*, and beats are written one at a time by
   * design (so "rewrite just the hook" is possible). Folding them into a beat
   * would mean either every beat carrying its own tags, or one arbitrary beat
   * owning them and losing them the moment somebody regenerated that beat.
   *
   * They are also not a beat in the stored draft, for a blunter reason:
   * `packages/compose` renders a `kind: 'text'` beat as a full-screen type card,
   * so hashtags-as-a-beat would burn "#coldbrew #huila" into the middle of every
   * video. They live in a column on the content item and never reach the pixels.
   *
   * ── Optional on the interface ─────────────────────────────────────────────
   *
   * A writer that cannot produce them is a post with no hashtags, which is
   * exactly the behaviour that existed before this — a strictly better failure
   * than a draft that cannot be written at all. Test doubles and the dev
   * template writer are also spared having to implement it.
   */
  hashtags?(args: {
    genome: Genome;
    playbook: Playbook;
    /** What this specific post is about, when the caller knows. */
    intent?: string;
    /** The copy that was just written, so the tags describe this post and not the brand in general. */
    draftText: string;
    /**
     * How many to write — `hashtagBudget` for the playbook's platforms, already
     * clamped by the cap `platformPolicy` will enforce. Never called with 0.
     */
    budget: number;
  }): Promise<string[]>;
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
