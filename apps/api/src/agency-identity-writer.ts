import Anthropic from '@anthropic-ai/sdk';
import { languageModelAvailable, modelClient } from './model-client.js';
import { ShapeMismatch, ToolError, callVendor, withShapeRetry } from '@sparksocial/shared';
import type { AgencyIdentityWriter } from '@sparksocial/agency';

/**
 * `agency.identity.generate`'s writer — the Agency Portal wizard's two
 * "Generate With Ai" buttons.
 *
 * Same shape as `hook-writer.ts`: Sonnet with a forced tool call, so the answer
 * is fields rather than prose to parse. The tool validates what comes back (a
 * tone from its list, colours as hex) — this only has to return the shape.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'record_agency';
const MAX_TOKENS = 400;

const SYSTEM =
  'You help someone set up a small social media agency. You suggest a name, a tagline, a tone and brand ' +
  'colours. Keep names short and easy to say. Keep taglines plain and specific about what the agency ' +
  'does. Never invent clients, results, prices or awards.';

const SCHEMAS = {
  identity: {
    type: 'object' as const,
    properties: {
      name: { type: 'string' as const, maxLength: 60, description: 'Only when asked for a name.' },
      tagline: { type: 'string' as const, maxLength: 120 },
    },
    required: ['tagline'],
  },
  theme: {
    type: 'object' as const,
    properties: {
      tone: { type: 'string' as const },
      colors: {
        type: 'array' as const,
        items: { type: 'string' as const, description: 'A six-digit hex colour such as #3157D6.' },
      },
    },
    required: ['tone', 'colors'],
  },
};

export function createAgencyIdentityWriter(opts: { anthropic?: Anthropic; model?: string } = {}): AgencyIdentityWriter {
  const anthropic = opts.anthropic ?? modelClient();
  const model = opts.model ?? MODEL;

  return {
    async write(args) {
      return withShapeRetry(() => attempt(args));
    },
  };

  async function attempt({ part, prompt }: { part: 'identity' | 'theme'; prompt: string }) {
    const response = await callVendor(
      'agency identity writer',
      'SPARK could not come up with a suggestion — the service that writes copy is not responding. ' +
        'Nothing was changed, so trying again is safe.',
      () =>
        anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM,
          messages: [{ role: 'user', content: prompt }],
          tools: [
            {
              name: TOOL_NAME,
              description: part === 'identity' ? 'Record the suggested name and tagline.' : 'Record the tone and colours.',
              input_schema: SCHEMAS[part] as unknown as Anthropic.Messages.Tool.InputSchema,
            },
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        }),
    );

    const block = response.content.find(
      (c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL_NAME,
    );
    if (!block) {
      const detail = new ToolError('UPSTREAM_FAILED', 'The agency identity writer returned an unusable shape.', {
        stopReason: response.stop_reason,
      });
      throw response.stop_reason === 'max_tokens' ? detail : new ShapeMismatch(detail);
    }
    const out = block.input as { name?: unknown; tagline?: unknown; tone?: unknown; colors?: unknown };
    return {
      ...(typeof out.name === 'string' ? { name: out.name } : {}),
      ...(typeof out.tagline === 'string' ? { tagline: out.tagline } : {}),
      ...(typeof out.tone === 'string' ? { tone: out.tone } : {}),
      ...(Array.isArray(out.colors) ? { colors: out.colors.filter((c): c is string => typeof c === 'string') } : {}),
    };
  }
}

/**
 * The real writer when a model key is present, a fixed stand-in otherwise —
 * same arrangement as `hookWriter()`. The stand-in is obviously a template, so
 * the wizard stays walkable with no key without passing it off as judgment.
 */
export function agencyIdentityWriter(): AgencyIdentityWriter {
  if (!languageModelAvailable()) {
    console.warn('[warn] No language model configured — agency identity suggestions come from a fixed template.');
    return {
      async write({ part }) {
        return part === 'identity'
          ? { name: 'Northside Social', tagline: 'Social media that keeps local businesses busy.' }
          : { tone: 'Friendly', colors: ['#3157D6', '#A341FF', '#93E1F2'] };
      },
    };
  }
  return createAgencyIdentityWriter();
}
