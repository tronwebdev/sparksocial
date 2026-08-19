import type { Genome } from '@sparksocial/shared/genome';
import type { Playbook } from '@sparksocial/playbooks';

/**
 * Writes one beat's copy — a hook, a caption, a CTA line, a script beat.
 * Mirrors `@sparksocial/capture`'s `BriefWriter`: an interface the tool is
 * built against, with the real (Anthropic) and dev (template) implementations
 * living in `apps/api`, never imported here. `packages/generate` must not
 * depend on a vendor SDK any more than `packages/capture` does.
 */
export interface TextWriter {
  write(args: {
    genome: Genome;
    playbook: Playbook;
    /** The playbook record's own key for this beat, e.g. `hook.craft`, `proof.data_points`. */
    promptRef: string;
    /** What this specific post is about. Optional — grounding still works from the genome alone. */
    intent?: string;
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
