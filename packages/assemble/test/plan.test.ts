import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { byId, definePlaybook, GOLDEN_SET, PLAYBOOKS } from '@sparksocial/playbooks';
import type { Genome } from '@sparksocial/shared/genome';
import { buildRenderPlan, parseBeatSource, readGenomePath, type RetrievedAsset } from '../src/plan.js';

/**
 * The Assemble planner turns a playbook template into something renderable.
 * Two behaviours carry the most weight and are asserted hardest: it must never
 * put the same asset in two beats (the "reads as automated" failure the whole
 * retrieval ranking exists to prevent), and it must fail loudly when the Asset
 * Graph cannot fill a beat rather than shipping a shortened video — because
 * that gap is precisely what the capture loop is for.
 */

const genome = (over: Partial<Genome> = {}): Genome => {
  const base = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;
  return { ...base, offer: { ...base.offer, primary_cta: 'Start a free trial' }, ...over };
};

const asset = (id: string, role: RetrievedAsset['role'], score: number): RetrievedAsset => ({
  assetId: id,
  role,
  caption: `${role} ${id}`,
  score,
});

const workflowClip = byId('pb_workflow_clip')!;

describe('parseBeatSource', () => {
  it('parses the two schemes the playbook records actually use', () => {
    expect(parseBeatSource('asset:product_screen')).toEqual({ kind: 'asset', role: 'product_screen' });
    expect(parseBeatSource('genome:offer.primary_cta')).toEqual({ kind: 'genome', path: 'offer.primary_cta' });
  });

  it('rejects an unknown scheme or role instead of rendering an empty beat', () => {
    // Playbooks are data (invariant 5), so a typo in a record must surface as a
    // clear error rather than a beat that silently shows nothing.
    expect(() => parseBeatSource('assets:product_screen')).toThrow(ToolError);
    expect(() => parseBeatSource('asset:not_a_real_role')).toThrow(ToolError);
    expect(() => parseBeatSource('asset:')).toThrow(ToolError);
  });
});

describe('readGenomePath', () => {
  it('reads a dotted path', () => {
    expect(readGenomePath(genome(), 'offer.primary_cta')).toBe('Start a free trial');
    expect(readGenomePath(genome(), 'identity.business_name')).toBeTruthy();
  });

  it('returns undefined rather than stringifying a non-string', () => {
    // Without this, a mis-pointed path puts "[object Object]" on a real feed.
    expect(readGenomePath(genome(), 'offer')).toBeUndefined();
    expect(readGenomePath(genome(), 'version')).toBeUndefined();
    expect(readGenomePath(genome(), 'offer.nope')).toBeUndefined();
  });

  it('does not traverse the prototype chain', () => {
    expect(readGenomePath(genome(), 'constructor.name')).toBeUndefined();
    expect(readGenomePath(genome(), '__proto__.constructor.name')).toBeUndefined();
  });

  it('ignores an inherited string property, so a polluted prototype cannot reach a rendered beat', () => {
    // The two assertions above pass even without the own-property guard, because
    // `constructor` is a function and the type check rejects it — they do not
    // actually exercise the guard. This does: a polluted `Object.prototype` key
    // holding a *string* is exactly what an own-property check exists to stop,
    // and without it that value would be composited into a published post.
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto.primary_cta = 'INJECTED';
    try {
      expect(readGenomePath(genome(), 'primary_cta')).toBeUndefined();
    } finally {
      delete proto.primary_cta;
    }
  });
});

describe('buildRenderPlan', () => {
  it('fills every beat of a real playbook from real assets', () => {
    const { plan } = buildRenderPlan({
      playbook: workflowClip,
      genome: genome(),
      assets: [asset('a1', 'product_screen', 0.9)],
    });

    expect(plan.playbookId).toBe('pb_workflow_clip');
    expect(plan.mediaType).toBe('video');
    // hook (copy) → demo (asset) → payoff (copy) → cta (genome text)
    expect(plan.beats.map((b) => b.kind)).toEqual(['copy', 'asset', 'copy', 'text']);
    expect(plan.totalDurationSec).toBe(29);

    const cta = plan.beats.find((b) => b.kind === 'text');
    expect(cta).toMatchObject({ text: 'Start a free trial', genomePath: 'offer.primary_cta' });
  });

  it('picks the highest-scoring asset regardless of the order retrieval returned', () => {
    const { plan } = buildRenderPlan({
      playbook: workflowClip,
      genome: genome(),
      assets: [asset('low', 'product_screen', 0.2), asset('best', 'product_screen', 0.95)],
    });

    const used = plan.beats.find((b) => b.kind === 'asset');
    expect(used).toMatchObject({ assetId: 'best' });
  });

  it('never reuses one asset across two beats', () => {
    // Two beats, same role, only distinct assets available.
    const twoScreens = definePlaybook({
      ...workflowClip,
      playbook_id: 'pb_test_two_screens',
      structure: {
        beats: [
          { id: 'demo_a', duration_sec: 10, source: 'asset:product_screen' },
          { id: 'demo_b', duration_sec: 10, source: 'asset:product_screen' },
        ],
      },
      output: { ...workflowClip.output, duration_sec: [15, 30] },
    });

    const { plan } = buildRenderPlan({
      playbook: twoScreens,
      genome: genome(),
      assets: [asset('a1', 'product_screen', 0.9), asset('a2', 'product_screen', 0.5)],
    });

    const ids = plan.beats.filter((b) => b.kind === 'asset').map((b) => (b as { assetId: string }).assetId);
    expect(new Set(ids).size).toBe(2);
    // Best first, then the next unused one — not the best twice.
    expect(ids).toEqual(['a1', 'a2']);
  });

  it('fails with the missing roles when the graph cannot fill a beat', () => {
    // The single most important failure in this module: this is the signal the
    // capture loop consumes, so it must be an error carrying the roles, never a
    // quietly shortened video.
    const err = (() => {
      try {
        buildRenderPlan({ playbook: workflowClip, genome: genome(), assets: [] });
      } catch (e) {
        return e as ToolError;
      }
      return undefined;
    })();

    expect(err).toBeInstanceOf(ToolError);
    expect(err!.code).toBe('NOT_FOUND');
    expect(err!.meta.missingRoles).toEqual(['product_screen']);
  });

  it('fails when a second beat of the same role has no distinct asset left', () => {
    const twoScreens = definePlaybook({
      ...workflowClip,
      playbook_id: 'pb_test_two_screens_short',
      structure: {
        beats: [
          { id: 'demo_a', duration_sec: 10, source: 'asset:product_screen' },
          { id: 'demo_b', duration_sec: 10, source: 'asset:product_screen' },
        ],
      },
      output: { ...workflowClip.output, duration_sec: [15, 30] },
    });

    // Only one asset for two beats — "film one more" is the correct answer, not
    // "show the same clip twice".
    expect(() =>
      buildRenderPlan({
        playbook: twoScreens,
        genome: genome(),
        assets: [asset('only', 'product_screen', 0.9)],
      }),
    ).toThrow(ToolError);
  });

  it('refuses a genome beat whose value the brand has not supplied', () => {
    const noCta = genome({ offer: { products: [], primary_cta: '' } });
    expect(() =>
      buildRenderPlan({ playbook: workflowClip, genome: noCta, assets: [asset('a1', 'product_screen', 0.9)] }),
    ).toThrow(/no value at "offer.primary_cta"/);
  });

  it('refuses a non-assemble playbook', () => {
    const avatar = byId('pb_avatar_pov')!;
    expect(avatar.mode).not.toBe('assemble');
    expect(() => buildRenderPlan({ playbook: avatar, genome: genome(), assets: [] })).toThrow(ToolError);
  });

  it('rejects beats that total outside the playbook’s declared duration band', () => {
    // Beats and the duration band are authored separately and can drift; a 45s
    // cut for a format specified as 15–30 reads as off-format rather than crashing.
    const tooLong = definePlaybook({
      ...workflowClip,
      playbook_id: 'pb_test_too_long',
      structure: { beats: [{ id: 'demo', duration_sec: 45, source: 'asset:product_screen' }] },
      output: { ...workflowClip.output, duration_sec: [15, 30] },
    });

    expect(() =>
      buildRenderPlan({ playbook: tooLong, genome: genome(), assets: [asset('a1', 'product_screen', 0.9)] }),
    ).toThrow(/outside its declared 15–30s/);
  });

  it('skips the duration check for formats that have no duration', () => {
    const card = definePlaybook({
      ...workflowClip,
      playbook_id: 'pb_test_card',
      structure: { beats: [{ id: 'body', duration_sec: 0, prompt_ref: 'hook.problem' }] },
      output: { media_type: 'image', aspect_ratios: ['1:1'], platforms: ['instagram'] },
    });

    const { plan } = buildRenderPlan({ playbook: card, genome: genome(), assets: [] });
    expect(plan.mediaType).toBe('image');
    expect(plan.totalDurationSec).toBe(0);
  });

  it('rejects a beat with neither a source nor a prompt_ref', () => {
    const empty = definePlaybook({
      ...workflowClip,
      playbook_id: 'pb_test_empty_beat',
      structure: { beats: [{ id: 'nothing', duration_sec: 20 }] },
      output: { ...workflowClip.output, duration_sec: [15, 30] },
    });

    expect(() => buildRenderPlan({ playbook: empty, genome: genome(), assets: [] })).toThrow(/neither a source/);
  });
});

describe('the playbook library as data', () => {
  // Playbooks are data (invariant 5), so a new record with a malformed beat
  // must fail in CI rather than at render time in front of a user. This is the
  // record-level guard for that.
  it('every beat source in the library parses', () => {
    for (const pb of PLAYBOOKS) {
      for (const beat of pb.structure.beats) {
        if (beat.source) {
          expect(() => parseBeatSource(beat.source!), `${pb.playbook_id}/${beat.id}`).not.toThrow();
        }
      }
    }
  });

  it('every beat has exactly one of source or prompt_ref', () => {
    for (const pb of PLAYBOOKS) {
      for (const beat of pb.structure.beats) {
        const filled = [beat.source, beat.prompt_ref].filter(Boolean).length;
        expect(filled, `${pb.playbook_id}/${beat.id}`).toBe(1);
      }
    }
  });

  it('every assemble playbook’s beats total inside its declared duration band', () => {
    for (const pb of PLAYBOOKS.filter((p) => p.mode === 'assemble')) {
      const band = pb.output.duration_sec;
      if (!band) continue;
      const total = pb.structure.beats.reduce((s, b) => s + b.duration_sec, 0);
      expect(total, `${pb.playbook_id}`).toBeGreaterThanOrEqual(band[0]);
      expect(total, `${pb.playbook_id}`).toBeLessThanOrEqual(band[1]);
    }
  });
});
