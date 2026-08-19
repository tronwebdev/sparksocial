import Anthropic from '@anthropic-ai/sdk';
import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { Playbook } from '@sparksocial/playbooks';
import type { TextWriter } from '@sparksocial/generate';
import { envSet } from './env.js';

/**
 * Production copy writer for `content.draft` — the sibling of
 * `brief-writer.ts`, one prompt call per beat instead of one call per whole
 * brief.
 *
 * ── Why one beat at a time, not the whole post in one call ─────────────────
 *
 * A single call producing every beat at once is cheaper (one round trip) and
 * was the first design here. It was dropped: `content.draft` regenerates one
 * beat via `beatId` when a user asks for "just a better hook", and a writer
 * that only knows how to produce a *whole post* has nothing to give that
 * request without also rewriting everything the user already approved.
 * Per-beat calls cost more in aggregate and are the shape the product
 * actually needs.
 *
 * ── The `prompt_ref` naming convention, not a per-key lookup table ─────────
 *
 * `Beat.prompt_ref` values (`hook.craft`, `proof.data_points`, `offer.scarcity`
 * …) were introduced with no library behind them — this is that library, and
 * it is deliberately *not* a switch statement keyed on every string a
 * playbook record happens to use. CLAUDE.md invariant 5: a new playbook must
 * never need a code change to be writable. Instead the model is taught the
 * naming convention itself (`category.subtype`) and generalises — a future
 * `prompt_ref: 'urgency.deadline'` this file has never seen still resolves to
 * "an urgency-flavoured beat, subtype deadline" without editing this file.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'record_copy';

const SYSTEM =
  'You write one beat of social copy for a small or mid-size business — a single hook, caption line, CTA, ' +
  "script beat, or slide of text. Not a whole post: exactly the one beat you're asked for.\n\n" +
  "The beat is named by a `category.subtype` key, e.g. `hook.craft` (an opening line about the brand's " +
  'craft/skill) or `proof.data_points` (a line stating real evidence/numbers). Read the category as the ' +
  "kind of beat and the subtype as its angle — you will see keys you haven't seen named here; generalise " +
  'from the pattern rather than asking what they mean.\n\n' +
  'Ground every word in the brand actually given to you: their name, category, one-liner, tone, audience, ' +
  "and offer. Text that would suit any business in the category is a failed beat. Match the brand's " +
  'reading level and never use a banned phrase.\n\n' +
  'Never invent a statistic, claim, or detail not present in what you were given. A beat that needs a ' +
  'real number the brief did not supply should describe the *shape* of the claim, not fabricate the figure.';

const SCHEMA = {
  type: 'object' as const,
  properties: {
    text: { type: 'string', description: 'The beat, ready to publish as-is.' },
  },
  required: ['text'],
};

export interface TextWriterOptions {
  anthropic?: Anthropic;
  model?: string;
}

export function createTextWriter(opts: TextWriterOptions = {}): TextWriter {
  const anthropic = opts.anthropic ?? new Anthropic();
  const model = opts.model ?? MODEL;

  return {
    async write({ genome, playbook, promptRef, intent }): Promise<string> {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt(genome, playbook, promptRef, intent) }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Record the written beat.',
            input_schema: SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const block = response.content.find(
        (c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL_NAME,
      );
      if (!block) {
        throw new ToolError('UPSTREAM_FAILED', 'The copy writer returned no text.', {
          stopReason: response.stop_reason,
        });
      }

      const text = (block.input as Record<string, unknown>).text;
      if (typeof text !== 'string' || !text.trim()) {
        throw new ToolError('UPSTREAM_FAILED', 'The copy writer returned an unusable shape.', { promptRef });
      }

      return text.trim();
    },
  };
}

/**
 * Genome fields are interpolated directly, same rule and same reasoning as
 * `brief-writer.ts`'s prompt: this is our own record, already confirmed by
 * the owner through onboarding, not untrusted crawled material.
 */
function prompt(genome: Genome, playbook: Playbook, promptRef: string, intent?: string): string {
  const { identity, voice, audience, offer } = genome;

  return [
    `Business: ${identity.business_name} — ${identity.category}`,
    `What they do: ${identity.one_liner}`,
    `Price tier: ${identity.price_tier}`,
    voice.tone_vector
      ? `Tone (0-1 each): formal ${voice.tone_vector.formal}, playful ${voice.tone_vector.playful}, ` +
        `technical ${voice.tone_vector.technical}, bold ${voice.tone_vector.bold}`
      : '',
    voice.pov_statements?.length ? `Points of view the brand holds: ${voice.pov_statements.join('; ')}` : '',
    voice.banned_phrases?.length ? `Never use: ${voice.banned_phrases.join(', ')}` : '',
    `Reading level: grade ${voice.reading_level}`,
    audience?.segments?.length
      ? `Audience: ${audience.segments.map((s) => s.label).join(', ')}`
      : '',
    offer?.primary_cta ? `Primary call to action: ${offer.primary_cta}` : '',
    '',
    `Playbook: ${playbook.name} — ${playbook.description}`,
    `Beat to write: ${promptRef}`,
    intent ? `What this specific post is about: ${intent}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The real writer when a key is present, a deterministic template otherwise.
 *
 * Same shape as `briefWriter()`: the fallback is usable, just uniform — every
 * brand gets the same generic line for a given `prompt_ref` category, every
 * time, rather than a broken tool.
 */
export function textWriter(fallback: TextWriter): TextWriter {
  if (!envSet('ANTHROPIC_API_KEY')) {
    console.warn(
      '[warn] ANTHROPIC_API_KEY unset — drafted copy comes from fixed templates. Every brand receives the ' +
        'same line for a given beat category, every time.',
    );
    return fallback;
  }
  return createTextWriter();
}
