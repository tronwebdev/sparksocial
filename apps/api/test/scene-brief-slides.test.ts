import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createSceneBrief } from '../src/scene-brief.js';

/**
 * A carousel's slides are told they are a set.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * A carousel's beats *are* its slides, and the brief could not tell them
 * apart: every slide arrived as `format: carousel` carrying its own words and
 * no indication it had neighbours. Given three near-identical lines — which is
 * exactly what a "three pairs under £20" carousel is — it wrote three
 * near-identical shots, and the carousel read as one picture posted three
 * times.
 *
 * What is asserted here is what reaches the model, not what the model answers:
 * the brief is a generated paragraph, so the testable contract is the facts it
 * was given.
 */

/** What the brief model is called with — only the part these tests read. */
interface Sent {
  messages: { content: string }[];
}

/*
 * The mock is typed explicitly. `vi.fn(async () => …)` infers a *zero-argument*
 * mock, so `mock.calls[0]` is the empty tuple and reading `[0]` off it is a type
 * error — the same trap `packages/agency/test/logo.test.ts` documents having
 * fallen into, and it passes at runtime either way.
 */
function fakeModel() {
  const create = vi.fn<(body: Sent) => Promise<{ content: { type: string; text: string }[] }>>(async () => ({
    content: [{ type: 'text', text: 'a shot' }],
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

/** The user message the brief model was handed. */
function sent(create: ReturnType<typeof fakeModel>['create']): string {
  return create.mock.calls[0]![0].messages[0]!.content;
}

const base = {
  copy: 'Three pairs under £20 that don’t look it',
  brand: 'AG Accessories, a jewellery retailer',
  kind: 'image' as const,
  format: 'carousel',
  objective: 'sales',
};

describe('a slide knows it is one of several', () => {
  it('names its position in the set', async () => {
    const { client, create } = fakeModel();
    await createSceneBrief({ anthropic: client }).describe({
      ...base,
      slide: { index: 2, of: 4 },
    });

    expect(sent(create)).toContain('slide 2 of 4');
  });

  it('is told what the slides either side say, so the set stays continuous', async () => {
    const { client, create } = fakeModel();
    await createSceneBrief({ anthropic: client }).describe({
      ...base,
      slide: { index: 2, of: 3, before: 'Start with the studs', after: 'Then the hoops' },
    });

    const prompt = sent(create);
    expect(prompt).toContain('Start with the studs');
    expect(prompt).toContain('Then the hoops');
  });

  /*
   * Both halves, because either alone produces a worse carousel: continuity
   * without variation is the same picture three times, and variation without
   * continuity is three unrelated pictures.
   */
  it('asks for continuity and for a different composition', async () => {
    const { client, create } = fakeModel();
    await createSceneBrief({ anthropic: client }).describe({
      ...base,
      slide: { index: 1, of: 3, after: 'next' },
    });

    const prompt = sent(create);
    expect(prompt).toMatch(/continuous/i);
    expect(prompt).toMatch(/change the composition/i);
  });

  it('says nothing about slides for a single image', async () => {
    const { client, create } = fakeModel();
    await createSceneBrief({ anthropic: client }).describe(base);

    expect(sent(create)).not.toMatch(/slide/i);
  });

  it('truncates a long neighbour rather than pasting a whole caption in', async () => {
    const { client, create } = fakeModel();
    await createSceneBrief({ anthropic: client }).describe({
      ...base,
      slide: { index: 2, of: 3, before: 'x'.repeat(400) },
    });

    // 120 characters of context is orientation; 400 is a second post competing
    // with the one being illustrated.
    expect(sent(create)).not.toContain('x'.repeat(200));
  });
});
