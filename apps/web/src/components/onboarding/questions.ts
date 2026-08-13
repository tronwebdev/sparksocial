/**
 * THE FIVE QUESTIONS — engine spec §1.2, plan §12 P2.
 *
 * These four dimensions route the entire engine: which playbooks resolve, which
 * production mode is available, whether an avatar is ever offered. Everything
 * downstream inherits them, and a wrong answer here is invisible for a month
 * and then shows up as a calendar full of content the business cannot make.
 *
 * ── Data, not components ───────────────────────────────────────────────────
 *
 * Kept as a plain array for the same reason `nav-items.ts` is: adding an option
 * must not mean touching a component. The values are the Zod enums from
 * `@sparksocial/shared` verbatim — if they drift, `genome.dimensions.set`
 * rejects the input, which is the correct failure and better than a UI that
 * offers a choice the tool will not accept.
 *
 * ── Why the wording is what it is ──────────────────────────────────────────
 *
 * Every label is phrased for a business owner, never in the engine's
 * vocabulary. Nobody knows what a "proof asset" is; everybody knows what they
 * can show someone. Invariant 5 says never branch on niche, and this is the
 * consumer-facing half of that rule: ask what is *true of them*, not what
 * category they fall in.
 */

export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

export interface Question {
  /** Matches the `genome.dimensions.set` input field exactly. */
  id: 'proof_asset' | 'capture_capability' | 'objective' | 'talent_availability';
  prompt: string;
  help?: string;
  multiple: boolean;
  choices: Choice[];
}

export const QUESTIONS: Question[] = [
  {
    id: 'proof_asset',
    prompt: 'What can you actually show someone?',
    help: 'Pick everything that is true. This decides what SPARK can make without asking you to perform.',
    multiple: true,
    choices: [
      { value: 'physical_craft', label: 'Work being done by hand', hint: 'A cut, a weld, a repair, a bake' },
      { value: 'finished_work', label: 'Finished results', hint: 'Before and after, a completed job' },
      { value: 'physical_product', label: 'A physical product', hint: 'Something you make or sell' },
      { value: 'product_ui', label: 'A screen or app', hint: 'Software, a dashboard, a tool' },
      { value: 'data_outcomes', label: 'Numbers and results', hint: 'Savings, growth, benchmarks' },
      { value: 'person', label: 'A person on camera', hint: 'Someone willing to be filmed and heard' },
    ],
  },
  {
    id: 'capture_capability',
    prompt: 'What could you film, realistically?',
    help: 'Be honest — a plan built on filming you cannot do is a plan that quietly stops.',
    multiple: true,
    choices: [
      { value: 'space', label: 'The place I work', hint: 'The shop, the studio, the site' },
      { value: 'work_artifacts', label: 'Things I am working on', hint: 'Tools, materials, work in progress' },
      { value: 'product', label: 'The product itself' },
      { value: 'screen', label: 'My screen', hint: 'A recording of software in use' },
      { value: 'nothing', label: 'Nothing — I would rather not film', hint: 'SPARK works from what you already have' },
    ],
  },
  {
    id: 'objective',
    prompt: 'What is this actually for?',
    help: 'One answer. Everything SPARK schedules is measured against it.',
    multiple: false,
    choices: [
      { value: 'bookings', label: 'More bookings' },
      { value: 'leads', label: 'More enquiries' },
      { value: 'sales', label: 'More sales' },
      { value: 'trials', label: 'More sign-ups or trials' },
      { value: 'audience', label: 'A bigger audience' },
      { value: 'hiring', label: 'Hiring' },
    ],
  },
  {
    id: 'talent_availability',
    prompt: 'Is anyone willing to be on camera?',
    /**
     * The consent question, and the reason it is asked plainly rather than
     * inferred. §10 makes avatars opt-in by proof asset, and
     * `genome.dimensions.set` derives `avatarEnabled` from *this* answer
     * combined with `person` — so onboarding never asks "do you want AI
     * avatars?", which is a question people say yes to without understanding.
     */
    help: 'This decides whether SPARK may ever use a synthetic presenter of you. It never assumes yes.',
    multiple: false,
    choices: [
      { value: 'yes_licensed', label: 'Yes, and they agree to a digital likeness', hint: 'Consent is recorded' },
      { value: 'yes_unlicensed', label: 'Yes, but only real footage', hint: 'No synthetic version of them' },
      { value: 'no', label: 'No one is going on camera' },
    ],
  },
];

/** Fields the inference pass could not evidence, mapped to the question that asks. */
export function questionsFor(unresolved: string[]): Question[] {
  const wanted = new Set(unresolved.map((u) => u.split('.').pop()));
  const asked = QUESTIONS.filter((q) => wanted.has(q.id));

  /**
   * All four when the crawl resolved everything.
   *
   * Confirming an inference costs one tap and is the difference between "SPARK
   * decided" and "you told it" — which is the difference that matters when the
   * content is wrong a month later. The alternative, skipping straight past a
   * confidently-inferred dimension, optimises away the only cheap moment to
   * catch it.
   */
  return asked.length > 0 ? asked : QUESTIONS;
}
