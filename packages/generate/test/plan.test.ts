import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { GOLDEN_SET, byId } from '@sparksocial/playbooks';
import { buildSynthesizePlan } from '../src/plan.js';

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;

describe('buildSynthesizePlan', () => {
  it('resolves a pure-copy playbook (pb_text_update) into one copy beat', () => {
    const playbook = byId('pb_text_update')!;
    const plan = buildSynthesizePlan(playbook, genome);

    expect(plan.mediaType).toBe('text');
    expect(plan.beats).toHaveLength(1);
    expect(plan.beats[0]).toMatchObject({ kind: 'copy', promptRef: 'text.update' });
  });

  it('resolves a genome: source beat to literal text, and prompt_ref beats to copy', () => {
    const carousel = byId('pb_carousel_teaching')!;
    const plan = buildSynthesizePlan(carousel, genome);

    const cta = plan.beats.find((b) => b.beatId === 'cta');
    expect(cta).toMatchObject({ kind: 'text', text: 'Book now', genomePath: 'offer.primary_cta' });
    const cover = plan.beats.find((b) => b.beatId === 'cover');
    expect(cover?.kind).toBe('copy');
  });

  it('rejects a non-synthesize playbook', () => {
    const assemblePlaybook = byId('pb_offer_announcement')!;
    expect(() => buildSynthesizePlan(assemblePlaybook, genome)).toThrow(ToolError);
  });

  it('rejects a synthesize beat that names an asset source — synthesize has no retrieval step', () => {
    const playbook = byId('pb_text_update')!;
    const mutated = {
      ...playbook,
      structure: { beats: [{ id: 'copy', duration_sec: 0, source: 'asset:brand_kit' }] },
    };
    expect(() => buildSynthesizePlan(mutated, genome)).toThrow(ToolError);
  });

  it('throws NOT_FOUND when a genome: beat has nothing behind it', () => {
    const playbook = byId('pb_carousel_teaching')!;
    const emptyOffer = { ...genome, offer: { ...genome.offer, primary_cta: '' } };
    expect(() => buildSynthesizePlan(playbook, emptyOffer)).toThrow(ToolError);
  });

  it('throws on a beat with neither a source nor a prompt_ref', () => {
    const playbook = byId('pb_text_update')!;
    const mutated = { ...playbook, structure: { beats: [{ id: 'copy', duration_sec: 0 }] } };
    expect(() => buildSynthesizePlan(mutated, genome)).toThrow(ToolError);
  });
});
