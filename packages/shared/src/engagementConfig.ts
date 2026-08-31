import { z } from 'zod';

/**
 * THE FIVE ENGAGEMENT-INTELLIGENCE SCREENS, AS DATA — `4.3`.
 *
 * `Settings WS EI Autonomy / Platforms / Boundaries / Voice / Sales` draw five
 * steps. Three of them had storage; two did not, and four individual fields had
 * no column at all: the hard rules, the escalation behaviour, the engagement
 * voice sliders, and the emoji level.
 *
 * ── Why they had none ─────────────────────────────────────────────────────
 *
 * Those screens were built panel-by-panel against columns that already existed
 * rather than screen-by-screen against the design. The engagement work added the
 * columns that had a *runtime consumer* — sales handoff, escalation keywords,
 * autonomy — and the panel was assembled from those. Each of these four would
 * have needed a column *and* an enforcement point, and nothing forced the
 * question: the design files are static markup with no bindings, so a screen can
 * draw a control for months without anybody noticing it has nothing behind it.
 *
 * That is the same mechanism that produced the four settings that stored a value
 * and changed no behaviour. These never even got as far as a column, which is why
 * every vocabulary here arrives with its enforcement named beside it.
 */

/* ── Hard rules ────────────────────────────────────────────────────────── */

/**
 * `Settings WS EI Boundaries`' five checkboxes.
 *
 * Four of the five are **prohibitions in the reply writer's prompt** — the same
 * mechanism `salesQualification` uses, which is the one that works: a model given
 * no instruction about pricing will sometimes discuss pricing, and silence is not
 * a constraint.
 *
 * The fifth is different and is the reason this needed thought rather than a
 * column. `never_auto_reply_to_complaints` is not something a prompt can enforce,
 * because by the time the prompt runs the decision to reply unattended has
 * already been taken. It is enforced as an **escalation trigger** instead: with
 * the rule on, a message carrying a complaint marker routes to a person through
 * the escalation path that already exists, rather than being auto-handled. One
 * enforcement point, reusing the mechanism that is already deterministic and
 * already tested, instead of inventing a second gate that could disagree with it.
 */
export const HardRule = z.enum([
  'never_discuss_pricing',
  'never_promise_results',
  'never_auto_reply_to_complaints',
  'never_argue',
  'never_discuss_legal_or_medical',
]);
export type HardRule = z.infer<typeof HardRule>;

/**
 * What each prompt-enforced rule tells the writer, in words.
 *
 * Spelled out rather than passed as enum values, for the same reason as the sales
 * options: `never_promise_results` tells a model almost nothing, and a rule the
 * model has to interpret is a rule it will interpret loosely.
 *
 * `never_auto_reply_to_complaints` is deliberately absent from this map — it is
 * not a prompt instruction, and putting it here would make it look enforced twice
 * while actually being enforced once, in the weaker place.
 */
export const HARD_RULE_INSTRUCTION: Partial<Record<HardRule, string>> = {
  never_discuss_pricing:
    'Never state, quote, estimate or hint at a price, a discount, or what something costs. If asked, say somebody will follow up with figures.',
  never_promise_results:
    'Never promise an outcome, a result, a timeframe or a guarantee — not even a hedged one. Describe what you do, not what it will achieve.',
  never_argue:
    'Never contradict, correct or push back on the person, however wrong they are. Acknowledge and hand over.',
  never_discuss_legal_or_medical:
    'Never give legal or medical information, opinion or reassurance, even generally. Say it needs a qualified person.',
};

/**
 * Complaint markers for `never_auto_reply_to_complaints`.
 *
 * Deterministic and deliberately blunt. This runs on the hot path of every
 * inbound message, and the alternative — asking the classifier whether something
 * is a complaint — puts a model in the position of deciding whether a model may
 * reply, which is the wrong shape: an unhappy customer is exactly the case where
 * a false negative is expensive and a false positive costs one human glance.
 *
 * Matched the same way the brand's own escalation keywords are, so a brand can
 * extend this list simply by adding words there.
 */
export const COMPLAINT_MARKERS: readonly string[] = [
  'complaint',
  'complain',
  'refund',
  'terrible',
  'awful',
  'worst',
  'disappointed',
  'disappointing',
  'unacceptable',
  'never again',
  'waste of money',
  'rude',
  'ignored me',
  'still waiting',
];

/**
 * Whether this message must go to a person because of the complaints rule.
 *
 * Pure, so it is testable without a store and cheap enough to run on every
 * inbound message. Substring matching on a lowercased haystack — a complaint does
 * not respect word boundaries ("complaining", "refunded") and the cost of a
 * broader match here is a human reading one extra message.
 */
export function tripsComplaintRule(rules: readonly string[] | undefined, text: string): boolean {
  if (!rules?.includes('never_auto_reply_to_complaints')) return false;
  const haystack = text.toLowerCase();
  return COMPLAINT_MARKERS.some((m) => haystack.includes(m));
}

/* ── Escalation behaviour ──────────────────────────────────────────────── */

/**
 * `Settings WS EI Boundaries`' three escalation options.
 *
 * These describe what happens *after* SPARK decides a human is needed, which is
 * why they are one column rather than three: they are mutually exclusive
 * treatments of the same moment.
 *
 *   `hold`          — record it and wait. The quietest, and the default, because
 *                     it is the only one that cannot interrupt somebody.
 *   `notify`        — record it and raise a high-urgency notification, which now
 *                     has a reader (`human.notifications`).
 *   `draft_no_send` — write the reply so it is ready, and do not send it. The
 *                     most useful and the most expensive: it spends a model call
 *                     on something a person may discard.
 */
export const EscalationBehavior = z.enum(['hold', 'notify', 'draft_no_send']);
export type EscalationBehavior = z.infer<typeof EscalationBehavior>;

export const DEFAULT_ESCALATION_BEHAVIOR: EscalationBehavior = 'hold';

export const ESCALATION_BEHAVIOR_WORDS: Record<EscalationBehavior, string> = {
  hold: 'Hold for review',
  notify: 'Notify me immediately',
  draft_no_send: "Draft a reply but don't send it",
};

/* ── Engagement voice ──────────────────────────────────────────────────── */

/**
 * `Settings WS EI Voice`'s three sliders — and note they are **not**
 * `brands.tone_vector`.
 *
 * That one has four axes (formal, playful, technical, bold) and governs the whole
 * brand's written output. The design's engagement sliders are three different
 * axes: formal↔casual, professional↔friendly, direct↔warm. They overlap without
 * matching, and mapping one onto the other would mean either dropping an axis or
 * inventing a correspondence nobody chose.
 *
 * So this is its own column, and it is **optional** in a specific way: the screen
 * offers "use my brand voice (recommended)" alongside "customize", and absent
 * here means the first. A brand that has not opted in gets `tone_vector`, which is
 * what every reply used before this existed.
 */
export const EngagementTone = z.object({
  /** 0 = formal, 1 = casual. */
  casual: z.number().min(0).max(1),
  /** 0 = professional, 1 = friendly. */
  friendly: z.number().min(0).max(1),
  /** 0 = direct, 1 = warm. */
  warm: z.number().min(0).max(1),
});
export type EngagementTone = z.infer<typeof EngagementTone>;

export const EmojiLevel = z.enum(['none', 'light', 'expressive']);
export type EmojiLevel = z.infer<typeof EmojiLevel>;

export const DEFAULT_EMOJI_LEVEL: EmojiLevel = 'none';

/**
 * What each emoji level instructs, in words.
 *
 * `none` is the default and it is stated rather than left unsaid, for the reason
 * that keeps recurring: a model with no instruction about emoji will use emoji
 * some of the time, so "we did not mention it" is not a setting.
 */
export const EMOJI_INSTRUCTION: Record<EmojiLevel, string> = {
  none: 'Use no emoji at all.',
  light: 'At most one emoji, and only where it genuinely helps the tone.',
  expressive: 'Emoji are welcome — two or three, used naturally rather than decoratively.',
};

/** The tone sliders as prompt lines. Only the ones far enough from the middle to mean anything. */
export function toneInstructions(tone: EngagementTone | undefined): string[] {
  if (!tone) return [];
  const lines: string[] = [];
  /**
   * 0.35 and 0.65, not 0.5. A slider left near the centre is a brand saying "no
   * strong feeling", and turning that into an instruction would make every reply
   * carry three directives the person did not intend to give.
   */
  if (tone.casual >= 0.65) lines.push('Write casually, the way a person talks.');
  if (tone.casual <= 0.35) lines.push('Keep it formal and composed.');
  if (tone.friendly >= 0.65) lines.push('Be warm and personable rather than businesslike.');
  if (tone.friendly <= 0.35) lines.push('Stay professional and measured.');
  if (tone.warm >= 0.65) lines.push('Lead with empathy before information.');
  if (tone.warm <= 0.35) lines.push('Be direct — answer first, pleasantries second.');
  return lines;
}

/* ── Per-platform settings ─────────────────────────────────────────────── */

/**
 * `Settings WS EI Platforms`' matrix: five platforms × three message kinds.
 *
 * Stored in its own table keyed `(brand_id, platform)` rather than as a reshaped
 * jsonb column — decided 31 August. The deciding argument is the fallback: an
 * **absent row means "use the brand's setting"**, so no backfill is needed, every
 * existing brand behaves exactly as it did, and a brand can override one platform
 * without having to state the other four.
 *
 * The alternative — making `engagement_types` polymorphic between `string[]` and
 * `Record<platform, string[]>` — would leave eight existing readers each having
 * to handle both shapes forever.
 */
export const EngagementPlatform = z.enum(['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']);
export type EngagementPlatform = z.infer<typeof EngagementPlatform>;

export const EngagementKind = z.enum(['comment', 'dm', 'story_reply']);
export type EngagementKind = z.infer<typeof EngagementKind>;

export const PlatformEngagementSetting = z.object({
  platform: EngagementPlatform,
  /** Absent inherits the brand's `engagement_autonomy`. */
  autonomy: z.enum(['off', 'suggest', 'auto']).optional(),
  /** Absent inherits the brand's `engagement_types`; empty means all of them, matching the brand rule. */
  engagementTypes: z.array(EngagementKind).max(3).optional(),
  /** False silences this platform entirely, whatever the rest says. */
  enabled: z.boolean().default(true),
});
export type PlatformEngagementSetting = z.infer<typeof PlatformEngagementSetting>;

/**
 * The effective setting for one platform, brand value underneath.
 *
 * Pure, and the single definition of the fallback — so the settings screen shows
 * exactly what the reply path will do rather than its own approximation of it,
 * which is how two readers of one setting come to disagree.
 */
export function resolvePlatformEngagement(args: {
  platform: string;
  brandAutonomy: 'off' | 'suggest' | 'auto';
  brandTypes: readonly string[] | undefined;
  row: PlatformEngagementSetting | undefined;
}): { autonomy: 'off' | 'suggest' | 'auto'; types: readonly string[] | undefined; enabled: boolean; inherited: boolean } {
  const row = args.row;
  if (!row) {
    return { autonomy: args.brandAutonomy, types: args.brandTypes, enabled: true, inherited: true };
  }
  return {
    autonomy: row.autonomy ?? args.brandAutonomy,
    types: row.engagementTypes ?? args.brandTypes,
    enabled: row.enabled,
    // Inherited only when the row overrides neither field — `enabled: false` is
    // itself a choice, so a disabled platform is never reported as inheriting.
    inherited: row.autonomy === undefined && row.engagementTypes === undefined && row.enabled,
  };
}

/** off < suggest < auto. Used to take the *narrower* of two grants, never the wider. */
const AUTONOMY_RANK: Record<'off' | 'suggest' | 'auto', number> = { off: 0, suggest: 1, auto: 2 };

/**
 * Apply a platform override to the autonomy a campaign rung has already granted
 * — the reply path's single reading of `brand_engagement_settings`.
 *
 * Deliberately *not* `resolvePlatformEngagement`. That function falls back to the
 * brand's `engagementAutonomy`, which is correct for the settings screen and
 * wrong here: autonomy became a property of the campaign on 22 August, and the
 * brand value is now only the template a new campaign is seeded from. Falling
 * back to it in the gate would resurrect a brand-level veto that was removed on
 * purpose — and since its default is `off`, it would silence every brand that
 * has never opened the screen.
 *
 * So the rule is: no row means the rung stands, and a row can only *narrow*.
 * `enabled: false` narrows to `off`; an explicit autonomy is taken only when it
 * is the lower of the two. A platform override that could raise a campaign above
 * its own rung would make the rung advisory, which is the one thing it is not.
 */
export function applyPlatformOverride(args: {
  granted: 'off' | 'suggest' | 'auto';
  row: PlatformEngagementSetting | undefined;
}): 'off' | 'suggest' | 'auto' {
  const row = args.row;
  if (!row) return args.granted;
  if (!row.enabled) return 'off';
  if (!row.autonomy) return args.granted;
  return AUTONOMY_RANK[row.autonomy] < AUTONOMY_RANK[args.granted] ? row.autonomy : args.granted;
}
