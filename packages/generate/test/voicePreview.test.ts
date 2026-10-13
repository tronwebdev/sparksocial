import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { makeVoicePreview, VoicePreviewInput } from '../src/voicePreview.js';

/**
 * `voice.preview` — speak a short line in the brand's registered voice.
 *
 * Two properties carry the weight. The character ceiling is the only thing
 * bounding spend on a tool reachable from onboarding, before a brand has done
 * anything; and the "no voice yet" path has to be a readable refusal rather than
 * an upstream error, because it is the state every brand is in when it first
 * sees this box.
 */

function ctx(constraints: Record<string, unknown> = { elevenlabs_voice_id: 'voice_1' }): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        get: async (id: string) => ({ id, identity: {}, constraints }),
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

  it('refuses readably when the brand has no voice yet, rather than calling the vendor', async () => {
    const client = voice();
    await expect(
      makeVoicePreview(client).handler({ genomeId: 'gen_1', text: 'Hello.' }, ctx({})),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(client.generate).not.toHaveBeenCalled();
  });

  it('refuses a genomeId that is not the active one', async () => {
    await expect(
      makeVoicePreview(voice()).handler({ genomeId: 'gen_OTHER', text: 'Hello.' }, ctx()),
    ).rejects.toMatchObject({ code: 'ISOLATION_VIOLATION' });
  });
});
