import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { Genome } from '@sparksocial/shared/genome';
import type { Playbook } from '@sparksocial/playbooks';
import type { BeatOutlineEntry, TextWriter } from '@sparksocial/generate';
import { createTextWriter } from '../src/text-writer.js';

/**
 * The copy writer used to produce one line for every beat, whatever the beat.
 *
 * Measured against a real genome: a 30-second narration beat came back at 41
 * words, a whole Voice-over B-roll post at 55, and `pb_text_update` — whose one
 * beat is the entire LinkedIn caption — at 19. The cause was not the model. The
 * writer was never told how long a beat should be (it did not even receive
 * `duration_sec`), and the system prompt's "a single … line" read as an
 * instruction. These tests pin the budget that replaced it.
 */

type WriteArgs = Parameters<TextWriter['write']>[0];

/** Captures what was actually sent, and returns whatever text the test wants back. */
function spy(reply = 'a beat') {
  // Typed parameter so `mock.calls[0]` exists — the prompt is the assertion target.
  const create = vi.fn(async (_body: { messages: Array<{ content: string }> }) => ({
    content: [{ type: 'tool_use', name: 'record_copy', input: { text: reply } }],
    stop_reason: 'tool_use',
  }));
  const anthropic = { messages: { create } } as unknown as Anthropic;
  return {
    anthropic,
    create,
    /** The user-turn prompt from the most recent call. */
    sent: () => create.mock.calls.at(-1)![0].messages[0]!.content,
  };
}

const genome = {
  identity: {
    business_name: 'Northside Barbers',
    category: 'barbershop',
    one_liner: 'Skin fades and beard work.',
    price_tier: 'mid',
  },
  voice: {
    tone_vector: { formal: 0.2, playful: 0.7, technical: 0.4, bold: 0.6 },
    reading_level: 7,
    pov_statements: [],
    banned_phrases: [],
  },
  audience: { segments: [] },
  offer: { primary_cta: 'Book a chair' },
} as unknown as Genome;

const pb = (mediaType: string, platforms: string[]): Playbook =>
  ({
    name: 'Test',
    description: 'A test playbook.',
    output: { media_type: mediaType, platforms, aspect_ratios: ['4:5'] },
  }) as unknown as Playbook;

const outline: BeatOutlineEntry[] = [
  { beatId: 'hook', kind: 'copy', promptRef: 'hook.problem' },
  { beatId: 'body', kind: 'copy', promptRef: 'teach.one_idea' },
  { beatId: 'cta', kind: 'literal', text: 'Book a chair' },
];

const call = (s: ReturnType<typeof spy>, over: Partial<WriteArgs> = {}) =>
  createTextWriter({ anthropic: s.anthropic }).write({
    genome,
    playbook: pb('video', ['instagram']),
    promptRef: 'teach.one_idea',
    beatId: 'body',
    durationSec: 30,
    outline,
    ...over,
  } as WriteArgs);

const budgetOf = (prompt: string) => {
  const m = /Length: (\d+)-(\d+) words/.exec(prompt);
  if (!m) throw new Error(`no budget in prompt:\n${prompt}`);
  return { min: Number(m[1]), max: Number(m[2]) };
};

describe('length comes from the beat, not from a habit', () => {
  it('scales a spoken beat with its duration — 30s is far more than 3s', async () => {
    const short = spy();
    await call(short, { durationSec: 3, promptRef: 'hook.problem', beatId: 'hook' });
    const long = spy();
    await call(long, { durationSec: 30 });

    const s = budgetOf(short.sent());
    const l = budgetOf(long.sent());
    expect(s.max).toBeLessThan(12); // a 3s hook is a line
    expect(l.min).toBeGreaterThan(50); // a 30s body is a paragraph
    expect(l.min).toBeGreaterThan(s.max * 4);
  });

  it('asks a 30s beat for roughly 30 seconds of speech, not 41 words', async () => {
    // The observed regression, as an assertion: 2.5 words/sec puts 30s near 75.
    const s = spy();
    await call(s, { durationSec: 30 });
    const { min, max } = budgetOf(s.sent());
    expect(min).toBeGreaterThanOrEqual(60);
    expect(max).toBeLessThanOrEqual(90);
    expect(41).toBeLessThan(min); // what it used to produce is now under budget
  });

  it('sizes a caption-only post by platform — LinkedIn gets far more than X', async () => {
    const li = spy();
    await call(li, { durationSec: 0, playbook: pb('text', ['linkedin']), promptRef: 'text.update' });
    const x = spy();
    await call(x, { durationSec: 0, playbook: pb('text', ['x']), promptRef: 'text.update' });

    expect(budgetOf(li.sent()).min).toBeGreaterThan(budgetOf(x.sent()).max);
    // 19 words was the whole LinkedIn caption before this.
    expect(budgetOf(li.sent()).min).toBeGreaterThan(19);
  });

  it('takes the narrowest platform when a playbook targets several', async () => {
    // Copy that fits X can go to LinkedIn; the reverse gets truncated.
    const s = spy();
    await call(s, { durationSec: 0, playbook: pb('text', ['linkedin', 'x']), promptRef: 'text.update' });
    expect(budgetOf(s.sent()).max).toBeLessThanOrEqual(45);
  });

  it('keeps text set on an image short whatever the platform', async () => {
    const s = spy();
    await call(s, { durationSec: 0, playbook: pb('image', ['linkedin']), promptRef: 'card' });
    expect(budgetOf(s.sent()).max).toBeLessThanOrEqual(16);
  });
});

describe('a beat knows what the rest of the post says', () => {
  it('lists the other beats so it does not repeat them', async () => {
    const s = spy();
    await call(s);
    const sent = s.sent();
    expect(sent).toContain('must not duplicate');
    expect(sent).toContain('hook: hook.problem');
    expect(sent).toContain('cta: fixed text');
    // Not itself.
    expect(sent).not.toContain('body: teach.one_idea');
  });

  it('forbids a call to action when a later beat already carries one', async () => {
    // The observed bug: the body ended "Book a chair today…" and the next beat
    // was "Book a chair".
    const s = spy();
    await call(s);
    expect(s.sent()).toContain('already carries the call to action');
  });

  it('says nothing about a CTA when no beat supplies one', async () => {
    const s = spy();
    await call(s, { outline: [{ beatId: 'body', kind: 'copy', promptRef: 'teach.one_idea' }] });
    expect(s.sent()).not.toContain('already carries the call to action');
  });

  it('names the platform and media type, which decide register as well as length', async () => {
    const s = spy();
    await call(s, { playbook: pb('carousel', ['instagram', 'linkedin']) });
    expect(s.sent()).toContain('Publishing to: instagram, linkedin as carousel');
  });
});

describe('what comes back is publishable as-is', () => {
  it('strips quotation marks wrapping the whole beat', async () => {
    // These reached rendered images, where they cannot be corrected afterwards.
    for (const wrapped of ['"Fresh cuts every time."', '“Fresh cuts every time.”']) {
      const out = await call(spy(wrapped));
      expect(out).toBe('Fresh cuts every time.');
    }
  });

  it('leaves a quote inside the beat alone', async () => {
    const out = await call(spy('She said "best fade in Northside" and rebooked.'));
    expect(out).toBe('She said "best fade in Northside" and rebooked.');
  });

  it('drops a closing sentence that just restates the CTA beat', async () => {
    // Seen on a real draft through the OpenAI fallback: the 30s body ended
    // "…enduring confidence. Book a chair." with the next beat reading
    // "Book a chair". The prompt forbids it; this makes it not matter.
    const out = await call(spy('A fade should hold its shape for weeks. Book a chair.'));
    expect(out).toBe('A fade should hold its shape for weeks.');
  });

  it('leaves the CTA words alone mid-paragraph, where they are not a stutter', async () => {
    const out = await call(spy('Book a chair before Friday and we will have time to do it properly. Most people wait too long.'));
    expect(out).toMatch(/^Book a chair before Friday/);
    expect(out).toMatch(/wait too long\.$/);
  });

  it('does not strip the only sentence, even if it is the CTA', async () => {
    // A one-sentence beat that happens to be the CTA is a beat, not a stutter —
    // removing it would return empty and fail the caller's own emptiness check.
    const out = await call(spy('Book a chair.'));
    expect(out).toBe('Book a chair.');
  });

  it('stops handing the model the CTA when a later beat carries it', async () => {
    // Naming it and banning it in the same prompt is the contradiction that
    // produced the duplicate in the first place.
    const withCta = spy();
    await call(withCta);
    expect(withCta.sent()).not.toContain('Primary call to action');

    const noCta = spy();
    await call(noCta, { outline: [{ beatId: 'body', kind: 'copy', promptRef: 'teach.one_idea' }] });
    expect(noCta.sent()).toContain('Primary call to action: Book a chair');
  });

  it('still rejects an empty beat rather than publishing whitespace', async () => {
    await expect(call(spy('   '))).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
  });
});

/**
 * The pillar directive, and the CTA it withholds.
 *
 * The regression: the brief handed the model the business, the offer and
 * `Primary call to action: …` and never said what kind of post it was, so every
 * pillar came out promotional — the reported symptom was educational posts that
 * were all promotions and demos. `playbook.content_pillar` was in scope and
 * unused.
 *
 * This matters beyond one prompt line. The mix engine balances five pillars and
 * caps promotional content; if four of the five read like the fifth, a brand
 * posting 20% product and 80% product-shaped "education" is posting 100%
 * product and the ceiling enforces nothing.
 */
const pillarPb = (pillar: string): Playbook =>
  ({
    name: 'Test',
    description: 'A test playbook.',
    content_pillar: pillar,
    output: { media_type: 'carousel', platforms: ['instagram'], aspect_ratios: ['4:5'] },
  }) as unknown as Playbook;

/** No literal beat, so the CTA is only withheld if the *pillar* withholds it. */
const noCtaOutline: BeatOutlineEntry[] = [
  { beatId: 'body', kind: 'copy', promptRef: 'teach.one_idea' },
];

describe('the content pillar reaches the writer', () => {
  it('tells an educational beat to teach and not to pitch', async () => {
    const s = spy();
    await call(s, { playbook: pillarPb('educational') });
    const sent = s.sent();
    expect(sent).toContain('EDUCATIONAL');
    expect(sent).toMatch(/do not pitch/i);
    // The specific failure reported: education that reads as a demo.
    expect(sent).toMatch(/do not list features/i);
  });

  it('withholds the call to action from a pillar that must not pitch', async () => {
    const s = spy();
    await call(s, { playbook: pillarPb('educational'), outline: noCtaOutline });
    // Naming the CTA and then forbidding a sell is a contradiction the model
    // resolves by selling — so it is not named at all.
    expect(s.sent()).not.toContain('Primary call to action');
  });

  it('gives the call to action to a product beat, where selling is the job', async () => {
    const s = spy();
    await call(s, { playbook: pillarPb('product'), outline: noCtaOutline });
    const sent = s.sent();
    expect(sent).toContain('PRODUCT');
    expect(sent).toContain('Primary call to action: Book a chair');
  });

  it('says something specific for every pillar the mix engine can produce', async () => {
    // If the mix engine can schedule it, the writer must know what it is for —
    // a missing entry would silently fall back to "an advert with no brief".
    for (const pillar of ['educational', 'product', 'proof', 'personality', 'community']) {
      const s = spy();
      await call(s, { playbook: pillarPb(pillar) });
      expect(s.sent()).toContain(pillar.toUpperCase());
    }
  });
});

describe('the campaign objective reaches the writer', () => {
  /*
    The gap: the writer got the brand, its offer and a CTA and nothing about the
    campaign, so a post in a hiring campaign read like a post in a sales one.
    The objective chose the playbooks and stopped at the door.
  */
  it('says what a hiring campaign wants, and that it is not for a customer', async () => {
    const s = spy();
    await call(s, { objective: 'hiring' } as Partial<WriteArgs>);
    const sent = s.sent();
    expect(sent).toMatch(/goal is hiring/i);
    expect(sent).toMatch(/not for a customer/i);
  });

  it('says something different for every objective the wizard offers', async () => {
    const seen = new Set<string>();
    for (const objective of ['leads', 'bookings', 'trials', 'sales', 'audience', 'hiring']) {
      const s = spy();
      await call(s, { objective } as Partial<WriteArgs>);
      const line = s
        .sent()
        .split('\n')
        .find((l) => l.startsWith("The campaign's goal"));
      expect(line, objective).toBeTruthy();
      seen.add(line!);
    }
    // Six distinct briefs, not one sentence with the word swapped — otherwise
    // the objective is decoration.
    expect(seen.size).toBe(6);
  });

  it('says nothing about a campaign when the post belongs to none', async () => {
    // `content.draft`'s ad-hoc path creates posts with no campaign.
    const s = spy();
    await call(s);
    expect(s.sent()).not.toContain("The campaign's goal");
  });
});
