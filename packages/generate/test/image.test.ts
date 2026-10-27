import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { makeContentGenerateImage } from '../src/image.js';
import type { ImageClient } from '../src/types.js';

const draftBeats = [
  { kind: 'text' as const, beatId: 'hook', text: 'a card about our numbers' },
  { kind: 'asset' as const, beatId: 'proof', assetId: 'a1', role: 'social_proof' as const, caption: null },
];

/**
 * The genome and the brand are read by the handler now, so the fake store has
 * to have them — in production `ScopedDb` always does. `brandId` is set for
 * the same reason: without it the governance read is skipped and the palette
 * never reaches the prompt, which is the bug under test.
 */
function ctx(over: {
  get?: ScopedDb['content']['get'];
  updateDraft?: ScopedDb['content']['updateDraft'];
  genome?: unknown;
  governance?: unknown;
  brandId?: string | undefined;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_saas',
    brandId: 'brandId' in over ? over.brandId : 'brand_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get:
          over.get ??
          (async () => ({
            id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_generated_quote_card', mode: 'synthesize',
            status: 'draft', copy: draftBeats, createdAt: new Date(),
          })),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
            status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
          })),
      },
      genomes: {
        get: async () =>
          'genome' in over
            ? over.genome
            : {
                genome_id: 'gen_saas',
                identity: {
                  business_name: 'Clientforce',
                  category: 'B2B SaaS',
                  one_liner: 'An AI revenue workforce you hire against an outcome.',
                },
                dimensions: { talent_availability: 'no' },
              },
      },
      brands: {
        get: async () =>
          'governance' in over ? over.governance : { brandId: 'brand_1', name: 'Clientforce', brandColors: ['#0097FD'] },
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubImage(url = 'https://fal.example/img.png'): ImageClient {
  return { generate: vi.fn(async () => ({ url })) };
}

describe('content.generate_image — the registry contract', () => {
  const tool = makeContentGenerateImage(stubImage());

  it('is not idempotent — each call is a new, non-deterministic generation', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external', () => {
    expect(tool.effect).toBe('write');
  });
});

describe('content.generate_image', () => {
  it('replaces the named beat with a generated_image beat, leaving the rest untouched', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const image = stubImage('https://fal.example/card.png');
    const tool = makeContentGenerateImage(image);

    const res = await tool.handler(
      // Replace is explicit now: a text beat attaches by default (below).
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a bold quote card', aspectRatio: '1:1', attach: false },
      ctx({ updateDraft }),
    );

    expect(res.url).toBe('https://fal.example/card.png');
    /* The subject leads; the brand clause follows it. Asserted as a prefix
       rather than an exact match, because the clause is composed from the
       genome and is covered on its own in `brandContext.test.ts`. */
    expect(image.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringMatching(/^a bold quote card/), aspectRatio: '1:1' }),
    );

    const savedCopy = updateDraft.mock.calls[0]![0].copy as typeof draftBeats;
    /* The beat records the prompt that *made* the image, brand clause and all
       — not the fragment the caller passed. Regenerating from a stored prompt
       that was never the one used would quietly produce a different picture. */
    expect(savedCopy[0]).toMatchObject({ kind: 'generated_image', beatId: 'hook', url: 'https://fal.example/card.png' });
    expect((savedCopy[0] as unknown as { prompt: string }).prompt).toMatch(/^a bold quote card/);
    expect((savedCopy[0] as unknown as { prompt: string }).prompt).toContain('Clientforce');
    expect(savedCopy[1]).toEqual(draftBeats[1]); // the asset beat is untouched
  });

  /**
   * Generating media into a scene must not undo the scene.
   *
   * This replaces the beat wholesale — the beat *becomes* the image — which was
   * harmless while a beat held nothing but its id and its content. Since the
   * draft owns its structure it is not harmless: writing the new object without
   * `durationSec`/`label`/`voice` silently reset a retimed scene to the
   * playbook's length and dropped its badge. `keepStructure` is spread first for
   * exactly this, and the same fix applies to `_avatar_video`, `_broll`,
   * `_voiceover` and `_dub`.
   */
  it('carries the scene’s duration, label and voice across the change of kind', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const edited = [
      { kind: 'text' as const, beatId: 'hook', text: 'a card', durationSec: 7, label: 'Cover', voice: 'brand' as const },
    ];
    const tool = makeContentGenerateImage(stubImage('https://fal.example/card.png'));

    await tool.handler(
      // Replace is explicit now: a text beat attaches by default (below).
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a bold quote card', aspectRatio: '1:1', attach: false },
      ctx({
        updateDraft,
        get: async () => ({
          id: 'ci_1', genomeId: 'gen_saas', playbookId: 'pb_generated_quote_card', mode: 'synthesize',
          status: 'draft', copy: edited, createdAt: new Date(),
        }) as Awaited<ReturnType<ScopedDb['content']['get']>>,
      }),
    );

    /* `prompt` is matched separately: it now carries the brand clause, and
       what this test is about is the scene structure surviving the change of
       kind. */
    expect((updateDraft.mock.calls[0]![0].copy as unknown[])[0]).toMatchObject({
      kind: 'generated_image',
      beatId: 'hook',
      url: 'https://fal.example/card.png',
      durationSec: 7,
      label: 'Cover',
      voice: 'brand',
    });
  });

  /**
   * The words stay. Replacing a text beat by default turned a post's copy
   * into an image prompt — its caption went out as hashtags alone and the
   * queue called it unwritten. Found drafting a single-image post on
   * production, from the Draft Panel button, which sends no `attach`.
   */
  it('keeps a text beat and puts the picture behind it when `attach` is not given', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_generated_quote_card', mode: 'synthesize',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentGenerateImage(stubImage('https://fal.example/card.png'));

    await tool.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a card about our numbers', aspectRatio: '1:1' },
      ctx({ updateDraft }),
    );

    const savedCopy = updateDraft.mock.calls[0]![0].copy as unknown[];
    expect(savedCopy[0]).toMatchObject({
      kind: 'text',
      beatId: 'hook',
      text: 'a card about our numbers',
      backdrop: { kind: 'image', urls: ['https://fal.example/card.png'] },
    });
  });

  it('404s when the draft does not exist or is out of scope', async () => {
    const tool = makeContentGenerateImage(stubImage());
    await expect(
      tool.handler(
        { contentItemId: 'ci_gone', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '1:1' },
        ctx({ get: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the beat does not exist on the draft', async () => {
    const tool = makeContentGenerateImage(stubImage());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'nope', prompt: 'x', aspectRatio: '1:1' },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s when the draft became unwritable between the read and the save (e.g. published)', async () => {
    const tool = makeContentGenerateImage(stubImage());
    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '1:1' },
        ctx({ updateDraft: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates the image client failure rather than saving a broken beat', async () => {
    const failing: ImageClient = { generate: vi.fn(async () => { throw new ToolError('UPSTREAM_FAILED', 'fal down'); }) };
    const updateDraft = vi.fn();
    const tool = makeContentGenerateImage(failing);

    await expect(
      tool.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'x', aspectRatio: '1:1' },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(updateDraft).not.toHaveBeenCalled();
  });
});

/**
 * The brand reaches the picture.
 *
 * Measured on the deployed site before this existed: the tool passed the
 * caller's prompt to the vendor untouched, the Draft Panel's button sends the
 * beat's bare copy, and the model filled the silence — purple instead of the
 * brand's `#0097FD`, a stock presenter for a brand that had answered "no one
 * is going on camera", and from a vaguer prompt an invented company called
 * "LeadNova" with its own wordmark on the card.
 */
describe('the prompt that actually reaches the vendor', () => {
  const sentPrompt = (img: ImageClient) =>
    (img.generate as unknown as { mock: { calls: [{ prompt: string }][] } }).mock.calls[0]![0].prompt;

  it('still leads with the caller’s subject', async () => {
    const img = stubImage();
    await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx(),
    );
    expect(sentPrompt(img).startsWith('a quote card')).toBe(true);
  });

  it('names the brand, so the model does not invent one', async () => {
    const img = stubImage();
    await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx(),
    );
    expect(sentPrompt(img)).toContain('Clientforce');
    expect(sentPrompt(img)).toMatch(/do not invent or draw a logo/i);
  });

  it('carries the brand palette', async () => {
    const img = stubImage();
    await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx(),
    );
    expect(sentPrompt(img)).toContain('#0097FD');
  });

  it('forbids people when the brand said nobody is on camera', async () => {
    const img = stubImage();
    await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx(),
    );
    expect(sentPrompt(img)).toMatch(/no people/i);
  });

  it('allows people when the brand has somebody', async () => {
    const img = stubImage();
    await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx({ genome: { identity: { business_name: 'X' }, dimensions: { talent_availability: 'yes_licensed' } } }),
    );
    expect(sentPrompt(img)).not.toMatch(/no people/i);
  });

  /*
   * A brand with no genome row must still get an image. The brand clause is an
   * improvement to the prompt, not a precondition for having one.
   */
  it('still generates for a brand it knows nothing about', async () => {
    const img = stubImage();
    const out = await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx({ genome: undefined, governance: undefined, brandId: undefined }),
    );
    expect(out.url).toBe('https://fal.example/img.png');
    expect(sentPrompt(img)).toContain('a quote card');
  });

  it('records the brand context in `why`, so the Why popover shows what was sent', async () => {
    const img = stubImage();
    const out = await makeContentGenerateImage(img).handler(
      { contentItemId: 'ci_1', genomeId: 'gen_saas', beatId: 'hook', prompt: 'a quote card', aspectRatio: '1:1' },
      ctx(),
    );
    const labels = out.why.factors.map((f) => f.label);
    expect(labels).toContain('subject');
    expect(labels).toContain('brand context');
  });
});
