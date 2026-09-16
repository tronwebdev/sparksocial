import { afterEach, describe, expect, it } from 'vitest';
import { openAIMessages } from '../src/openaiMessages.js';

/**
 * Resolving the OpenAI fallback from the environment.
 *
 * Every case here is the same bug `apps/api/src/env.ts` documents and this file
 * was missing: `??` falls through only on *unset*, while `.env.example` ships
 * optional keys as `KEY=` and `--env-file` turns those into `''`. An empty
 * `OPENAI_FALLBACK_API_KEY` line therefore stopped the chain before
 * `OPENAI_API_KEY` was ever consulted, and the deployment had no fallback while
 * holding a perfectly good key for one.
 *
 * It failed silently, and it failed at the worst possible moment — the day the
 * primary vendor returned `organization_on_hold`, which is precisely when a
 * fallback is the thing being relied on.
 */

const KEYS = [
  'OPENAI_FALLBACK_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_FALLBACK_BASE_URL',
  'OPENAI_FALLBACK_MODEL',
] as const;

const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

function setEnv(envs: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envs)) process.env[k] = v;
}

describe('openAIMessages — resolving the fallback', () => {
  it('uses OPENAI_API_KEY when no dedicated fallback key is set', () => {
    setEnv({ OPENAI_API_KEY: 'sk-real' });
    expect(openAIMessages()).not.toBeNull();
  });

  it('still uses OPENAI_API_KEY when the fallback key is present but EMPTY', () => {
    // The regression. `??` treats '' as a value, so this returned null and the
    // product ran with no fallback at all.
    setEnv({ OPENAI_API_KEY: 'sk-real', OPENAI_FALLBACK_API_KEY: '' });
    expect(openAIMessages()).not.toBeNull();
  });

  it('treats whitespace as empty too', () => {
    setEnv({ OPENAI_API_KEY: 'sk-real', OPENAI_FALLBACK_API_KEY: '   ' });
    expect(openAIMessages()).not.toBeNull();
  });

  it('prefers the dedicated fallback key when it has a real value', () => {
    // Its whole purpose is spending from a different account than embeddings.
    setEnv({ OPENAI_API_KEY: 'sk-a', OPENAI_FALLBACK_API_KEY: 'sk-b' });
    expect(openAIMessages({ fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch })).not.toBeNull();
  });

  it('returns null when there is genuinely no key', () => {
    // Null is the honest answer, and what makes the boot banner say "no
    // fallback" truthfully rather than by accident.
    setEnv({});
    expect(openAIMessages()).toBeNull();
  });

  it('returns null when every candidate is empty rather than unset', () => {
    setEnv({ OPENAI_API_KEY: '', OPENAI_FALLBACK_API_KEY: '' });
    expect(openAIMessages()).toBeNull();
  });

  it('an empty base URL does not override the default', () => {
    /*
     * Worse than the key case, and silent in a different way: `''` would have
     * been used as the base URL, sending every request to a relative path.
     */
    setEnv({ OPENAI_API_KEY: 'sk-real', OPENAI_FALLBACK_BASE_URL: '' });
    let called = '';
    const client = openAIMessages({
      fetchImpl: (async (url: string) => {
        called = String(url);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });
    expect(client).not.toBeNull();
    return client!.messages
      .create({ model: 'x', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] } as never)
      .then(() => {
        expect(called).toMatch(/^https:\/\/api\.openai\.com\/v1\//);
      });
  });
});
