import Anthropic from '@anthropic-ai/sdk';
import { languageModelAvailable, modelClient } from './model-client.js';
import { ShapeMismatch, ToolError, callVendor, withShapeRetry } from '@sparksocial/shared';
import type { SiteWriter } from '@sparksocial/agency';

/**
 * `agency.site.generate`'s writer — the agency website's copy.
 *
 * Same arrangement as `hook-writer.ts` and `agency-identity-writer.ts`: a
 * forced tool call so the answer is fields, and the tool's Zod schema decides
 * whether they fit the page.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'record_site';
const MAX_TOKENS = 1500;

const SYSTEM =
  'You write the copy for a small social media agency\'s one-page website. Plain, specific and warm; ' +
  'short sentences. Describe what the agency does and for whom. Never invent clients, case studies, ' +
  'results, statistics, prices, awards or how long the agency has existed.';

const SCHEMA = {
  type: 'object' as const,
  properties: {
    headline: { type: 'string' as const, maxLength: 90 },
    subheadline: { type: 'string' as const, maxLength: 220 },
    services: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, maxLength: 50 },
          description: { type: 'string' as const, maxLength: 200 },
        },
        required: ['title', 'description'],
      },
    },
    about: { type: 'string' as const, maxLength: 900 },
    ctaLabel: { type: 'string' as const, maxLength: 30 },
    contactHeading: { type: 'string' as const, maxLength: 90 },
  },
  required: ['headline', 'subheadline', 'services', 'about', 'ctaLabel', 'contactHeading'],
};

export function createSiteWriter(opts: { anthropic?: Anthropic; model?: string } = {}): SiteWriter {
  const anthropic = opts.anthropic ?? modelClient();
  const model = opts.model ?? MODEL;

  return {
    async write({ prompt }) {
      return withShapeRetry(async () => {
        const response = await callVendor(
          'site writer',
          'SPARK could not write the website — the service that writes copy is not responding. ' +
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
                  description: 'Record the website copy.',
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
          const detail = new ToolError('UPSTREAM_FAILED', 'The site writer returned an unusable shape.', {
            stopReason: response.stop_reason,
          });
          throw response.stop_reason === 'max_tokens' ? detail : new ShapeMismatch(detail);
        }
        return block.input;
      });
    },
  };
}

/** The real writer with a model key; plain placeholder copy without one, obviously so. */
export function siteWriter(): SiteWriter {
  if (!languageModelAvailable()) {
    console.warn('[warn] No language model configured — agency websites get fixed placeholder copy.');
    return {
      async write() {
        return {
          headline: 'Social media that keeps your business busy',
          subheadline: 'Content, posting and replies, handled for you every week.',
          services: [
            { title: 'Content creation', description: 'Posts, reels and stories made for your audience.' },
            { title: 'Scheduling and posting', description: 'A steady calendar across every platform you use.' },
            { title: 'Community management', description: 'Comments and messages answered, leads passed to you.' },
          ],
          about: 'We are a small team that runs social media for businesses like yours.',
          ctaLabel: 'Book a call',
          contactHeading: 'Tell us about your business',
        };
      },
    };
  }
  return createSiteWriter();
}
