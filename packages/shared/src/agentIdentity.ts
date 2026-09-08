/**
 * THE AGENT'S IDENTITY — `F4`, the thing the prototypes show and the build had
 * no record of.
 *
 * The Command Center prototype puts a named agent at the top of the screen with
 * a voice descriptor and a risk tolerance, onboarding asks you to *name your
 * agent*, and the campaign wizard's review step says "here's what **{name}**
 * will do". None of that had anywhere to come from: `AgentName` in
 * `packages/spark/src/agents.ts` is an internal union — `spark`, `curator`,
 * `producer` — not something a person names or reads.
 *
 * ── One stored field, two derived ones ────────────────────────────────────
 *
 * Only the **name** is stored. The voice descriptor and the risk tolerance are
 * computed from settings that already exist and are already enforced, and that
 * is deliberate rather than lazy.
 *
 * A stored voice descriptor would be a second copy of `toneVector` — the vector
 * the copy writer actually reads on every draft — free to drift from it. Then
 * the screen would say "Formal, Technical" while the drafts came out playful,
 * and the screen would be the thing people believed.
 *
 * A stored risk tolerance would be worse: a dial that reads like a control and
 * enforces nothing. `approvalMode` is the real risk posture, it is enforced by
 * `policy.ts`, and rendering it in the prototype's words costs nothing and
 * cannot disagree with itself.
 */

export interface ToneVector {
  formal: number;
  playful: number;
  technical: number;
  bold: number;
}

export type ApprovalMode = 'autopublish' | 'review_first_week' | 'review_everything';

export interface AgentIdentity {
  /** What the owner called it, or a fallback that does not pretend to be a name. */
  name: string;
  /** True when `name` is the fallback rather than something a person chose. */
  named: boolean;
  /** Two or three adjectives, derived from `toneVector`. */
  voice: string[];
  riskTolerance: 'Low' | 'Moderate' | 'High';
  /** Why the risk tolerance reads the way it does — it is a rendering, not a dial. */
  riskBecause: string;
}

/**
 * Shown when nobody has named it. Not a name, and deliberately not styled as
 * one — no bold, no accent colour, nothing that implies somebody chose it.
 *
 * Two forms, because this phrase lands in two grammatical positions and a
 * single one is wrong in the other: "Your agent" heads a card, and
 * "…assigning this campaign to your agent" sits mid-sentence. The campaign
 * wizard had its own lowercase literal for the second case, which then
 * disagreed in case with the value this module hands back once the fetch
 * lands — the label visibly changed capitalisation on load. Both live here so
 * there is one place that decides.
 */
export const UNNAMED_AGENT = 'Your agent';

/** {@link UNNAMED_AGENT}, for mid-sentence use. */
export const UNNAMED_AGENT_INLINE = 'your agent';

/**
 * The axes, as words.
 *
 * Only decisive values contribute. A slider at the midpoint is the absence of a
 * preference, and reporting "Balanced, Balanced, Balanced" from four untouched
 * sliders would dress up having configured nothing as having configured
 * something — the failure this whole file is trying to avoid.
 */
const AXES: Array<{ key: keyof ToneVector; high: string; low: string }> = [
  { key: 'formal', high: 'Formal', low: 'Casual' },
  { key: 'playful', high: 'Playful', low: 'Serious' },
  { key: 'technical', high: 'Technical', low: 'Plain-spoken' },
  { key: 'bold', high: 'Bold', low: 'Measured' },
];

/** Beyond this distance from the midpoint, a slider is saying something. */
const DECISIVE = 0.15;

export function voiceWords(tone: ToneVector | undefined): string[] {
  if (!tone) return [];

  return AXES.flatMap(({ key, high, low }) => {
    const v = tone[key];
    if (typeof v !== 'number') return [];
    if (v >= 0.5 + DECISIVE) return [high];
    if (v <= 0.5 - DECISIVE) return [low];
    return [];
  });
}

/**
 * `approvalMode` in the prototype's vocabulary.
 *
 * The mapping is the honest one: how much this agent may do without a person
 * looking *is* its risk tolerance, and it is enforced in `policy.ts` rather than
 * described here.
 */
export function riskTolerance(mode: ApprovalMode | undefined): { level: AgentIdentity['riskTolerance']; because: string } {
  switch (mode) {
    case 'autopublish':
      return { level: 'High', because: 'it publishes without waiting for you' };
    case 'review_everything':
      return { level: 'Low', because: 'every post waits for your approval' };
    case 'review_first_week':
    default:
      // The default for a new brand, so this is the branch most brands are on.
      return { level: 'Moderate', because: 'it publishes on its own once the first week is reviewed' };
  }
}

export function agentIdentity(args: {
  agentName?: string | null;
  toneVector?: ToneVector | undefined;
  approvalMode?: ApprovalMode | undefined;
}): AgentIdentity {
  const trimmed = args.agentName?.trim();
  const risk = riskTolerance(args.approvalMode);

  return {
    name: trimmed || UNNAMED_AGENT,
    named: Boolean(trimmed),
    voice: voiceWords(args.toneVector),
    riskTolerance: risk.level,
    riskBecause: risk.because,
  };
}
