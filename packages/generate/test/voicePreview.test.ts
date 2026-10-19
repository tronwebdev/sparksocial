import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { makeVoicePreview, VoicePreviewInput } from '../src/voicePreview.js';

/**
 * `voice.preview` — speak a short line in the brand's registered voice.
 *
 * Two properties carry the weight. The character ceiling is the only thing
 * bounding spend on a tool reachable from onboarding, before a brand has done
 * anything; and the voice it picks has to be the voice the brand would
 * actually be narrated in.
 *
 * That second one is a behaviour change. This used to refuse when the genome
 * had no clone — "This brand has no voice yet… or paste an existing voice id",
 * naming a control that exists on no screen. It was also the wrong model of
 * the product: a brand without a clone is not voiceless, it has the stock
 * voice, and `content.voice.generate` has always fallen back to one. A preview
 * that cannot play the voice you would actually get previews nothing.
 */

function ctx(
  constraints: Record<string, unknown> = { elevenlabs_voice_id: 'voice_1' },
  governance: Record<string, unknown> = {},
): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    brandId: 'brand_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        get: async (id: string) => ({ id, identity: {}, constraints }),
      },
      brands: {
        get: async (brandId: string) => ({ brandId, name: 'Brand', ...governance }),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const voice = () => ({ generate: vi.fn(async () => ({ url: 'https://audio.example/preview.mp3' })) });

describe('the spend ceiling', () => {
  /*
   * 280 characters, and the schema is where it is enforced rather than the
   * handler — a handler check would run after the tool had already been admitted
   * and metered. ElevenLabs bills per character, and this endpoint sits on an
   * onboarding screen.
   */
  it('refuses more than 280 characters at the schema', () => {
    const tooLong = VoicePreviewInput.safeParse({ genomeId: 'gen_1', text: 'a'.repeat(281) });
    expect(tooLong.success).toBe(false);

    const fits = VoicePreviewInput.safeParse({ genomeId: 'gen_1', text: 'a'.repeat(280) });
    expect(fits.success).toBe(true);
  });

  it('declares a non-zero estimate, so a loop registers as spend rather than as free', () => {
    expect(makeVoicePreview(voice()).estimateCents?.({ genomeId: 'gen_1', text: 'hi' })).toBeGreaterThan(0);
  });
});

describe('voice.preview', () => {
  it("narrates with the genome's registered voice", async () => {
    const client = voice();
    const out = await makeVoicePreview(client).handler({ genomeId: 'gen_1', text: 'Hello there.' }, ctx());

    expect(client.generate).toHaveBeenCalledWith({ voiceId: 'voice_1', script: 'Hello there.' });
    expect(out.url).toBe('https://audio.example/preview.mp3');
    expect(out.voiceId).toBe('voice_1');
  });

  it('says the voice was the brand’s own, so the screen can make that claim', async () => {
    const out = await makeVoicePreview(voice()).handler({ genomeId: 'gen_1', text: 'Hello.' }, ctx());
    expect(out.source).toBe('cloned');
  });

  it('falls back to the stock voice the brand chose, rather than refusing', async () => {
    const client = voice();
    const out = await makeVoicePreview(client).handler(
      { genomeId: 'gen_1', text: 'Hello.' },
      ctx({}, { stockVoiceId: 'stock_chosen' }),
    );

    expect(client.generate).toHaveBeenCalledWith({ voiceId: 'stock_chosen', script: 'Hello.' });
    expect(out.source).toBe('stock');
  });

  /*
   * The brand's own clone wins over a stock pick. Both can be set — picking a
   * stock voice does not delete a clone — and the clone is the more specific
   * answer to "what does my agent sound like".
   */
  it('prefers the clone when the brand has both', async () => {
    const client = voice();
    await makeVoicePreview(client).handler(
      { genomeId: 'gen_1', text: 'Hello.' },
      ctx({ elevenlabs_voice_id: 'voice_1' }, { stockVoiceId: 'stock_chosen' }),
    );

    expect(client.generate).toHaveBeenCalledWith({ voiceId: 'voice_1', script: 'Hello.' });
  });

  it('still speaks when the brand has chosen nothing at all — that is the default it would get', async () => {
    const client = voice();
    const out = await makeVoicePreview(client).handler({ genomeId: 'gen_1', text: 'Hello.' }, ctx({}));

    expect(client.generate).toHaveBeenCalled();
    expect(out.source).toBe('stock');
    expect(out.label).not.toBe('');
  });

  it('refuses a genomeId that is not the active one', async () => {
    await expect(
      makeVoicePreview(voice()).handler({ genomeId: 'gen_OTHER', text: 'Hello.' }, ctx()),
    ).rejects.toMatchObject({ code: 'ISOLATION_VIOLATION' });
  });
});
