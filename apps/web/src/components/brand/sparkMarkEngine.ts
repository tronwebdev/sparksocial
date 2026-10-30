/**
 * The living SparkSocial mark — the drawing and everything that moves it.
 *
 * The geometry is `public/brand/spark-mark.svg`'s own (a 91 × 91 orb: a cyan
 * disc, four blurred blobs, a glass visor, two white eyes). It is drawn inline
 * rather than as an `<img>` because the eyes have to move, and because an
 * `<img>` cannot react to anything.
 *
 * ── Moods ─────────────────────────────────────────────────────────────────
 *
 * Six, approved on 30 October from the motion proposal:
 *
 *   idle      Watching. The face turns toward the cursor, blinks, glances,
 *             smiles on hover and squishes on click.
 *   thinking  Head tilted, eyes up and scanning, three dots orbiting, a shimmer
 *             across the visor. For anything SPARK is working on.
 *   success   Crouch, jump, sparkle burst, a ring of light on landing; then it
 *             keeps smiling in the prototype's green.
 *   error     Eyes squeeze, a coral flash, a hard head-shake, a sweat drop;
 *             then droopy eyes.
 *   warning   "Needs you": a startled pop, wide eyes, a "!" bubble that stays,
 *             amber pulses, eyes darting toward what is waiting.
 *   asleep    "Nothing here": slumped, slow breathing, drifting z's, one eye
 *             peeking now and then. Empty states.
 *
 * Each mood has a reaction that plays once when the mood arrives and a quieter
 * loop while it lasts. With `prefers-reduced-motion`, nothing moves: the eyes
 * still change shape and the colours still change, so the meaning survives.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * One `requestAnimationFrame` loop for every mark on the page, running only
 * while at least one is mounted, and skipping marks that are off screen. A
 * calendar month draws a dozen small marks; they cost attribute writes, not
 * layout.
 */

export type SparkMood = 'idle' | 'thinking' | 'success' | 'error' | 'warning' | 'asleep';

const R = 4.5476; // eye radius
const K = 0.5523; // circle as four cubics
const EYE = { L: [30.9244, 44.9582], R: [61.8475, 44.9582] } as const;
const C: readonly [number, number] = [45.4761, 45.4761];
const PIVOT: readonly [number, number] = [45.4761, 72];
const BLOB_BASE: ReadonlyArray<readonly [number, number]> = [
  [51.0485, 37.1485],
  [36.3213, 46.4191],
  [46.5684, 63.434],
  [62.5317, 50.64],
];
const BLOB_R = [12.1891, 17.7672, 10.1698, 10.1698];

type Rgb = [number, number, number];
interface Palette {
  disc: string;
  blobs: [string, string, string, string];
  rim: string;
  visor: string;
  halo: string;
}

const PALETTE: Record<'brand' | 'success' | 'error' | 'warning' | 'calm', Palette> = {
  brand: { disc: '#6CE8FF', blobs: ['#F56BFF', '#6CE8FF', '#A341FF', '#FFFFFF'], rim: '#F56BFF', visor: '#6CE8FF', halo: '#9C7BFF' },
  success: { disc: '#61FA54', blobs: ['#DBF320', '#6CE8FF', '#61FA54', '#FFFFFF'], rim: '#61FA54', visor: '#6CE8FF', halo: '#7CF25A' },
  error: { disc: '#FF7A59', blobs: ['#FF6B8A', '#FF8A65', '#F35525', '#FFFFFF'], rim: '#F35525', visor: '#FF8A65', halo: '#FF5A4A' },
  warning: { disc: '#FFD15C', blobs: ['#FFB453', '#FFDD55', '#FF9F43', '#FFFFFF'], rim: '#FFB453', visor: '#FFC24D', halo: '#FFB040' },
  calm: { disc: '#B9C7E6', blobs: ['#D4C7F2', '#AFC9E8', '#B7A8E0', '#FFFFFF'], rim: '#B7A8E0', visor: '#AFC9E8', halo: '#B7A8E0' },
};

type EyeKind = 'dot' | 'wide' | 'happy' | 'sad' | 'closed' | 'squeeze';
type LoopKind = 'idle' | 'think' | 'glow' | 'worry' | 'alert' | 'doze';
type ReactName = 'hello' | 'boop' | 'celebrate' | 'shake' | 'alert' | 'ponder' | 'settle';

interface MoodSpec {
  label: string;
  palette: keyof typeof PALETTE;
  eye: EyeKind;
  size?: number;
  track: number;
  swirl: number;
  look?: [number, number];
  react: ReactName;
  loop: LoopKind;
}

const MOODS: Record<SparkMood, MoodSpec> = {
  idle: { label: 'SparkSocial', palette: 'brand', eye: 'dot', track: 1, swirl: 1, react: 'hello', loop: 'idle' },
  thinking: { label: 'SPARK is working', palette: 'brand', eye: 'dot', size: 0.8, track: 0.15, swirl: 3.2, look: [-2.6, -2.8], react: 'ponder', loop: 'think' },
  success: { label: 'Done', palette: 'success', eye: 'happy', track: 0.35, swirl: 1.8, react: 'celebrate', loop: 'glow' },
  error: { label: 'Something went wrong', palette: 'error', eye: 'sad', track: 0.2, swirl: 0.7, look: [0, 1.8], react: 'shake', loop: 'worry' },
  warning: { label: 'Needs your attention', palette: 'warning', eye: 'wide', track: 0.6, swirl: 1.4, react: 'alert', loop: 'alert' },
  asleep: { label: 'Nothing here yet', palette: 'calm', eye: 'closed', track: 0, swirl: 0.35, look: [0, 1], react: 'settle', loop: 'doze' },
};

export const moodLabel = (mood: SparkMood): string => MOODS[mood].label;

/* ── eye shapes: 13 points (M + four cubics), so any shape morphs into any
      other one point at a time ─────────────────────────────────────────── */
type Pt = [number, number];
const circle = (r: number): Pt[] => [
  [0, -r], [K * r, -r], [r, -K * r], [r, 0], [r, K * r], [K * r, r], [0, r],
  [-K * r, r], [-r, K * r], [-r, 0], [-r, -K * r], [-K * r, -r], [0, -r],
];
const happy = (): Pt[] => {
  const w = R * 1.3, t = -R * 1.15, i = R * 0.1, e = R * 0.66;
  return [
    [-w, e], [-w, t * 0.55], [-w * 0.55, t], [0, t], [w * 0.55, t], [w, t * 0.55], [w, e],
    [w * 0.7, i * 0.2], [w * 0.4, i], [0, i], [-w * 0.4, i], [-w * 0.7, i * 0.2], [-w, e],
  ];
};
const closed = (): Pt[] => happy().map(([x, y]) => [x, -y * 0.8 + R * 0.3]);
const sad = (side: 'L' | 'R'): Pt[] => {
  const s = side === 'L' ? -1 : 1;
  return circle(R * 0.98).map(([x, y]) => [x, Math.max(y, -R * 0.02 + s * 0.62 * x)]);
};
const squeeze = (side: 'L' | 'R'): Pt[] => {
  const s = side === 'L' ? 1 : -1;
  const a: Pt = [-R * s, -R], tip: Pt = [R * 1.05 * s, 0], b: Pt = [-R * s, R], notch: Pt = [-R * 0.05 * s, 0];
  const line = (p: Pt, q: Pt): Pt[] => [
    [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3],
    [p[0] + (2 * (q[0] - p[0])) / 3, p[1] + (2 * (q[1] - p[1])) / 3],
    q,
  ];
  return [a, ...line(a, tip), ...line(tip, b), ...line(b, notch), ...line(notch, a)];
};
function shape(kind: EyeKind, side: 'L' | 'R', size = 1): Pt[] {
  switch (kind) {
    case 'happy': return happy();
    case 'closed': return closed();
    case 'sad': return sad(side);
    case 'squeeze': return squeeze(side);
    case 'wide': return circle(R * 1.34 * size);
    default: return circle(R * size);
  }
}

/* ── small maths ───────────────────────────────────────────────────────── */
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = <T extends number[]>(a: T, b: T, t: number): T => a.map((v, i) => v + (b[i]! - v) * t) as T;
const rgb = (c: Rgb): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const outCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const inCubic = (p: number) => p * p * p;
const outBack = (p: number) => 1 + 2.9 * Math.pow(p - 1, 3) + 1.9 * Math.pow(p - 1, 2);
const f2 = (n: number) => n.toFixed(2);
function pathOf(pts: Pt[], cx: number, cy: number): string {
  const p = pts.map(([x, y]) => `${f2(cx + x)} ${f2(cy + y)}`);
  return `M${p[0]}C${p[1]} ${p[2]} ${p[3]}C${p[4]} ${p[5]} ${p[6]}C${p[7]} ${p[8]} ${p[9]}C${p[10]} ${p[11]} ${p[12]}Z`;
}
const STAR = 'M0 -4.2 1.1 -1.1 4.2 0 1.1 1.1 0 4.2 -1.1 1.1 -4.2 0 -1.1 -1.1Z';

/* ── reactions: what plays once when a mood arrives ─────────────────────── */
interface Fx {
  x?: number; y?: number; sx?: number; sy?: number; rot?: number;
  eyes?: EyeKind | null; eyePop?: number;
  burst?: number; ring?: number; halo?: number; shimmer?: number; drop?: number; bubble?: number;
}
const REACT: Record<ReactName, { ms: number; at: (t: number) => Fx }> = {
  hello: { ms: 700, at(t) {
    const w = Math.sin(seg(t, 0, 700) * Math.PI);
    return { y: -4 * w, sy: 1 + 0.04 * w, sx: 1 - 0.03 * w };
  } },
  boop: { ms: 650, at(t) {
    const p = seg(t, 0, 650);
    const w = Math.exp(-5 * p) * Math.cos(p * 18);
    return { sy: 1 - 0.18 * w, sx: 1 + 0.14 * w, eyes: p < 0.85 ? 'happy' : null, halo: 0.5 * (1 - p) };
  } },
  celebrate: { ms: 1500, at(t) {
    let y = 0, sx = 1, sy = 1, rot = 0;
    if (t < 140) { const e = outCubic(t / 140); sy = 1 - 0.18 * e; sx = 1 + 0.14 * e; }
    else if (t < 470) { const p = seg(t, 140, 470); y = -20 * outCubic(p); sy = 1.12 - 0.12 * p; sx = 0.9 + 0.1 * p; rot = 8 * Math.sin(p * Math.PI); }
    else if (t < 650) { const p = seg(t, 470, 650); y = -20 + 20 * inCubic(p); sy = 1 + 0.08 * p; sx = 1 - 0.06 * p; }
    else if (t < 820) { const w = Math.sin(seg(t, 650, 820) * Math.PI); sy = 1 - 0.14 * w; sx = 1 + 0.12 * w; }
    else if (t < 1150) { y = -7 * Math.sin(seg(t, 820, 1150) * Math.PI); }
    return {
      y, sx, sy, rot,
      burst: t > 360 ? seg(t, 360, 1260) : -1,
      ring: t > 640 ? seg(t, 640, 1340) : -1,
      halo: t > 360 ? 0.9 * (1 - seg(t, 360, 1500)) : 0,
      shimmer: seg(t, 200, 900),
    };
  } },
  shake: { ms: 1700, at(t) {
    const p = seg(t, 220, 1100);
    const w = t > 220 ? Math.sin(p * Math.PI * 9) * Math.exp(-2.6 * p) : 0;
    const pre = t < 220 ? outCubic(t / 220) : 1 - seg(t, 220, 400);
    return {
      x: 7.5 * w, rot: 9 * w, sy: 1 - 0.08 * pre, sx: 1 + 0.05 * pre,
      eyes: t < 520 ? 'squeeze' : null,
      ring: seg(t, 0, 600), halo: 0.95 * (1 - seg(t, 0, 900)),
      drop: t > 900 ? seg(t, 900, 1700) : -1,
    };
  } },
  alert: { ms: 1300, at(t) {
    let y = 0, sx = 1, sy = 1;
    if (t < 150) { const e = outCubic(t / 150); y = 3 * e; sy = 1 - 0.08 * e; sx = 1 + 0.06 * e; }
    else if (t < 420) { const e = outCubic(seg(t, 150, 420)); y = 3 - 14 * e; sy = 0.92 + 0.16 * e; sx = 1.06 - 0.1 * e; }
    else { const p = seg(t, 420, 1100); const w = Math.exp(-4 * p) * Math.cos(p * 14); y = -11 * w; sy = 1 + 0.06 * w; sx = 1 - 0.05 * w; }
    return {
      y, sx, sy, eyePop: t > 150 && t < 700 ? 1.18 : 1,
      bubble: t > 260 ? outBack(seg(t, 260, 620)) : 0,
      ring: seg(t, 180, 900), halo: 0.8 * (1 - seg(t, 180, 1300)),
    };
  } },
  ponder: { ms: 800, at(t) {
    const p = seg(t, 0, 800);
    return { rot: -8 * outBack(p) + 2 * p, y: -2 * Math.sin(p * Math.PI) };
  } },
  settle: { ms: 1200, at(t) {
    const p = outCubic(seg(t, 0, 1200));
    return { y: 3.5 * p, sy: 1 - 0.05 * p, sx: 1 + 0.03 * p, rot: -4 * p };
  } },
};

/* ── the drawing ───────────────────────────────────────────────────────── */

/**
 * The mark's markup, fully drawn for `mood` at rest — so the server render and
 * a reduced-motion visitor both see a finished mark before any script runs.
 *
 * `id` must be unique on the page: the masks, filters and gradients are
 * referenced by id, and two marks sharing one would draw each other's colours.
 */
export function markSvg(id: string, mood: SparkMood): string {
  const m = MOODS[mood];
  const pal = PALETTE[m.palette];
  const look = m.look ?? [0, 0];
  const eye = (side: 'L' | 'R') => pathOf(shape(m.eye, side, m.size ?? 1), EYE[side][0] + look[0] * 0.5, EYE[side][1] + look[1] * 0.5);
  const blobs = BLOB_BASE.map(([x, y], i) => `<circle class="b${i}" cx="${x}" cy="${y}" r="${BLOB_R[i]}" fill="${pal.blobs[i]}"/>`).join('');
  const parts = Array.from({ length: 12 }, (_, i) =>
    i % 2 ? '<g class="pt" opacity="0"><circle r="2.1"/></g>' : `<g class="pt" opacity="0"><path d="${STAR}"/></g>`,
  ).join('');
  return `<svg viewBox="0 0 91 91" width="100%" height="100%" aria-hidden="true" focusable="false" style="overflow:visible;display:block">
<defs>
<mask id="${id}m" maskUnits="userSpaceOnUse" x="-20" y="-20" width="131" height="131"><circle cx="45.4761" cy="45.4761" r="43.2023" fill="#fff"/></mask>
<filter id="${id}in" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="a"/><feMorphology radius="5" operator="erode" in="SourceAlpha" result="e"/><feGaussianBlur in="e" stdDeviation="6.95" result="b"/><feComposite in="a" in2="b" operator="arithmetic" k2="1" k3="-1" result="ring"/><feColorMatrix in="ring" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.84 0" result="glow"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="glow"/></feMerge></filter>
<filter id="${id}bl" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10.15"/></filter>
<filter id="${id}hl" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="${id}vi" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="a"/><feMorphology radius="1.5" operator="dilate" in="SourceAlpha" result="d"/><feGaussianBlur in="d" stdDeviation="4.23" result="b"/><feComposite in="b" in2="a" operator="arithmetic" k2="-1" k3="1" result="ring"/><feFlood class="vglow" flood-color="${pal.visor}" result="tint"/><feComposite in="tint" in2="ring" operator="in" result="glow"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="glow"/></feMerge></filter>
<linearGradient id="${id}rim" x1="31.43" y1="33.67" x2="37.31" y2="61.2" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".6"/><stop offset=".5" stop-color="#F49173" stop-opacity=".2"/><stop offset="1" class="rimstop" stop-color="${pal.rim}"/></linearGradient>
<linearGradient id="${id}sh" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}vc"><rect x="18.1216" y="33.6748" width="55.5439" height="22.5178" rx="11.2589"/></clipPath>
</defs>
<circle class="halo" cx="45.4761" cy="47" r="36" fill="${pal.halo}" opacity="0.16" filter="url(#${id}hl)"/>
<circle class="ring" cx="45.4761" cy="45.4761" r="44" fill="none" stroke="${pal.rim}" opacity="0"/>
<g class="rig">
<g class="orbit" opacity="0"><circle r="2.6" fill="#6CE8FF"/><circle r="2.1" fill="#F56BFF"/><circle r="1.7" fill="#A341FF"/></g>
<g mask="url(#${id}m)"><circle class="disc" cx="45.4761" cy="45.4761" r="45.4761" fill="${pal.disc}" fill-opacity=".2" filter="url(#${id}in)"/><g class="blobs" filter="url(#${id}bl)">${blobs}</g></g>
<g class="face"><g filter="url(#${id}vi)"><rect x="18.1216" y="33.6748" width="55.5439" height="22.5178" rx="11.2589" fill="#fff" fill-opacity=".07"/><rect x="17.7463" y="33.2995" width="56.2945" height="23.2684" rx="11.6342" fill="none" stroke="url(#${id}rim)" stroke-width=".75"/></g><g clip-path="url(#${id}vc)"><rect class="shimmer" x="-30" y="28" width="14" height="34" fill="url(#${id}sh)" transform="skewX(-22)" opacity="0"/></g><path class="eyeL" fill="#fff" d="${eye('L')}"/><path class="eyeR" fill="#fff" d="${eye('R')}"/></g>
<path class="drop" d="M0 -5.5C2.6 -1.4 3.8 1.2 3.8 2.9A3.8 3.8 0 0 1 -3.8 2.9C-3.8 1.2 -2.6 -1.4 0 -5.5Z" fill="#8FE0FF" stroke="#fff" stroke-width=".6" opacity="0"/>
<g class="bubble" opacity="${mood === 'warning' ? 1 : 0}" transform="translate(82 4) scale(.95)"><path d="M0 -10a10 10 0 1 1 -6.2 17.9L-11 10l2.6-5A10 10 0 0 1 0 -10Z" fill="#FFD15C" stroke="#fff" stroke-width="1"/><text x="0" y="4.6" text-anchor="middle" style="font:800 13px system-ui,sans-serif" fill="#0C0C0C">!</text></g>
<g class="burst">${parts}</g>
${[0, 1, 2].map((i) => `<text class="zz" opacity="${mood === 'asleep' ? (0.5 - i * 0.12).toFixed(2) : 0}" transform="translate(${74 + i * 4} ${20 - i * 8}) scale(${0.8 + i * 0.2})" style="font:700 13px system-ui,sans-serif" fill="#8E8AA6">z</text>`).join('')}
</g>
</svg>`;
}

/* ── one mark, alive ───────────────────────────────────────────────────── */

export interface MarkOptions {
  size: number;
  mood: SparkMood;
  /** Turn toward the cursor. Defaults to on at 48px and up. */
  track: boolean;
  /** Smile on hover, squish on click. */
  interactive: boolean;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

class LiveMark {
  // Assigned in the constructor rather than as field initialisers: those would
  // read `this.el` before a parameter property is set, depending on how class
  // fields are compiled.
  private rig: SVGGElement;
  private face: SVGGElement;
  private blobsG: SVGGElement;
  private eyeEls: Record<'L' | 'R', SVGPathElement>;
  private disc: SVGCircleElement;
  private rim: SVGStopElement;
  private vglow: SVGFEFloodElement;
  private halo: SVGCircleElement;
  private ring: SVGCircleElement;
  private orbit: SVGGElement;
  private orbitDots: SVGCircleElement[];
  private shimmer: SVGRectElement;
  private drop: SVGPathElement;
  private bubble: SVGGElement;
  private parts: SVGGElement[];
  private zz: SVGTextElement[];
  private blobs: SVGCircleElement[];

  private phase = Math.random() * 100;
  private off: [number, number] = [0, 0];
  private blink = 1;
  private nextBlink = performance.now() + 900 + Math.random() * 2500;
  private glance: [number, number] = [0, 0];
  private glanceUntil = 0;
  private dart = -1e9;
  private nextDart = performance.now() + 1800;
  private peek = -1e9;
  private nextPeek = performance.now() + 4000 + Math.random() * 3000;
  private hover = false;
  private react: { name: ReactName; t0: number } | null = null;
  private pts: Record<'L' | 'R', Pt[]>;
  private colors: { disc: Rgb; rim: Rgb; visor: Rgb; halo: Rgb; blobs: Rgb[] };
  visible = true;

  el: HTMLElement;
  opts: MarkOptions;

  constructor(el: HTMLElement, opts: MarkOptions) {
    this.el = el;
    this.opts = opts;
    const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
    const qa = <T extends Element>(sel: string) => [...el.querySelectorAll<T>(sel)];
    this.rig = q('.rig');
    this.face = q('.face');
    this.blobsG = q('.blobs');
    this.eyeEls = { L: q('.eyeL'), R: q('.eyeR') };
    this.disc = q('.disc');
    this.rim = q('.rimstop');
    this.vglow = q('.vglow');
    this.halo = q('.halo');
    this.ring = q('.ring');
    this.orbit = q('.orbit');
    this.orbitDots = qa('.orbit circle');
    this.shimmer = q('.shimmer');
    this.drop = q('.drop');
    this.bubble = q('.bubble');
    this.parts = qa('.pt');
    this.zz = qa('.zz');
    this.blobs = [0, 1, 2, 3].map((i) => q<SVGCircleElement>(`.b${i}`));
    const m = MOODS[opts.mood];
    this.pts = { L: shape(m.eye, 'L', m.size ?? 1), R: shape(m.eye, 'R', m.size ?? 1) };
    this.colors = colorsOf(m.palette);
    // The first mood arrives quietly: a page full of marks should not all jump
    // on load. Changes after this play their reaction.
    if (opts.mood !== 'idle') this.play(m.react);
  }

  setMood(mood: SparkMood) {
    if (mood === this.opts.mood) return;
    this.opts.mood = mood;
    this.play(MOODS[mood].react);
  }
  play(name: ReactName) { this.react = { name, t0: performance.now() }; }
  onEnter() { this.hover = true; }
  onLeave() { this.hover = false; }
  onClick() { if (this.opts.interactive) this.play('boop'); }

  frame(now: number, pointer: [number, number] | null, still: boolean) {
    const o = this.opts;
    const m = MOODS[o.mood];

    let fx: Fx = {};
    if (this.react) {
      const r = REACT[this.react.name];
      const t = now - this.react.t0;
      if (t > r.ms) this.react = null;
      else fx = still ? { eyes: r.at(t).eyes ?? null } : r.at(t);
    }

    // ── where the eyes look ──
    let target: [number, number] = [0, 0];
    if (o.track && pointer && m.track > 0) {
      const r = this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.49;
      const dx = pointer[0] - cx, dy = pointer[1] - cy;
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / (r.width * 1.6));
      target = [(dx / d) * reach * 6.6 * m.track, (dy / d) * reach * 3.8 * m.track];
    } else if (!still && o.mood === 'idle' && o.track) {
      if (now > this.glanceUntil) {
        this.glance = Math.random() < 0.45 ? [0, 0] : [(Math.random() * 2 - 1) * 6, (Math.random() * 2 - 1) * 3];
        this.glanceUntil = now + 1200 + Math.random() * 2400;
      }
      target = this.glance;
    }
    if (m.look) target = [target[0] + m.look[0], target[1] + m.look[1]];
    if (!still && m.loop === 'think') target[0] += Math.sin(now / 430) * 3.6;
    const darting = seg(now, this.dart, this.dart + 900);
    if (!still && m.loop === 'alert') {
      if (now > this.nextDart) { this.dart = now; this.nextDart = now + 2200 + Math.random() * 1200; }
      if (darting > 0 && darting < 1) target[0] += 6 * Math.sin(darting * Math.PI);
    }
    this.off = mix(this.off, target, 0.17);

    // ── blinking and peeking ──
    const kind: EyeKind = fx.eyes ?? (this.hover && o.interactive && o.mood === 'idle' ? 'happy' : m.eye);
    if (kind === 'dot' || kind === 'wide' || kind === 'sad') {
      if (now > this.nextBlink) {
        const t = (now - this.nextBlink) / 160;
        this.blink = t < 1 ? 1 - Math.sin(t * Math.PI) * 0.92 : 1;
        if (t >= 1) this.nextBlink = now + (Math.random() < 0.22 ? 180 : 2200 + Math.random() * 3200);
      }
    } else this.blink = 1;
    let peekL = false;
    if (!still && m.loop === 'doze') {
      if (now > this.nextPeek) { this.peek = now; this.nextPeek = now + 6500 + Math.random() * 3000; }
      peekL = now - this.peek < 1100;
    }

    // ── eyes ──
    const pop = fx.eyePop ?? 1;
    for (const side of ['L', 'R'] as const) {
      const goal = side === 'L' && peekL ? shape('dot', 'L', 0.7) : shape(kind, side, m.size ?? 1);
      this.pts[side] = this.pts[side].map((p, i) => mix(p, goal[i]!, 0.24));
      const pts = this.pts[side].map(([x, y]): Pt => [x * pop, y * this.blink * pop]);
      this.eyeEls[side].setAttribute('d', pathOf(pts, EYE[side][0] + this.off[0] * 0.5, EYE[side][1] + this.off[1] * 0.5));
    }

    // ── head-turn ──
    this.face.setAttribute('transform', `translate(${f2(this.off[0] * 0.75)} ${f2(this.off[1] * 0.7)})`);
    this.blobsG.setAttribute('transform', `translate(${f2(-this.off[0] * 0.45)} ${f2(-this.off[1] * 0.4)})`);

    // ── body ──
    let x = fx.x ?? 0, y = fx.y ?? 0, sx = fx.sx ?? 1, sy = fx.sy ?? 1, rot = fx.rot ?? 0;
    if (!still) {
      if (m.loop === 'doze') {
        const b = Math.sin(now / 1100);
        sy *= 1 + 0.035 * b; sx *= 1 - 0.02 * b; y += 1.2 * b; rot += -4;
      } else {
        const b = Math.sin(now / 640 + this.phase);
        sy *= 1 + 0.014 * b; sx *= 1 - 0.006 * b;
      }
      if (m.loop === 'think') rot += -4 + 2.5 * Math.sin(now / 900);
      if (m.loop === 'glow') y += -1.4 * Math.abs(Math.sin(now / 520));
      if (m.loop === 'alert' && darting > 0 && darting < 1) rot += 3 * Math.sin(now / 300);
      rot += this.off[0] * 0.8;
    }
    const [px, py] = PIVOT;
    this.rig.setAttribute(
      'transform',
      `translate(${f2(x + px)} ${f2(y + py)}) rotate(${f2(rot)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-px} ${-py})`,
    );

    // ── colours drift toward the mood ──
    const goal = colorsOf(m.palette);
    const c = this.colors;
    c.disc = mix(c.disc, goal.disc, 0.07);
    c.rim = mix(c.rim, goal.rim, 0.07);
    c.visor = mix(c.visor, goal.visor, 0.07);
    c.halo = mix(c.halo, goal.halo, 0.07);
    c.blobs = c.blobs.map((v, i) => mix(v, goal.blobs[i]!, 0.07));
    this.disc.setAttribute('fill', rgb(c.disc));
    this.rim.setAttribute('stop-color', rgb(c.rim));
    this.vglow.setAttribute('flood-color', rgb(c.visor));
    this.halo.setAttribute('fill', rgb(c.halo));
    this.ring.setAttribute('stroke', rgb(c.rim));

    // ── the colours inside swirl ──
    if (!still) this.phase += m.swirl * 0.014;
    this.blobs.forEach((b, i) => {
      const [bx, by] = BLOB_BASE[i]!;
      const a = this.phase * (0.8 + i * 0.23) + i * 1.7;
      const amp = still ? 0 : 3.6;
      b.setAttribute('cx', f2(bx + Math.cos(a) * amp));
      b.setAttribute('cy', f2(by + Math.sin(a * 1.13) * amp));
      b.setAttribute('fill', rgb(c.blobs[i]!));
    });

    // ── halo and ring ──
    const base =
      m.loop === 'glow' ? 0.4 + 0.12 * Math.sin(now / 500)
      : m.loop === 'alert' ? 0.28 + 0.22 * Math.max(0, Math.sin(now / 260)) * (Math.sin(now / 1600) > 0.6 ? 1 : 0)
      : m.loop === 'worry' ? 0.3 : 0.16;
    this.halo.setAttribute('opacity', Math.min(1, (still ? 0.25 : base) + (fx.halo ?? 0)).toFixed(3));
    const rp = fx.ring ?? -1;
    if (rp >= 0 && rp < 1) {
      this.ring.setAttribute('r', f2(44 + 22 * outCubic(rp)));
      this.ring.setAttribute('stroke-width', f2(3.2 * (1 - rp) + 0.4));
      this.ring.setAttribute('opacity', (0.75 * (1 - rp)).toFixed(3));
    } else this.ring.setAttribute('opacity', '0');

    // ── sparkle burst ──
    const bp = fx.burst ?? -1;
    this.parts.forEach((p, i) => {
      if (bp < 0 || bp >= 1) { p.setAttribute('opacity', '0'); return; }
      const a = (i / 12) * Math.PI * 2 + (i % 3) * 0.21;
      const dist = 34 + (16 + (i % 3) * 7) * outCubic(bp);
      const op = bp < 0.12 ? bp / 0.12 : 1 - (bp - 0.12) / 0.88;
      const s = (i % 2 ? 1 : 1.25) * (1 - bp * 0.45);
      p.setAttribute('transform', `translate(${f2(C[0] + Math.cos(a) * dist)} ${f2(C[1] + Math.sin(a) * dist)}) rotate(${(bp * 200).toFixed(1)}) scale(${s.toFixed(2)})`);
      p.setAttribute('opacity', op.toFixed(3));
      p.setAttribute('fill', rgb(c.blobs[i % 3]!));
    });

    // ── visor shimmer ──
    const sh = fx.shimmer ?? (m.loop === 'think' && !still ? (now % 1700) / 1700 : -1);
    if (sh >= 0 && sh < 1) {
      this.shimmer.setAttribute('x', f2(-6 + 112 * sh));
      this.shimmer.setAttribute('opacity', Math.sin(sh * Math.PI).toFixed(3));
    } else this.shimmer.setAttribute('opacity', '0');

    // ── orbiting dots ──
    if (m.loop === 'think' && !still) {
      this.orbit.setAttribute('opacity', '1');
      this.orbitDots.forEach((d, i) => {
        const a = now / 520 + i * 0.55;
        d.setAttribute('cx', f2(C[0] + Math.cos(a) * 50));
        d.setAttribute('cy', f2(C[1] + Math.sin(a) * 18 - 2));
        d.setAttribute('opacity', Math.sin(a) > 0 ? '1' : '0.25');
      });
    } else this.orbit.setAttribute('opacity', '0');

    // ── sweat drop ──
    const dp = fx.drop ?? -1;
    if (dp >= 0 && dp < 1) {
      this.drop.setAttribute('transform', `translate(${f2(78 + 2 * dp)} ${f2(18 + 22 * dp * dp)}) scale(${f2(0.6 + 0.6 * Math.min(1, dp * 3))})`);
      this.drop.setAttribute('opacity', (dp < 0.15 ? dp / 0.15 : 1 - (dp - 0.15) / 0.85).toFixed(3));
    } else this.drop.setAttribute('opacity', '0');

    // ── "!" bubble ──
    if (o.mood === 'warning') {
      const s = fx.bubble ?? 1;
      const wob = still ? 0 : 6 * Math.sin(now / 280) * (Math.sin(now / 1600) > 0.6 ? 1 : 0.15);
      this.bubble.setAttribute('transform', `translate(82 4) rotate(${wob.toFixed(1)}) scale(${(0.95 * s).toFixed(3)})`);
      this.bubble.setAttribute('opacity', String(Math.min(1, s * 1.4)));
    } else this.bubble.setAttribute('opacity', '0');

    // ── z's ──
    this.zz.forEach((z, i) => {
      if (m.loop !== 'doze') { z.setAttribute('opacity', '0'); return; }
      const p = still ? 0.4 + i * 0.15 : (now / 2700 + i / 3) % 1;
      z.setAttribute('transform', `translate(${f2(70 + 14 * p)} ${f2(26 - 26 * p)}) scale(${f2(0.6 + 0.7 * p)})`);
      z.setAttribute('opacity', (Math.sin(p * Math.PI) * 0.95).toFixed(3));
    });
  }
}

function colorsOf(name: keyof typeof PALETTE) {
  const p = PALETTE[name];
  return { disc: hex(p.disc), rim: hex(p.rim), visor: hex(p.visor), halo: hex(p.halo), blobs: p.blobs.map(hex) };
}

/* ── the shared loop ───────────────────────────────────────────────────── */

const live = new Set<LiveMark>();
let raf = 0;
let pointer: [number, number] | null = null;
let lastMove = 0;
let observer: IntersectionObserver | null = null;
let listening = false;

function onMove(e: PointerEvent) {
  pointer = [e.clientX, e.clientY];
  lastMove = performance.now();
}
function onLeave() {
  pointer = null;
}

function tick(now: number) {
  // A cursor that has not moved for a while stops being something to look at.
  const p = pointer && now - lastMove < 6000 ? pointer : null;
  const still = reducedMotion();
  for (const m of live) if (m.visible) m.frame(now, p, still);
  raf = live.size ? requestAnimationFrame(tick) : 0;
}

/** Brings `el` (already holding `markSvg` markup) to life. Returns the handle. */
export function attachMark(el: HTMLElement, opts: MarkOptions) {
  const mark = new LiveMark(el, { ...opts });
  live.add(mark);
  if (!listening) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    listening = true;
  }
  if (typeof IntersectionObserver !== 'undefined') {
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        for (const m of live) if (m.el === entry.target) m.visible = entry.isIntersecting;
      }
    });
    observer.observe(el);
  }
  const enter = () => mark.onEnter();
  const leave = () => mark.onLeave();
  const click = () => mark.onClick();
  el.addEventListener('pointerenter', enter);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('click', click);
  if (!raf) raf = requestAnimationFrame(tick);

  return {
    setMood: (mood: SparkMood) => mark.setMood(mood),
    setOptions: (next: Partial<MarkOptions>) => { Object.assign(mark.opts, next); },
    detach: () => {
      live.delete(mark);
      observer?.unobserve(el);
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('click', click);
      if (!live.size && listening) {
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('mouseleave', onLeave);
        listening = false;
      }
    },
  };
}
