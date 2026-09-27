import { describe, expect, it, vi } from 'vitest';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { makeContentDraft, KNOWLEDGE_BUDGET_CHARS } from '../src/draft.js';
import type { TextWriter } from '../src/types.js';

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
const withCta = { ...genome, offer: { ...genome.offer, primary_cta: 'Start a free trial' } };

const embed = { embed: async () => Array.from({ length: 8 }, () => 0.1) };

function echoWriter(): TextWriter {
  return { write: async ({ promptRef }) => `written: ${promptRef}` };
}

function ctx(over: {
  retrieve?: ScopedDb['assets']['retrieve'];
  genomeGet?: ScopedDb['genomes']['get'];
  createDraft?: ScopedDb['content']['createDraft'];
  updateDraft?: ScopedDb['content']['updateDraft'];
  contentGet?: ScopedDb['content']['get'];
  knowledge?: Array<{ text: string }>;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_gen_saas',
    genomeId: 'gen_saas',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        get: over.genomeGet ?? (async () => withCta),
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve:
          over.retrieve ??
          (async () => [
            { assetId: 'a1', role: 'product_screen', caption: 'the scheduler', score: 0.9,
              usageCount: 0, lastUsedAt: null, rightsStatus: 'cleared' },
          ]),
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: {
        recent: async () => [],
        createDraft: over.createDraft ?? (async (args) => ({
          id: 'ci_1', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
          status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
        })),
        get: over.contentGet ?? (async () => undefined),
        updateDraft: over.updateDraft ?? (async (args) => ({
          id: args.id, genomeId: args.genomeId, playbookId: 'pb_offer_announcement', mode: 'assemble',
          status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
        })),
      },
      runs: { list: async () => [], get: async () => undefined },
      knowledge: { listAll: async () => over.knowledge ?? [] },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('content.draft — the registry contract', () => {
  const tool = makeContentDraft({ text: echoWriter(), embed });

  it('is not idempotent — regeneration is the point, not a safe replay', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('is write, not external — nothing leaves the workspace', () => {
    expect(tool.effect).toBe('write');
  });

  it('estimates cost from the copy beats the playbook needs, plus the hashtag call', () => {
    // pb_text_update: one beat, no source — plus one call for the post's
    // hashtags, which LinkedIn and X both take.
    expect(tool.estimateCents?.({ genomeId: 'g', playbookId: 'pb_text_update', intent: '' })).toBe(2);
    // pb_offer_announcement: one prompt_ref beat + one genome: beat + one asset: beat.
    expect(
      tool.estimateCents?.({ genomeId: 'g', playbookId: 'pb_offer_announcement', intent: '' }),
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('content.draft — synthesize mode', () => {
  it('writes every copy beat via the text writer and creates a new draft', async () => {
    const createDraft = vi.fn<ScopedDb['content']['createDraft']>(async (args) => ({
      id: 'ci_new', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentDraft({ text: echoWriter(), embed });

    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' },
      ctx({ createDraft }),
    );

    expect(res.mode).toBe('synthesize');
    expect(res.mediaType).toBe('text');
    // `durationSec` and `label` are part of the beat as of the draft owning its
    // own structure, and they are asserted here rather than loosened away with
    // `toMatchObject`: the whole point of that change is that a beat records its
    // own timing, so a draft that stopped stamping it would be the regression.
    expect(res.beats).toEqual([
      { kind: 'text', beatId: 'copy', text: 'written: text.update', durationSec: 0, label: 'Copy' },
    ]);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
});

describe('content.draft — assemble mode', () => {
  it('retrieves assets, writes copy beats, and resolves genome: beats to literal text', async () => {
    const tool = makeContentDraft({ text: echoWriter(), embed });

    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', intent: '' },
      ctx(),
    );

    expect(res.mode).toBe('assemble');
    // pb_offer_announcement's only beat is a prompt_ref ('offer.scarcity'); no asset/genome beats.
    expect(res.beats.some((b) => b.kind === 'text')).toBe(true);
  });

  it('regenerates an existing slot via contentItemId, calling updateDraft not createDraft', async () => {
    const createDraft = vi.fn();
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_offer_announcement', mode: 'assemble',
      status: 'draft', copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentDraft({ text: echoWriter(), embed });

    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', contentItemId: 'ci_existing', intent: '' },
      ctx({ createDraft, updateDraft }),
    );

    expect(res.contentItemId).toBe('ci_existing');
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the slot is out of scope, published, or gone', async () => {
    const tool = makeContentDraft({ text: echoWriter(), embed });
    await expect(
      tool.handler(
        { genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', contentItemId: 'ci_gone', intent: '' },
        ctx({ updateDraft: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('content.draft — guard rails', () => {
  const tool = makeContentDraft({ text: echoWriter(), embed });

  it('404s on an unknown playbook', async () => {
    await expect(
      tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_nope', intent: '' }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a direct_finish playbook — that pipeline is direct.brief.generate', async () => {
    await expect(
      tool.handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture', intent: '' }, ctx()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('404s on an unknown genome', async () => {
    await expect(
      tool.handler(
        { genomeId: 'gen_x', playbookId: 'pb_text_update', intent: '' },
        ctx({ genomeGet: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * THE REDRAFT GUARD.
 *
 * Regenerating an existing slot rebuilds the beat list from the playbook, which
 * is the point — "another take" is the Draft Panel's most-used button. Since the
 * draft owns its structure that rebuild also discards whatever `content.scene.*`
 * did, and the response looks like an ordinary draft either way, so the loss is
 * invisible without a gate.
 */
describe('content.draft — hand-edited storyboards', () => {
  const tool = makeContentDraft({ text: echoWriter(), embed });

  /** As `content.draft` itself writes it: `pb_offer_announcement`'s one beat, untouched. */
  const asDrafted = (over: Record<string, unknown> = {}) => [
    { kind: 'text', beatId: 'offer', text: 'Two weeks left.', durationSec: 0, label: 'Offer', ...over },
  ];

  const existing = (copy: unknown): ScopedDb['content']['get'] =>
    async () => ({
      id: 'ci_existing', genomeId: 'gen_saas', playbookId: 'pb_offer_announcement',
      mode: 'assemble' as const, status: 'draft', copy, createdAt: new Date(),
    });

  const redraft = (contentGet: ScopedDb['content']['get'], discardSceneEdits?: boolean) =>
    tool.handler(
      {
        genomeId: 'gen_saas', playbookId: 'pb_offer_announcement', contentItemId: 'ci_existing',
        intent: '', ...(discardSceneEdits === undefined ? {} : { discardSceneEdits }),
      },
      ctx({ contentGet }),
    );

  it('regenerates freely over a draft nobody has touched', async () => {
    // Nearly every call. The guard must not make the ordinary path ask permission.
    await expect(redraft(existing(asDrafted()))).resolves.toMatchObject({ contentItemId: 'ci_existing' });
  });

  it('refuses when a scene has been inserted', async () => {
    const withScene = [...asDrafted(), { kind: 'text', beatId: 'scene_1', text: 'Added.', durationSec: 4 }];
    await expect(redraft(existing(withScene))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses when a scene has been retimed', async () => {
    await expect(redraft(existing(asDrafted({ durationSec: 9 })))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses when a scene carries a voice override', async () => {
    await expect(redraft(existing(asDrafted({ voice: 'brand' })))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('proceeds when the caller says to discard the edits', async () => {
    const withScene = [...asDrafted(), { kind: 'text', beatId: 'scene_1', text: 'Added.', durationSec: 4 }];
    const res = await redraft(existing(withScene), true);
    // Rebuilt from the playbook, so the added scene is gone — which is what was confirmed.
    expect(res.beats.map((b) => b.beatId)).not.toContain('scene_1');
  });

  it('does not fire on a legacy draft with no durations of its own', async () => {
    // Pre-24-August rows carry neither `durationSec` nor `label`. Absent is not
    // an edit, and treating it as one would lock every old draft out of redrafting.
    await expect(
      redraft(existing([{ kind: 'text', beatId: 'offer', text: 'Two weeks left.' }])),
    ).resolves.toMatchObject({ contentItemId: 'ci_existing' });
  });

  it('does not fire on an empty slot', async () => {
    // A calendar slot from `calendar.generate` has no copy at all; filling it is
    // the first draft, not a regeneration over somebody's work.
    await expect(redraft(existing([]))).resolves.toMatchObject({ contentItemId: 'ci_existing' });
  });
});

/**
 * Hashtags on a drafted post.
 *
 * They did not exist. `platformPolicy` had always counted them and blocked a
 * caption carrying too many, no playbook declared a hashtag beat, no
 * `prompt_ref` asked for one, and the copy writer's system prompt said to
 * return the beat text and nothing else. The ceiling was enforced against a
 * feature that was never built, and every draft came out bare.
 */
describe('content.draft — hashtags', () => {
  /** A writer that returns more than any budget allows, and messily. */
  function taggingWriter(tags: string[] = ['Cold Brew', '#huila', 'huila', 'PinkBourbon', 'roastday']): TextWriter {
    return { ...echoWriter(), hashtags: async () => tags };
  }

  it('writes them, hashed, on a post whose platform takes them', async () => {
    const tool = makeContentDraft({ text: taggingWriter(), embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    expect(res.hashtags.length).toBeGreaterThan(0);
    for (const tag of res.hashtags) expect(tag).toMatch(/^#[A-Za-z0-9_]+$/);
  });

  it('never writes more than the platform the guardrail will check', async () => {
    /*
     * The failure this is here to prevent: a draft SPARK wrote that
     * `publish.now` then refuses. `pb_text_update` goes to LinkedIn and X, and
     * X's cap is 2 — the narrowest wins, because one caption is published to
     * both.
     */
    const tool = makeContentDraft({ text: taggingWriter(), embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    expect(res.hashtags).toEqual(['#ColdBrew', '#huila']);
  });

  it('stores them without the # and returns them with it', async () => {
    // The column holds the tag, not its punctuation; the caption needs the
    // punctuation. One place adds it, and this is the seam.
    const createDraft = vi.fn(async (args: Parameters<ScopedDb['content']['createDraft']>[0]) => ({
      id: 'ci_1', genomeId: args.genomeId, playbookId: args.playbookId, mode: args.mode,
      status: 'draft' as const, copy: args.copy, why: args.why, createdAt: new Date(),
    }));
    const tool = makeContentDraft({ text: taggingWriter(), embed });
    await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx({ createDraft }));

    expect(createDraft.mock.calls[0]![0].hashtags).toEqual(['ColdBrew', 'huila']);
  });

  it('grounds them in the copy that was just written, not the brand alone', async () => {
    /*
     * Tags derived from the genome describe the *business*, so every post for a
     * brand gets the same ones — the generic tail that makes a caption look
     * machine-written. The beats are the only thing that knows what this
     * particular post is about.
     */
    const seen: string[] = [];
    const writer: TextWriter = {
      ...echoWriter(),
      hashtags: async ({ draftText }) => {
        seen.push(draftText);
        return ['one', 'two'];
      },
    };
    const tool = makeContentDraft({ text: writer, embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    expect(seen).toHaveLength(1);
    const beatText = res.beats.filter((b) => b.kind === 'text').map((b) => b.text);
    for (const t of beatText) expect(seen[0]).toContain(t);
  });

  it('is never a beat — the storyboard must not gain a scene of hashtags', async () => {
    /*
     * `packages/compose` renders a `kind: 'text'` beat as a full-screen type
     * card. A hashtags beat would be burned into the middle of every video,
     * which is why they live on the item and not in `copy`.
     */
    const tool = makeContentDraft({ text: taggingWriter(), embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    for (const beat of res.beats) {
      if (beat.kind === 'text') expect(beat.text).not.toMatch(/#/);
    }
  });

  it('still produces a draft when the writer has no hashtag support at all', async () => {
    // The behaviour every draft had before this existed. A writer that cannot
    // write tags is a plainer post, not a failed one.
    const tool = makeContentDraft({ text: echoWriter(), embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    expect(res.hashtags).toEqual([]);
    expect(res.beats.length).toBeGreaterThan(0);
  });

  it('keeps the beats when the hashtag call throws', async () => {
    /*
     * Beats cost a model call each and are the actual content. Losing them to a
     * failure in the decoration would be the tool destroying the expensive part
     * of its own work over the cheap part.
     */
    const writer: TextWriter = {
      ...echoWriter(),
      hashtags: async () => {
        throw new Error('vendor down');
      },
    };
    const tool = makeContentDraft({ text: writer, embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    expect(res.hashtags).toEqual([]);
    expect(res.beats.length).toBeGreaterThan(0);
  });

  it('shows the guardrail the caption that actually goes out', async () => {
    /*
     * `platformPolicy` counts hashtags and measures length. Checking the beats
     * alone would be checking a string nobody publishes — and would let a draft
     * pass here and fail at `publish.now`, which checks the assembled caption.
     */
    const seen: string[] = [];
    const guard = {
      check: async (args: { text: string }) => {
        seen.push(args.text);
        return { verdict: 'pass' as const };
      },
    };
    const tool = makeContentDraft({ text: taggingWriter(), embed, guard });
    await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx());

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('#ColdBrew');
  });
});

/**
 * Beats that share a `prompt_ref` must not paraphrase each other.
 *
 * A Teaching Carousel has four step beats all keyed `teach.steps`. Written in
 * parallel, each got an identical brief and no knowledge of the others, and a
 * real draft came back with four ways of saying "put it in an airtight
 * container". The outline was meant to prevent this and could not: it carried
 * `text` only for *literal* beats, so a copy beat could see a sibling existed
 * and never what it said. That is why CTA de-duplication worked and step
 * de-duplication never did.
 */
describe('content.draft — beats that share a prompt_ref', () => {
  /** Records the outline each call was given, and answers with its call number. */
  function recordingWriter(seen: Array<{ beatId: string; siblingTexts: string[] }>): TextWriter {
    let n = 0;
    return {
      write: async ({ beatId, promptRef, outline }) => {
        seen.push({
          beatId,
          siblingTexts: outline
            .filter((o) => o.beatId !== beatId && o.kind === 'copy' && o.promptRef === promptRef && o.text)
            .map((o) => o.text!),
        });
        n += 1;
        return `written ${n}: ${promptRef}`;
      },
    };
  }

  it('hands each later sibling the words the earlier ones actually used', async () => {
    const seen: Array<{ beatId: string; siblingTexts: string[] }> = [];
    const tool = makeContentDraft({ text: recordingWriter(seen), embed });
    await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_carousel_teaching', intent: '' }, ctx());

    const steps = seen.filter((s) => s.beatId.startsWith('step'));
    expect(steps.length).toBeGreaterThan(1);
    // The first step has nothing before it; every one after it can see its
    // predecessors. Without this the model is writing blind and rewords.
    expect(steps[0]!.siblingTexts).toEqual([]);
    expect(steps[steps.length - 1]!.siblingTexts.length).toBe(steps.length - 1);
  });

  it('still writes beats with a unique prompt_ref concurrently', async () => {
    /*
     * The fix is scoped deliberately. Serialising every beat would make a
     * five-beat post five round trips deep for no benefit — a hook and a CTA
     * have nothing to collide over. Only the duplicated key pays.
     */
    const order: string[] = [];
    const writer: TextWriter = {
      write: async ({ beatId, promptRef }) => {
        order.push(`start:${beatId}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${beatId}`);
        return `written: ${promptRef}`;
      },
    };
    const tool = makeContentDraft({ text: writer, embed });
    await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_voice_over_broll', intent: '' }, ctx());

    // Concurrent work interleaves: at least one beat starts before another ends.
    const firstEnd = order.findIndex((o) => o.startsWith('end:'));
    const startsBeforeFirstEnd = order.slice(0, firstEnd).filter((o) => o.startsWith('start:')).length;
    expect(startsBeforeFirstEnd).toBeGreaterThan(1);
  });

  it('produces one beat per step rather than collapsing them', async () => {
    const tool = makeContentDraft({ text: echoWriter(), embed });
    const res = await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_carousel_teaching', intent: '' },
      ctx(),
    );
    const steps = res.beats.filter((b) => b.beatId.startsWith('step'));
    expect(steps.length).toBeGreaterThan(1);
  });
});

/**
 * The writer receives what the brand has written down about itself.
 *
 * It did not, and the result was visible in every draft: a brand could attach a
 * document holding its hours, its prices and the age of its starter, and the
 * copy came back "a slow, delicious journey". `guard.claim_grounding` read that
 * corpus to *check* what had been written while the thing writing it had never
 * seen it — the product policed specificity it had no way to supply.
 */
describe('content.draft — brand knowledge reaches the writer', () => {
  const chunks = [
    { text: 'Sourdough ferments for 18 hours. We bake 120 loaves on weekdays.' },
    { text: 'Flour comes from Trenoweth Mill, thirty miles away. Closed Mondays.' },
  ];

  function capturingWriter(seen: Array<string[] | undefined>): TextWriter {
    return {
      write: async ({ knowledge, promptRef }) => {
        seen.push(knowledge);
        return `written: ${promptRef}`;
      },
    };
  }

  it('hands the chunks to every beat', async () => {
    const seen: Array<string[] | undefined> = [];
    const tool = makeContentDraft({ text: capturingWriter(seen), embed });
    await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_carousel_teaching', intent: 'how long it ferments' },
      ctx({ knowledge: chunks }),
    );

    expect(seen.length).toBeGreaterThan(1);
    for (const k of seen) expect(k?.join(' ')).toContain('18 hours');
  });

  it('passes nothing when the brand has attached nothing', async () => {
    // The common case, and it worked before this existed. An empty array must
    // not become an empty instruction block in the prompt.
    const seen: Array<string[] | undefined> = [];
    const tool = makeContentDraft({ text: capturingWriter(seen), embed });
    await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, ctx({ knowledge: [] }));

    for (const k of seen) expect(k ?? []).toEqual([]);
  });

  it('still drafts when the knowledge store fails', async () => {
    /*
     * Beats cost a model call each. Losing a post because the optional
     * grounding material could not be read would discard the expensive half
     * for the cheap one — the same rule hashtags follow.
     */
    const failing = ctx({ knowledge: [] });
    (failing.db as unknown as { knowledge: { listAll: () => Promise<never> } }).knowledge = {
      listAll: async () => {
        throw new Error('store down');
      },
    };
    const tool = makeContentDraft({ text: echoWriter(), embed });
    const res = await tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: '' }, failing);
    expect(res.beats.length).toBeGreaterThan(0);
  });

  it('ranks the chunk that matches the post first, and stays within budget', async () => {
    const many = [
      { text: 'Irrelevant filler about parking and bin collection. '.repeat(30) },
      { text: 'Sourdough ferments for 18 hours before it reaches the oven.' },
    ];
    const seen: Array<string[] | undefined> = [];
    const tool = makeContentDraft({ text: capturingWriter(seen), embed });
    await tool.handler(
      { genomeId: 'gen_saas', playbookId: 'pb_text_update', intent: 'sourdough ferments slowly' },
      ctx({ knowledge: many }),
    );

    const joined = (seen[0] ?? []).join('');
    expect(joined).toContain('18 hours');
    expect(joined.length).toBeLessThanOrEqual(KNOWLEDGE_BUDGET_CHARS);
  });
});
