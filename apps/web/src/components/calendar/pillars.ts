/**
 * Pillar presentation — engine spec §6.8 Step 4.
 *
 *   *"Slots labelled by type — Craft · Team · Offer · Community."*
 *
 * The spec's labels are the *user's* vocabulary; `ContentPillar` is the
 * engine's. They are not the same words on purpose: "product" is what the mix
 * engine reasons about, "Offer" is what a barber recognises as the post that
 * asks for a booking. Mapping them in one place keeps that translation from
 * being reinvented per component with slightly different wording.
 *
 * Colour is load-bearing here rather than decorative. The whole point of Step 4
 * is that a month is judged by scanning it, so a pillar has to be identifiable
 * without reading the label.
 */

export const PILLARS = ['educational', 'product', 'proof', 'personality', 'community'] as const;
export type Pillar = (typeof PILLARS)[number];

export interface PillarStyle {
  /** What the owner sees. §6.8's vocabulary, not the engine's. */
  label: string;
  /** Solid fill, for the mix bar. */
  bar: string;
  /** Tinted chip, for a calendar slot. */
  chip: string;
  dot: string;
}

export const PILLAR_STYLE: Record<Pillar, PillarStyle> = {
  educational: {
    label: 'Teach',
    bar: 'bg-brand-purple',
    chip: 'bg-brand-purple/10 text-brand-purple border-brand-purple/25',
    dot: 'bg-brand-purple',
  },
  product: {
    // The promotional pillar. Named "Offer" because that is what it is asking
    // for, and because the 35% ceiling is easier to defend when the label is
    // honest about it.
    label: 'Offer',
    bar: 'bg-warn',
    chip: 'bg-warn/10 text-warn border-warn/25',
    dot: 'bg-warn',
  },
  proof: {
    label: 'Proof',
    bar: 'bg-success',
    chip: 'bg-success/10 text-success border-success/25',
    dot: 'bg-success',
  },
  personality: {
    label: 'Team',
    bar: 'bg-brand-pink',
    chip: 'bg-brand-pink/10 text-brand-pink border-brand-pink/25',
    dot: 'bg-brand-pink',
  },
  community: {
    label: 'Community',
    bar: 'bg-brand-cyan',
    chip: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/25',
    dot: 'bg-brand-cyan',
  },
};

const FALLBACK: PillarStyle = {
  label: 'Other',
  bar: 'bg-ink-muted',
  chip: 'bg-ink-muted/10 text-ink-muted border-ink-muted/25',
  dot: 'bg-ink-muted',
};

/**
 * Tolerates an unknown pillar rather than throwing. Pillars come back over HTTP
 * from a registry that can add one before this file knows about it, and a
 * calendar that fails to render is a worse answer than one slot labelled
 * "Other".
 */
export const pillarStyle = (pillar: string | null): PillarStyle =>
  (PILLARS as readonly string[]).includes(pillar ?? '') ? PILLAR_STYLE[pillar as Pillar] : FALLBACK;
