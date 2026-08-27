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
  write(args: {
    genome: Genome;
    kind: string;
    authorHandle: string;
    messageText: string;
    /**
     * What the brand has authorised the agent to *offer* in a reply — the four
     * moves from `Settings WS EI Sales`' "Lead Qualification Options":
     * `ask_qualifying_questions`, `share_booking_link`, `share_pricing_link`,
     * `collect_contact_details`.
     *
     * This is the seam `brands.sales_qualification` needed and did not have. The
     * column was validated, stored, hydrated and rendered as four checkboxes, and
     * no runtime path read it — so ticking "Share pricing page link" changed a
     * row and nothing else, and the model was free to offer any of the four
     * whether or not it had been permitted.
     *
     * **Absent means none of them**, which is the direction `brand.governance.set`
     * already documents: an agent quoting a pricing page nobody authorised is
     * worse than one that hands the conversation to a person. So this narrows the
     * writer rather than widening it, and a brand that has never opened the
     * screen gets the careful behaviour.
     */
    salesQualification?: readonly string[];
  }): Promise<string>;
}
