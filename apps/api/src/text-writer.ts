import Anthropic from '@anthropic-ai/sdk';
import { languageModelAvailable, modelClient } from './model-client.js';
import { ToolError, callVendor } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { Playbook } from '@sparksocial/playbooks';
import type { BeatOutlineEntry, TextWriter } from '@sparksocial/generate';

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

/**
 * -- Why the length instruction changed ------------------------------------
 *
 * This opened "a single hook, caption line, CTA, script beat, or slide of
 * text. Not a whole post". The second sentence is still true and
 * load-bearing -- the product regenerates one beat at a time -- but "a single
 * ... line" was read as a length instruction, and the model obeyed it
 * everywhere. A 30-second narration beat came back at 41 words, about half of
 * what fits in 30 seconds, and a whole Voice-over B-roll post was 55.
 * `pb_text_update`, whose one beat is the entire LinkedIn caption, produced 19.
 *
 * The scope of a beat and the length of a beat are different things, and the
 * prompt now says so: one beat, at the length its slot actually needs. That
 * length is computed per call, from the beat's own duration and the platform
 * it is bound for -- see `beatBudget`.
 */
const SYSTEM =
  'You write one beat of social copy for a small or mid-size business: one hook, caption, CTA, ' +
  "script beat, or slide. Exactly the one beat you're asked for and nothing else -- not the whole post, " +
  'not a title, not commentary. Write it at the length you are told to and fill that slot properly; a ' +
  'beat much shorter than its budget wastes the space it was given.\n\n' +
  'Return the beat text only. No surrounding quotation marks, no label, no markdown heading, and no ' +
  "emoji unless the brand's own tone clearly calls for it.\n\n" +
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
  // `modelClient()` rather than a bare `new Anthropic()`: same primary vendor,
  // with a one-shot retry on the OpenAI fallback when the account behind the
  // key cannot serve the call. See `model-client.ts` for why that decision
  // has to be made per call rather than at configuration time.
  const anthropic = opts.anthropic ?? modelClient();
  const model = opts.model ?? MODEL;

  return {
    async write({ genome, playbook, promptRef, intent, beatId, durationSec, outline }): Promise<string> {
      const response = await callVendor(
        'copy writer',
        'SPARK could not write this post — the service that writes copy is not responding. Nothing was saved, so trying again is safe.',
        () =>
          anthropic.messages.create({
            model,
            max_tokens: 500,
            system: SYSTEM,
            messages: [{ role: 'user', content: prompt(genome, playbook, promptRef, intent, { beatId, durationSec, outline }) }],
            tools: [
              {
                name: TOOL_NAME,
                description: 'Record the written beat.',
                input_schema: SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
              },
            ],
            tool_choice: { type: 'tool', name: TOOL_NAME },
          }),
      );

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

      /**
       * The literal CTA, if a later beat carries one, so a trailing duplicate
       * can be removed rather than merely discouraged. Instruction adherence
       * varies by model — and with the OpenAI fallback in play, a beat may be
       * written by a different vendor than the prompt was tuned against.
       */
      const laterCta = outline.find((o) => o.beatId !== beatId && o.kind === 'literal' && o.text)?.text;
      return tidy(text, laterCta);
    },
  };
}

/**
 * Strips the packaging a model puts around a quoted line.
 *
 * Observed repeatedly: beats came back as `"Fresh cuts, fresh perspectives."`,
 * quotation marks included, and a beat is rendered verbatim -- into a caption,
 * or as type burned onto an image by Satori. The marks appeared in the post.
 *
 * Deliberately narrow. Only a matching pair wrapping the *entire* beat is
 * removed, so a beat that legitimately quotes a customer mid-sentence keeps its
 * punctuation. The system prompt also asks for no wrapping quotes; this is the
 * belt to that braces, because a rendered image cannot be corrected after the
 * fact the way a caption can.
 */
function tidy(text: string, laterCta?: string): string {
  let out = text.trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];
  for (const [open, close] of pairs) {
    if (out.length > 2 && out.startsWith(open) && out.endsWith(close) && !out.slice(1, -1).includes(close)) {
      out = out.slice(1, -1).trim();
      break;
    }
  }
  /**
   * Drop a closing sentence that just restates the CTA beat.
   *
   * Only the final sentence, and only when it *is* the CTA rather than merely
   * containing those words, so a body that legitimately mentions booking
   * mid-paragraph is untouched. The post already ends on the real CTA beat; this
   * removes the stutter, not the ask.
   */
  if (laterCta) {
    const cta = laterCta.trim().toLowerCase();
    const sentences = out.split(/(?<=[.!?])\s+/);
    const last = sentences[sentences.length - 1]?.replace(/[.!?\s]+$/, '').trim().toLowerCase();
    if (sentences.length > 1 && last && (last === cta || last.endsWith(cta))) {
      out = sentences.slice(0, -1).join(' ').trim();
    }
  }

  return out;
}

/**
 * Genome fields are interpolated directly, same rule and same reasoning as
 * `brief-writer.ts`'s prompt: this is our own record, already confirmed by
 * the owner through onboarding, not untrusted crawled material.
 */
/** Narration words per second of screen time, at an unhurried speaking pace. */
const WORDS_PER_SEC = 2.5;

/**
 * Per-platform caption budgets, in words, for a beat that *is* the whole caption.
 *
 * Only consulted for a beat with no duration, where nothing else says how long
 * to write. The numbers are the platform's own norms rather than its hard
 * limits: X's cap is 280 characters, but a 45-word post reads as a post and a
 * 12-word one reads as a placeholder, which is what the product was shipping.
 */
const CAPTION_WORDS: Record<string, [number, number]> = {
  linkedin: [90, 160],
  x: [25, 45],
  instagram: [50, 110],
  instagram_story: [8, 18],
  facebook: [50, 110],
  facebook_group: [60, 130],
  threads: [25, 60],
  tiktok: [15, 35],
  youtube_shorts: [15, 35],
  youtube_long: [70, 140],
  pinterest: [20, 45],
  google_business: [40, 90],
  reddit: [90, 200],
  bluesky: [25, 50],
};

/** A still or overlay carries a line, not a paragraph, however long the post is. */
const OVERLAY_WORDS: [number, number] = [6, 16];

/**
 * How long this beat should be, and why.
 *
 * Three cases, in order of how much the data actually tells us:
 *
 *   1. The beat has screen time. Narration length follows from duration, full
 *      stop -- a 3-second hook is about 8 words and a 30-second body about 75.
 *      Getting this from `duration_sec` is what stops the writer producing the
 *      same single line for both, which is exactly what it used to do.
 *   2. No duration, and the beat is the post's whole caption (`media_type`
 *      `text`). Then the platform decides, because a LinkedIn post and an X
 *      post are different lengths of writing.
 *   3. No duration, and the post is an image or carousel. The beat is type set
 *      *on* the picture, so it stays short no matter the platform.
 *
 * The narrowest platform wins when a playbook targets several: copy that fits X
 * can be posted to LinkedIn, and the reverse gets truncated by the platform.
 */
function beatBudget(playbook: Playbook, durationSec: number): { min: number; max: number; why: string } {
  if (durationSec > 0) {
    const mid = Math.round(durationSec * WORDS_PER_SEC);
    return {
      min: Math.max(4, Math.round(mid * 0.8)),
      max: Math.round(mid * 1.2),
      why: `${durationSec}s of narration at a natural speaking pace`,
    };
  }

  if (playbook.output.media_type !== 'text') {
    return { min: OVERLAY_WORDS[0], max: OVERLAY_WORDS[1], why: 'text set on an image, so it has to stay readable at a glance' };
  }

  const budgets = playbook.output.platforms.map((pf) => CAPTION_WORDS[pf]).filter((b): b is [number, number] => Boolean(b));
  if (budgets.length === 0) return { min: 40, max: 90, why: 'a standalone caption' };

  // Narrowest ceiling across the platforms this playbook publishes to.
  const tightest = budgets.reduce((a, b) => (b[1] < a[1] ? b : a));
  return {
    min: tightest[0],
    max: tightest[1],
    why: `the whole caption, sized for ${playbook.output.platforms.join(' / ')}`,
  };
}

function prompt(
  genome: Genome,
  playbook: Playbook,
  promptRef: string,
  intent: string | undefined,
  beat: { beatId: string; durationSec: number; outline: BeatOutlineEntry[] },
): string {
  const { identity, voice, audience, offer } = genome;
  const budget = beatBudget(playbook, beat.durationSec);

  /**
   * What the rest of the post covers, so this beat does not cover it again.
   *
   * Without it the 30-second body of a Voice-over B-roll ended "Book a chair
   * today and see the difference at Northside Barbers" while the very next beat
   * was the CTA, "Book a chair" -- the post asked twice because each beat was
   * written as though it were alone. A literal beat's exact wording is included,
   * since that is what has to be avoided rather than merely its existence.
   */
  const others = beat.outline.filter((o) => o.beatId !== beat.beatId);
  const ctaHandled = others.some((o) => o.kind === 'literal' && Boolean(o.text));

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
    /**
     * Withheld when a later beat carries it.
     *
     * The prompt used to state the CTA *and* forbid writing one, which is a
     * contradiction the model resolves by ignoring one half. Observed on a real
     * draft: a 30-second body ended "Book a chair." with the very next beat
     * reading "Book a chair". Naming a thing and banning it in the same breath is
     * a prompt bug, not a model failure.
     */
    offer?.primary_cta && !ctaHandled ? `Primary call to action: ${offer.primary_cta}` : '',
    '',
    `Playbook: ${playbook.name} — ${playbook.description}`,
    `Publishing to: ${playbook.output.platforms.join(', ')} as ${playbook.output.media_type}`,
    '',
    `Beat to write: ${promptRef} (the "${beat.beatId}" beat)`,
    `Length: ${budget.min}-${budget.max} words (${budget.why}). Use the range; do not come in far under it.`,
    others.length
      ? 'The rest of this post, which you must not duplicate:\n' +
        others
          .map((o) =>
            o.kind === 'literal'
              ? `  - ${o.beatId}: fixed text, reads "${o.text ?? '(supplied at render time)'}"`
              : `  - ${o.beatId}: ${o.promptRef ?? 'copy'}`,
          )
          .join('\n')
      : '',
    ctaHandled
      ? 'A later beat already carries the call to action. Do not write one, and do not end on an ' +
        'invitation to book, buy or get in touch.'
      : '',
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
  if (!languageModelAvailable()) {
    console.warn(
      '[warn] No language model configured (ANTHROPIC_API_KEY or OPENAI_API_KEY) — drafted copy comes from fixed templates. Every brand receives the ' +
        'same line for a given beat category, every time.',
    );
    return fallback;
  }
  return createTextWriter();
}
