import Anthropic from '@anthropic-ai/sdk';
import { openAIMessages, type MessagesClient } from './openai-messages.js';
import { envSet } from './env.js';

/**
 * The client every Anthropic-backed module gets: primary vendor, with a
 * second-vendor retry when the first cannot serve the call.
 *
 * ── Why the fallback is on failure, not on configuration ──────────────────
 *
 * The obvious design is "use Anthropic if `ANTHROPIC_API_KEY` is set, else
 * OpenAI". It would not have helped in the case that motivated this: the key
 * was present and valid-looking, and the *organisation behind it* was disabled.
 * Every call returned
 *
 *   400 {"error":{"message":"This organization has been disabled."}}
 *
 * so a config-time choice picked the broken vendor every time. A configured
 * vendor and a working vendor are different things, and only the call knows
 * which one it got.
 *
 * ── Why it retries on any error ───────────────────────────────────────────
 *
 * The first version of this switched only on statuses that clearly mean "this
 * account cannot serve you" — 401, 403, 429, 5xx. The disabled-organisation
 * error is a **400**, indistinguishable by status from a genuinely malformed
 * request, so that version did not fire on the one case it existed for.
 *
 * So it retries once on anything the primary throws. The cost of an unnecessary
 * retry is one extra call on a request that had already failed; the cost of not
 * retrying is a dead product. A malformed request fails on the fallback too,
 * and the error the caller sees is the fallback's — which is the honest one,
 * since that is the attempt that finished last.
 */

export interface ModelClientOptions {
  primary?: MessagesClient;
  fallback?: MessagesClient | null;
  /** Injected for tests; defaults to `console.warn`. */
  warn?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * Whether a fallback exists at all, for the startup banner.
 *
 * Worth printing: a silent fallback means a deploy can be quietly writing every
 * post with the substitute model and reading the same as healthy.
 */
export function fallbackConfigured(): boolean {
  return openAIMessages() !== null;
}

export function modelClient(opts: ModelClientOptions = {}): Anthropic {
  const primary = opts.primary ?? (new Anthropic() as unknown as MessagesClient);
  const fallback = opts.fallback === undefined ? openAIMessages() : opts.fallback;
  const warn = opts.warn ?? ((m, meta) => console.warn(m, meta));

  if (!fallback) return primary as unknown as Anthropic;

  return {
    ...primary,
    messages: {
      ...primary.messages,
      async create(body: Parameters<MessagesClient['messages']['create']>[0]) {
        try {
          return await primary.messages.create(body);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          /**
           * Loud, and once per call rather than once per process: which vendor
           * wrote a given post is the first question when copy quality changes
           * unexpectedly, and `tool_calls` does not record it.
           */
          warn('[warn] primary model vendor failed — retrying on the OpenAI fallback', {
            model: body.model,
            detail: detail.slice(0, 300),
          });
          return await fallback.messages.create(body);
        }
      },
    },
  } as unknown as Anthropic;
}

/** Printed at boot so a running instance says which vendors it can actually reach. */
export function describeModelVendors(): string {
  const primary = envSet('ANTHROPIC_API_KEY') ? 'anthropic' : 'anthropic (no key)';
  return fallbackConfigured() ? `${primary}, falling back to openai` : `${primary}, no fallback`;
}

/**
 * Whether *some* vendor can serve a language call.
 *
 * The six client factories each gated on `ANTHROPIC_API_KEY` alone and fell back
 * to a fixed-template stub without it. With a second vendor wired that test
 * became wrong in the expensive direction: an instance with a working OpenAI key
 * and no Anthropic key would quietly hand every brand the same templated line,
 * having had a real writer available the whole time.
 */
export function languageModelAvailable(): boolean {
  return envSet('ANTHROPIC_API_KEY') || envSet('ANTHROPIC_AUTH_TOKEN') || fallbackConfigured();
}
