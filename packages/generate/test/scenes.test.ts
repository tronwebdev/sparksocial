import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { sceneInsert, sceneRemove, sceneReorder, sceneRetime, sceneVoice, nextSceneId } from '../src/scenes.js';
import { contentDraftFixtureBeats } from './fixtures/scenes.js';
import type { ResolvedBeat } from '../src/draft.js';

/**
 * The scene tools, over `pb_talking_head_hot_take` — chosen because it is the
 * tight case: `take(20) + cta(3) = 23s` inside a declared `15–30s` band, seven
 * seconds of headroom. A format with slack would let every one of these tests
 * pass without ever exercising the band check, which is the invariant the whole
 * group exists to hold.
 */

const PLAYBOOK = 'pb_talking_head_hot_take';

function ctx(
  over: {
    beats?: ResolvedBeat[];
    status?: string;
    updateDraft?: ScopedDb['content']['updateDraft'];
    hasActiveConsent?: boolean;
  } = {},
): ToolCtx {
  const beats = over.beats ?? contentDraftFixtureBeats();
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        get: async () => ({
          id: 'ci_1',
          genomeId: 'gen_1',
          playbookId: PLAYBOOK,
          mode: 'synthesize' as const,
          status: over.status ?? 'draft',
          copy: beats,
          why: { summary: 'test', factors: [], evidence: [], alternatives: [] },
          createdAt: new Date(),
        }),
        updateDraft:
          over.updateDraft ??
          (async (args) => ({
            id: args.id,
            genomeId: args.genomeId,
            playbookId: PLAYBOOK,
            mode: 'synthesize' as const,
            status: 'draft',
            copy: args.copy,
            why: args.why,
            createdAt: new Date(),
          })),
      },
      consent: { hasActive: async () => over.hasActiveConsent ?? false },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const target = { contentItemId: 'ci_1', genomeId: 'gen_1' };

describe('content.scene.insert', () => {
  it('adds a described, timed scene after the named one and reports the new total', async () => {
    const out = await sceneInsert.handler(
      { ...target, afterBeatId: 'take', description: 'Cut to the pricing page.', durationSec: 5, label: 'B-roll' },
      ctx(),
    );

    expect(out.beats.map((b) => b.beatId)).toEqual(['take', 'scene_1', 'cta']);
    expect(out.beats[1]).toEqual({
      kind: 'text',
      beatId: 'scene_1',
      text: 'Cut to the pricing page.',
      durationSec: 5,
      label: 'B-roll',
    });
    expect(out.totalDurationSec).toBe(28);
    expect(out.durationBand).toEqual([15, 30]);
  });

  it('opens the post when no anchor is given', async () => {
    const out = await sceneInsert.handler({ ...target, description: 'A colder open.', durationSec: 4 }, ctx());
    expect(out.beats.map((b) => b.beatId)).toEqual(['scene_1', 'take', 'cta']);
    // No label given, and a hand-added scene has no playbook id to name it from.
    expect(out.beats[0]!.label).toBe('Scene');
  });

  /**
   * The consequence the module comment promises will look like a bug: on a tight
   * format there is genuinely no room, and the refusal has to name the number.
   */
  it('refuses a scene that would push the post past its format band, and says by how much', async () => {
    const updateDraft = vi.fn<ScopedDb['content']['updateDraft']>();

    await expect(
      sceneInsert.handler(
        { ...target, afterBeatId: 'cta', description: 'One more thought.', durationSec: 12 },
        ctx({ updateDraft }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Nothing saved: the check runs before the write, so a refused edit leaves
    // the draft exactly as it was rather than half-applied.
    expect(updateDraft).not.toHaveBeenCalled();

    await expect(
      sceneInsert.handler(
        { ...target, afterBeatId: 'cta', description: 'One more thought.', durationSec: 12 },
        ctx(),
      ),
    ).rejects.toThrow(/35s/);
  });

  it('will not edit a post that has already gone out', async () => {
    await expect(
      sceneInsert.handler({ ...target, description: 'Too late.', durationSec: 2 }, ctx({ status: 'published' })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses an anchor that is not in the draft', async () => {
    await expect(
      sceneInsert.handler({ ...target, afterBeatId: 'nope', description: 'x', durationSec: 2 }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('content.scene.remove', () => {
  it('drops the named scene and leaves the rest in order', async () => {
    // A three-scene draft, because deleting from the two-beat fixture cannot
    // land inside the band from either side: dropping the 20s take leaves 3s and
    // dropping the 3s CTA leaves 20s of a post with no CTA. That is the honest
    // shape of a tight format rather than a gap in the test — see the removal of
    // the *only* scene below, and the band refusal in the insert group.
    const padded: ResolvedBeat[] = [
      { kind: 'text', beatId: 'take', text: 'The take.', durationSec: 20, label: 'Talking head' },
      { kind: 'text', beatId: 'scene_1', text: 'Some b-roll.', durationSec: 5, label: 'B-roll' },
      { kind: 'text', beatId: 'cta', text: 'Book now.', durationSec: 3, label: 'CTA' },
    ];

    const out = await sceneRemove.handler({ ...target, beatId: 'scene_1' }, ctx({ beats: padded }));
    expect(out.beats.map((b) => b.beatId)).toEqual(['take', 'cta']);
    expect(out.totalDurationSec).toBe(23);
  });

  it('refuses a removal that would leave the post too short', async () => {
    await expect(sceneRemove.handler({ ...target, beatId: 'take' }, ctx())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('will not empty a draft', async () => {
    const one: ResolvedBeat[] = [{ kind: 'text', beatId: 'take', text: 'Only.', durationSec: 20 }];
    await expect(sceneRemove.handler({ ...target, beatId: 'take' }, ctx({ beats: one }))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('refuses a scene that is not there rather than succeeding silently', async () => {
    await expect(sceneRemove.handler({ ...target, beatId: 'ghost' }, ctx())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('content.scene.reorder', () => {
  it('moves a scene and cannot change the total', async () => {
    const out = await sceneReorder.handler({ ...target, beatId: 'cta', toIndex: 0 }, ctx());
    expect(out.beats.map((b) => b.beatId)).toEqual(['cta', 'take']);
    expect(out.totalDurationSec).toBe(23);
    // A move has no length consequence, so the explanation must not imply one.
    expect(JSON.stringify(out.why)).not.toMatch(/total/i);
  });

  it('clamps past the end instead of dropping the scene', async () => {
    const out = await sceneReorder.handler({ ...target, beatId: 'take', toIndex: 99 }, ctx());
    expect(out.beats.map((b) => b.beatId)).toEqual(['cta', 'take']);
  });
});

describe('content.scene.retime', () => {
  it('changes one scene and recomputes the post', async () => {
    const out = await sceneRetime.handler({ ...target, beatId: 'take', durationSec: 24 }, ctx());
    expect(out.beats.find((b) => b.beatId === 'take')!.durationSec).toBe(24);
    expect(out.totalDurationSec).toBe(27);
  });

  it('keeps the scene’s content and kind — a retime is not a rewrite', async () => {
    const media: ResolvedBeat[] = [
      { kind: 'generated_broll', beatId: 'take', url: 'https://x.example/v.mp4', prompt: 'a street', durationSec: 20 },
      { kind: 'text', beatId: 'cta', text: 'Book now.', durationSec: 3 },
    ];
    const out = await sceneRetime.handler({ ...target, beatId: 'take', durationSec: 18 }, ctx({ beats: media }));
    expect(out.beats[0]).toEqual({
      kind: 'generated_broll',
      beatId: 'take',
      url: 'https://x.example/v.mp4',
      prompt: 'a street',
      durationSec: 18,
    });
  });

  it('refuses a duration that puts the post outside its band', async () => {
    await expect(sceneRetime.handler({ ...target, beatId: 'take', durationSec: 40 }, ctx())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  /**
   * A legacy beat has no duration of its own, so its previous length came from
   * the playbook. The explanation has to be able to say that rather than print
   * `undefined`.
   */
  it('explains a retime of a beat that had no duration of its own', async () => {
    const legacy: ResolvedBeat[] = [
      { kind: 'text', beatId: 'take', text: 'The take.' },
      { kind: 'text', beatId: 'cta', text: 'Book now.' },
    ];
    const out = await sceneRetime.handler({ ...target, beatId: 'take', durationSec: 22 }, ctx({ beats: legacy }));
    expect(out.why.factors.find((f) => f.label === 'was')!.detail).toBe('the format default');
    // The untouched `cta` still falls back to the playbook's 3s.
    expect(out.totalDurationSec).toBe(25);
  });
});

describe('content.scene.voice', () => {
  it('records a stock-voice override without needing consent', async () => {
    const out = await sceneVoice.handler({ ...target, beatId: 'take', voice: 'stock' }, ctx());
    expect(out.beats.find((b) => b.beatId === 'take')!.voice).toBe('stock');
  });

  it('refuses the brand’s own voice with no consent on file', async () => {
    await expect(
      sceneVoice.handler({ ...target, beatId: 'take', voice: 'brand' }, ctx({ hasActiveConsent: false })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows the brand’s own voice once consent is active', async () => {
    const out = await sceneVoice.handler(
      { ...target, beatId: 'take', voice: 'brand' },
      ctx({ hasActiveConsent: true }),
    );
    expect(out.beats.find((b) => b.beatId === 'take')!.voice).toBe('brand');
  });

  it('clears the override rather than storing a third value for "default"', async () => {
    const overridden: ResolvedBeat[] = [
      { kind: 'text', beatId: 'take', text: 'The take.', durationSec: 20, voice: 'stock' },
      { kind: 'text', beatId: 'cta', text: 'Book now.', durationSec: 3 },
    ];
    const out = await sceneVoice.handler(
      { ...target, beatId: 'take', voice: 'default' },
      ctx({ beats: overridden }),
    );
    expect(out.beats[0]).not.toHaveProperty('voice');
  });
});

describe('nextSceneId', () => {
  it('never reissues an id that is still in use', () => {
    const beats: ResolvedBeat[] = [
      { kind: 'text', beatId: 'scene_1', text: 'a' },
      { kind: 'text', beatId: 'scene_3', text: 'c' },
    ];
    // Two scenes, so a length-based id would be `scene_2` — which happens to be
    // free here. The case that matters is the one after that.
    expect(nextSceneId(beats)).toBe('scene_2');
    expect(nextSceneId([...beats, { kind: 'text', beatId: 'scene_2', text: 'b' }])).toBe('scene_4');
  });
});

/** A `ToolError` is what the agent reads; a bare string would be unusable to it. */
describe('errors are ToolErrors', () => {
  it('throws ToolError, not Error', async () => {
    await expect(sceneRemove.handler({ ...target, beatId: 'ghost' }, ctx())).rejects.toBeInstanceOf(ToolError);
  });
});
