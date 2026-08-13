import Anthropic from '@anthropic-ai/sdk';
import { ToolError } from '@sparksocial/shared';
import { DraftCaptureBrief } from '@sparksocial/capture';
import type { BriefWriter } from '@sparksocial/capture';
import { envSet } from './env.js';

/**
 * Production capture-brief writer — engine spec §6.2.
 *
 * A brief is an instruction to a business owner holding a phone, in the ninety
 * seconds a week they have agreed to give us. §6.3's whole argument is that the
 * capture loop survives because the asks are *small and specific*: "the last
 * pass of the clippers, from the barber's left shoulder, no talking" is
 * filmable without thinking. "Film your process" is not, and gets ignored —
 * which ends the loop, which ends the product.
 *
 * The dev writer returned hand-written templates keyed on `playbook_id`. Those
 * are specific, and they say the same thing every week to every business, so
 * the fourth session asks a barber to film the same fade for the fourth time.
 *
 * ── Forced tool use, and the validator behind it ───────────────────────────
 *
 * Structured output via a single forced tool call, same as the genome
 * inference pass. `validateBrief` still runs afterwards and still rejects —
 * that is the point of the retry loop in `writer.ts`, and `feedback` carries
 * the previous attempt's specific reasons back in rather than regenerating
 * blind. The schema stops malformed output; the validator stops *vague* output,
 * and no schema can express "too vague to film".
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'record_brief';

const SYSTEM =
  'You write one capture brief: a single filmable instruction for a small-business owner with a ' +
  'phone and about ninety seconds.\n\n' +
  'Concrete beats complete. Every field must be something they can act on without interpreting it:\n' +
  '- subject: the exact moment or object, not the topic. "The last pass of the clippers", not "the haircut".\n' +
  '- framing: where the phone is and what fills the frame.\n' +
  '- motion: held still, or one specific movement. Never "some movement".\n' +
  '- audio: what should be audible, including "ambient only, no talking".\n' +
  '- lighting: the actual light source they already have.\n' +
  '- do_not: real mistakes to avoid for THIS shot.\n\n' +
  'Ground it in the brand: their space, their tools, their customers, the words they use. A brief ' +
  'that would suit any business in the category is a failed brief.\n\n' +
  'Never ask them to buy, rent, install or set up anything. They are filming what already happens.';

const SCHEMA = {
  type: 'object' as const,
  properties: {
    subject: { type: 'string', description: 'The exact moment or object. Concrete, not a topic.' },
    framing: { type: 'string', description: 'Camera position and what fills the frame.' },
    orientation: { type: 'string', enum: ['vertical', 'horizontal', 'square'] },
    duration_sec: { type: 'number', minimum: 1, maximum: 180 },
    motion: { type: 'string', description: 'Held still, or one specific movement.' },
    audio: { type: 'string', description: 'What should be audible. "Ambient only, no talking" is valid.' },
    lighting: { type: 'string', description: 'The light source they already have.' },
    /**
     * A newline-delimited string, not an array — deliberately different from
     * the domain type.
     *
     * `do_not: string[]` was declared and failed twice against
     * `claude-sonnet-5`: once collapsing a single item to a bare string, and
     * once leaking the model's own `<parameter name="item">` markup into the
     * text. Arrays of strings inside a tool call are simply less reliable than
     * one string, and the failure is silent — the brief looks fine until you
     * read the field.
     *
     * `DraftCaptureBrief.do_not` stays `string[]`; the wire shape the model
     * sees is the writer's business, and converting is one `split`.
     */
    do_not: {
      type: 'string',
      description:
        'Two to four real mistakes to avoid on THIS shot, one per line. Plain text, no bullets, no markup.',
    },
    estimated_effort_sec: {
      type: 'number',
      minimum: 1,
      maximum: 90,
      description:
        'Total time to set up and film. Must be at least duration_sec — filming takes longer than the clip.',
    },
  },
  required: [
    'subject', 'framing', 'orientation', 'duration_sec',
    'motion', 'audio', 'lighting', 'do_not', 'estimated_effort_sec',
  ],
};

export interface BriefWriterOptions {
  anthropic?: Anthropic;
  model?: string;
}

export function createBriefWriter(opts: BriefWriterOptions = {}): BriefWriter {
  const anthropic = opts.anthropic ?? new Anthropic();
  const model = opts.model ?? MODEL;

  return {
    async write({ playbook, genome, feedback }): Promise<DraftCaptureBrief> {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1_500,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt(playbook, genome, feedback) }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Record the capture brief.',
            input_schema: SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const block = response.content.find(
        (c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL_NAME,
      );
      if (!block) {
        throw new ToolError('UPSTREAM_FAILED', 'The brief writer returned no brief.', {
          stopReason: response.stop_reason,
        });
      }

      /**
       * Shape-check here; leave *judgement* to `writer.ts`.
       *
       * Those are different jobs and both are needed. `validateBrief` decides
       * whether a brief is too vague to film and owns the corrective retry —
       * duplicating that here would give two places an opinion about what a
       * good brief is. But a response whose `do_not` is a string rather than an
       * array is not a vague brief, it is a malformed one, and letting it
       * through produced `draft.do_not.filter is not a function` from inside
       * the validator: a TypeError blamed on the caller, three layers from the
       * model that caused it.
       *
       * A forced tool call makes this rare, not impossible — `input_schema` is
       * guidance to the model, not a guarantee from the API.
       */
      const parsed = DraftCaptureBrief.safeParse({
        ...normalise(block.input as Record<string, unknown>),
        playbook_id: playbook.playbook_id,
      });

      if (!parsed.success) {
        throw new ToolError('UPSTREAM_FAILED', 'The brief writer returned an unusable shape.', {
          issues: parsed.error.issues.slice(0, 5),
        });
      }

      return parsed.data;
    },
  };
}

/**
 * Repair the one shape the model reliably gets wrong.
 *
 * Observed against `claude-sonnet-5` with `type: 'array'` declared: a `do_not`
 * with a single entry comes back as a bare string rather than a one-element
 * array. `input_schema` is guidance to the model, not a guarantee from the API,
 * and this is the specific way that shows up here.
 *
 * Narrow on purpose. A string where an array of strings is expected has exactly
 * one sensible reading, so normalising it loses nothing — whereas coercion that
 * *guesses* would hide genuine malformation from the check below. Everything
 * else is left alone and rejected if wrong.
 */
function normalise(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.do_not;

  // The declared shape: one string, split on lines.
  if (typeof raw === 'string') return { ...input, do_not: splitLines(raw) };

  // Still accepted, because a model that returns the array anyway is not wrong
  // — it is just not what was asked for.
  if (Array.isArray(raw)) {
    return { ...input, do_not: raw.flatMap((v) => (typeof v === 'string' ? splitLines(v) : [])) };
  }

  return input;
}

/**
 * One constraint per line, stripped of the decoration models add unprompted.
 *
 * The markup strip is not defensive dressing: a real response contained a
 * literal `<parameter name="item">` prefix, which would have been stored as
 * part of the constraint and shown to a business owner as part of their
 * filming instructions.
 */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/<\/?[^>]+>/g, '').replace(/^\s*[-*•]\s*/, '').trim())
    .filter((line) => line.length >= 4);
}

/**
 * The prompt.
 *
 * Genome fields are interpolated directly rather than fenced as untrusted:
 * unlike a crawled page, the genome is *our* record, already confirmed by the
 * owner through onboarding's chip review. The untrusted material that fed it
 * was contained at `genome.bootstrap_from_url`, which is where containment
 * belongs — re-fencing derived, human-approved data would make the boundary
 * meaningless by putting it everywhere.
 */
function prompt(
  playbook: { playbook_id: string; name?: string; beats?: unknown; duration_sec_range?: [number, number] },
  genome: {
    identity: { business_name: string; category: string; one_liner: string };
    dimensions?: { capture_capability?: string[]; proof_asset?: string[] };
    voice?: { tone_vector?: Record<string, number> };
  },
  feedback?: string[],
): string {
  const bounds = playbook.duration_sec_range;

  return [
    `Business: ${genome.identity.business_name} — ${genome.identity.category}`,
    `What they do: ${genome.identity.one_liner}`,
    genome.dimensions?.capture_capability?.length
      ? `They can film: ${genome.dimensions.capture_capability.join(', ')}`
      : '',
    genome.dimensions?.proof_asset?.length
      ? `What they can visibly prove: ${genome.dimensions.proof_asset.join(', ')}`
      : '',
    '',
    `Playbook: ${playbook.name ?? playbook.playbook_id}`,
    playbook.beats ? `Beats to cover: ${JSON.stringify(playbook.beats)}` : '',
    bounds ? `Duration must be between ${bounds[0]} and ${bounds[1]} seconds.` : '',
    '',
    // The retry's whole value: naming what failed so the next attempt fixes
    // that rather than rolling the dice again.
    feedback?.length
      ? `Your previous attempt was rejected:\n${feedback.map((f) => `- ${f}`).join('\n')}\n\nFix exactly these.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The real writer when a key is present, the templates otherwise.
 *
 * The fallback is usable rather than broken — the templates clear
 * `validateBrief` on the first attempt for every `direct_finish` playbook — so
 * the warning is about *sameness*, not failure: every brand gets identical
 * briefs, week after week.
 */
export function briefWriter(fallback: BriefWriter): BriefWriter {
  if (!envSet('ANTHROPIC_API_KEY')) {
    console.warn(
      '[warn] ANTHROPIC_API_KEY unset — capture briefs come from fixed templates. Every brand receives ' +
        'the same brief for a given playbook, every week.',
    );
    return fallback;
  }
  return createBriefWriter();
}
