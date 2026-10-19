import { describe, expect, it, vi } from 'vitest';
import { untrusted } from '@sparksocial/shared/types';
import { inferGenome } from '../src/infer.js';

/**
 * A malformed inference gets a second draw.
 *
 * ── The failure this reproduces ──────────────────────────────────────────
 *
 * Observed live against clientforce.io. The model answered the forced tool
 * call with its own tool-call markup as a *string*:
 *
 *     { identity: '\n<parameter name="businessName">clientforce.io',
 *       category: '<UNKNOWN>', geography: { … }, languages: ['en'] }
 *
 * — `identity` a string rather than an object, and its fields hoisted to the
 * top level. `InferenceResponse` rejected it, correctly, and the owner was
 * shown "The inference pass returned an unusable shape".
 *
 * The defect was not the rejection. It was that nothing retried: the client's
 * own `withShapeRetry` only checks that a `tool_use` block came back, and
 * returns its contents unread, so the schema check that matters sat outside
 * every retry loop and one bad draw ended onboarding.
 */

const logger = { info: () => {}, warn: () => {}, error: () => {} };
const corpus = [untrusted('a barbershop in Lagos', 'crawl:page0')];

const good = {
  identity: {
    businessName: 'Emeka Cuts',
    category: 'barbershop',
    oneLiner: 'A barbershop in Lagos',
    geography: { scope: 'local', locale: 'en-NG', radiusKm: 10 },
    languages: ['en'],
    priceTier: 'mid',
  },
  dimensions: { proof_asset: ['physical_craft'] },
  voice: {},
  chips: [],
};

/** The exact shape the live model returned. */
const malformed = {
  identity: '\n<parameter name="businessName">clientforce.io',
  category: '<UNKNOWN>',
  geography: { scope: 'global', locale: 'en-US', radiusKm: null },
  languages: ['en'],
  priceTier: 'mid',
};

describe('a bad draw does not end the crawl', () => {
  it('retries once and succeeds on the second answer', async () => {
    const infer = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(good);

    const out = await inferGenome({ corpus, sourceUrl: 'https://x.test', logger }, { infer });

    expect(infer).toHaveBeenCalledTimes(2);
    expect(out.identity.businessName).toBe('Emeka Cuts');
  });

  /*
   * Two attempts, not a grind. A second malformed answer is signal about the
   * vendor or the corpus, and the owner is better served by the manual path
   * than by a spinner that keeps paying for the same coin-flip.
   */
  it('gives up after two and surfaces the precise error', async () => {
    const infer = vi.fn<() => Promise<unknown>>().mockResolvedValue(malformed);

    await expect(
      inferGenome({ corpus, sourceUrl: 'https://x.test', logger }, { infer }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });

    expect(infer).toHaveBeenCalledTimes(2);
  });

  it('does not retry a corpus that was empty to begin with — nothing would change', async () => {
    const infer = vi.fn<() => Promise<unknown>>().mockResolvedValue(good);

    await expect(
      inferGenome({ corpus: [], sourceUrl: 'https://x.test', logger }, { infer }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });

    expect(infer).not.toHaveBeenCalled();
  });

  it('logs which fields were rejected, since the issues never reach the browser', async () => {
    const warn = vi.fn();
    const infer = vi.fn<() => Promise<unknown>>().mockResolvedValue(malformed);

    await inferGenome(
      { corpus, sourceUrl: 'https://x.test', logger: { ...logger, warn } },
      { infer },
    ).catch(() => {});

    expect(warn).toHaveBeenCalledWith('inference shape rejected', expect.objectContaining({
      paths: expect.arrayContaining(['identity']),
    }));
  });

  it('does not log the offending values — they are model output from an untrusted page', async () => {
    const warn = vi.fn();
    const infer = vi.fn<() => Promise<unknown>>().mockResolvedValue(malformed);

    await inferGenome(
      { corpus, sourceUrl: 'https://x.test', logger: { ...logger, warn } },
      { infer },
    ).catch(() => {});

    expect(JSON.stringify(warn.mock.calls)).not.toContain('clientforce.io');
  });
});
