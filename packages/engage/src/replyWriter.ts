import type { Genome } from '@sparksocial/shared/genome';

/**
 * Writes a brand-voiced reply to one inbox message, for `engage.reply.draft`
 * when there is no classifier-suggested reply to reuse (or the caller
 * explicitly asked for a fresh one via `regenerate`).
 *
 * Mirrors `@sparksocial/generate`'s `TextWriter` DI shape and
 * `EngagementClassifier` right above it in this package: the interface lives
 * here, the real (Anthropic) and dev (template) implementations live in
 * `apps/api` (`apps/api/src/reply-writer.ts`, `dev-vendors.ts`), never
 * imported here.
 *
 * Not `TextWriter` itself, deliberately. `TextWriter.write` takes a
 * `Playbook` and a beat `promptRef` because it drafts one beat of a
 * scheduled post — a reply to a comment/DM/story reply is neither, and
 * `apps/api/src/text-writer.ts`'s prompt interpolates
 * `playbook.name`/`playbook.description` directly, so feeding it a
 * fabricated playbook would put a misleading "Playbook: ..." line in front
 * of the model. A reply grounds in the genome and the message it answers,
 * nothing else.
 */
export interface ReplyWriter {
  write(args: { genome: Genome; kind: string; authorHandle: string; messageText: string }): Promise<string>;
}
