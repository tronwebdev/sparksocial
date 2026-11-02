import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  GeneratingView,
  currentStep,
  planFor,
  titleFor,
  type GenJob,
} from '@/components/command-center/draft-panel/GeneratingView';
import type { ResolvedBeat } from '@/components/command-center/draft-panel/types';

/**
 * The generating screen — `DP genImage`, `genVideo`, `genCarousel`, `genText`.
 *
 * A generate call reports nothing until it returns, so the screen's one rule is
 * that it never claims more than has happened: the current step is paced, and
 * the last one is never ticked while the request is still out. These pin that.
 */

const job = (over: Partial<GenJob> = {}): GenJob => ({
  kind: 'image',
  postType: 'image',
  asked: 'A clean product hero shot',
  chips: ['1:1', 'Brand style'],
  startedAt: Date.now(),
  ...over,
});

describe('currentStep', () => {
  it('starts on the first step', () => {
    expect(currentStep(3, [20, 30], 0)).toBe(0);
  });

  it('moves through the steps across the low end of the estimate', () => {
    expect(currentStep(3, [21, 30], 7.5)).toBe(1);
    expect(currentStep(3, [21, 30], 14.5)).toBe(2);
  });

  it('holds on the last step however long the request takes', () => {
    expect(currentStep(3, [20, 30], 600)).toBe(2);
    expect(currentStep(5, [10, 40], 10_000)).toBe(4);
  });
});

describe('planFor', () => {
  it('names the post-draft steps after content.draft’s own order', () => {
    expect(planFor({ kind: 'post', postType: 'video' }).steps).toEqual([
      'Matching your brand assets',
      'Reading your brand knowledge',
      'Writing the script',
      'Adding hashtags',
      'Checking brand fit',
    ]);
    expect(planFor({ kind: 'post', postType: 'carousel' }).steps[2]).toBe('Writing the slides');
  });

  it('names the dub language', () => {
    expect(planFor({ kind: 'dub', postType: 'video', language: 'Spanish' }).steps[1]).toBe('Dubbing it into Spanish');
  });

  it('titles a new post the way the prototypes do', () => {
    expect(titleFor({ kind: 'post', postType: 'video' })).toBe('Generating your Video Post');
    expect(titleFor({ kind: 'post', postType: 'carousel' })).toBe('Generating your carousel');
    expect(titleFor({ kind: 'image', postType: 'image' })).toBe('Generating your image');
  });
});

describe('GeneratingView', () => {
  const beats: ResolvedBeat[] = [
    { kind: 'text', beatId: 'hook', text: 'Three mistakes' },
    { kind: 'generated_broll', beatId: 'b1', url: 'https://x/1.mp4', prompt: 'desk' },
    { kind: 'text', beatId: 'cta', text: 'Book a call' },
  ];

  const render = (j: GenJob, b: ResolvedBeat[] = []) =>
    renderToStaticMarkup(createElement(GeneratingView, { job: j, beats: b, campaignName: 'Lead magnet campaign', onClose: () => {} }));

  it('quotes the request and its chips, and never ticks a step on the first render', () => {
    const html = render(job());
    expect(html).toContain('Generating your image');
    expect(html).toContain('In progress');
    expect(html).toContain('What you asked for');
    expect(html).toContain('A clean product hero shot');
    expect(html).toContain('Brand style');
    expect(html).toContain('This usually takes 20–30 seconds');
    // The first step is current; nothing is done yet.
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('says which scene of how many, and ticks the scenes that already have media', () => {
    const html = render(job({ kind: 'broll', postType: 'video', beatId: 'cta', asked: 'Closing shot' }), beats);
    expect(html).toContain('Generating scene 3 of 3');
    // Scene 1 is words only, scene 2 has a clip: one tick among the squares.
    expect(html).toContain('>1<');
    expect(html).not.toContain('>2<');
  });

  it('leaves the request card off when there is nothing to quote', () => {
    const html = render(job({ kind: 'post', postType: 'text', asked: '' }));
    expect(html).toContain('Writing your copy');
    expect(html).not.toContain('What you asked for');
  });

  it('owns up once the usual time has passed', () => {
    const html = render(job({ startedAt: Date.now() - 120_000 }));
    expect(html).toContain('Taking longer than usual');
    expect(html).toContain('Saving it to the draft');
  });
});
