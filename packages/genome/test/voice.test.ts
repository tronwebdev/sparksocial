import { describe, expect, it, vi } from 'vitest';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { genomeVoiceSet } from '../src/voice.js';

/**
 * `genome.voice.set` — the tool `voice` never had.
 *
 * `voice` was writable only at `createDraft` time, and only the crawl ever put
 * anything real in it. Every other path left an all-`0.5` `tone_vector` and
 * empty `pov_statements`, permanently, with no repository method that could
 * change it. Since `text-writer.ts` builds its prompt almost entirely from this
 * object, that is why drafted copy read like any business in the category.
 */

function ctx(over: { patchVoice?: ScopedDb['genomes']['patchVoice']; role?: string } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: over.role ?? 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        patchIdentity: async () => ({ id: 'g', version: 1 }),
        patchOffer: async () => ({ id: 'g', version: 1 }),
        patchVoice: over.patchVoice ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('the registry contract', () => {
  it('is a write, not human_only — how a brand sounds is editing, not governance', () => {
    expect(genomeVoiceSet.effect).toBe('write');
    expect(genomeVoiceSet.autonomy).toBe('auto');
  });

  it('excludes client and viewer — a client agreeing is a conversation, not a write', () => {
    expect(genomeVoiceSet.scopes).toEqual(['owner', 'admin', 'editor']);
  });
});

describe('genome.voice.set', () => {
  it('sends only the fields supplied, so a POV edit cannot blank the tone', async () => {
    const patchVoice = vi.fn<ScopedDb['genomes']['patchVoice']>(async ({ genomeId }) => ({
      id: genomeId,
      version: 3,
    }));

    const out = await genomeVoiceSet.handler(
      { genomeId: 'gen_1', voice: { pov_statements: ['A fade should last three weeks, not three days'] } },
      ctx({ patchVoice }),
    );

    expect(out).toEqual({ genomeId: 'gen_1', version: 3 });
    expect(patchVoice).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      voice: { pov_statements: ['A fade should last three weeks, not three days'] },
    });
  });

  it('accepts every field the prompt actually reads', async () => {
    // These are exactly the keys `text-writer.ts`'s prompt() interpolates. A
    // field it reads but this cannot write is a field nobody can ever fill.
    const parsed = genomeVoiceSet.input.safeParse({
      genomeId: 'gen_1',
      voice: {
        tone_vector: { formal: 0.2, playful: 0.7, technical: 0.4, bold: 0.6 },
        pov_statements: ['one', 'two'],
        banned_phrases: ['game-changer'],
        required_disclaimers: ['Results vary.'],
        reading_level: 7,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('strips a field the genome schema does not have, rather than saving it', () => {
    // Stripping, not rejecting: the same contract `genome.offer.set` has, and
    // the genome schemas are deliberately non-strict so an inference result
    // carrying an extra key is usable rather than a hard failure.
    const parsed = genomeVoiceSet.input.safeParse({ genomeId: 'gen_1', voice: { vibe: 'chill' } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.voice).toEqual({});
  });

  it('rejects a tone axis outside 0-1, which the guardrail compares distances against', async () => {
    const parsed = genomeVoiceSet.input.safeParse({
      genomeId: 'gen_1',
      voice: { tone_vector: { formal: 1.4, playful: 0.5, technical: 0.5, bold: 0.5 } },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts an empty patch — the no-op a form submits when nothing changed', async () => {
    expect(genomeVoiceSet.input.safeParse({ genomeId: 'gen_1', voice: {} }).success).toBe(true);
  });

  it('lets a store-level NOT_FOUND propagate rather than reporting a phantom success', async () => {
    const patchVoice = vi.fn<ScopedDb['genomes']['patchVoice']>(async () => {
      const { ToolError } = await import('@sparksocial/shared');
      throw new ToolError('NOT_FOUND', 'No genome gen_x in org org_1.');
    });

    await expect(
      genomeVoiceSet.handler({ genomeId: 'gen_x', voice: { reading_level: 7 } }, ctx({ patchVoice })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
