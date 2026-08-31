/**
 * The Engagement Intelligence flow's shared vocabulary — `Settings WS EI *`.
 *
 * Five prototype screens are five steps of one flow, not five routes: they share
 * one loaded governance record and one Back/Continue rail. The state lives in
 * `EngagementPanel` and each step is a presentational component, so a step can
 * be reordered without any of them learning about the others.
 */

export type EngagementAutonomy = 'off' | 'suggest' | 'auto';
export type EscalationBehavior = 'hold' | 'notify' | 'draft_no_send';
export type EmojiLevel = 'none' | 'light' | 'expressive';

/** The three axes `engagement_tone` stores — not `tone_vector`'s four. */
export interface EngagementTone {
  casual: number;
  friendly: number;
  warm: number;
}

export interface Governance {
  engagementAutonomy: EngagementAutonomy;
  engagementTypes: string[];
  hardRules: string[];
  escalationBehavior: EscalationBehavior;
  /** Absent means "use my brand voice", which is the recommended state. */
  engagementTone?: EngagementTone;
  emojiLevel: EmojiLevel;
  engagementConfiguredAt?: string;
  salesQualification: string[];
  salesHandoff: { hot: string; warm: string; cold: string };
  usingDefaultHandoff: boolean;
  salesDestination?: string;
  salesEscalationKeywords: string[];
}

export interface EffectivePlatform {
  platform: string;
  autonomy: EngagementAutonomy;
  engagementTypes: string[];
  enabled: boolean;
  /** True when this platform has no override and is following the brand. */
  inherited: boolean;
  /**
   * Per-field. A row that overrides only the message types still inherits
   * autonomy, and the row-level `inherited` cannot say so — which is the one
   * thing the screen needs, since it draws the two axes as separate controls.
   */
  autonomyInherited: boolean;
  typesInherited: boolean;
}

export interface PlatformsRead {
  brandAutonomy: EngagementAutonomy;
  brandEngagementTypes: string[];
  platforms: EffectivePlatform[];
}

/**
 * PRD §8.8's autonomy level. `off` is not the same as unset — it is the
 * conservative rung, and it is what `policy.ts` rule 6 reads as "autonomy has
 * not been configured", which holds every reply for approval.
 */
export const ENGAGEMENT_LEVELS = [
  { value: 'off', label: 'Draft only', hint: 'SPARK writes the reply. You send it.' },
  { value: 'suggest', label: 'Suggest and hold', hint: 'Replies queue for your approval before sending.' },
  { value: 'auto', label: 'Answer the safe ones', hint: 'SPARK sends replies it judged safe, on its own.' },
] as const;

export const ENGAGEMENT_TYPES = [
  { value: 'comment', label: 'Comments' },
  { value: 'dm', label: 'Direct messages' },
  { value: 'story_reply', label: 'Story replies' },
] as const;

/**
 * `Settings WS EI Boundaries`' five hard rules, in the prototype's own words.
 *
 * The one `note` is not decoration. Four of these become prohibitions in
 * the reply writer's prompt; the fifth is enforced as an escalation, because by
 * the time a prompt runs the decision to reply unattended has already been
 * taken. A screen that presented all five identically would be describing one
 * mechanism where there are two.
 */
export const HARD_RULES = [
  { value: 'never_discuss_pricing', label: 'Never discuss pricing details' },
  { value: 'never_promise_results', label: 'Never promise results' },
  {
    value: 'never_auto_reply_to_complaints',
    label: 'Never respond to complaints automatically',
    note: 'A message that reads like a complaint goes to you, whatever the autonomy level says.',
  },
  { value: 'never_argue', label: 'Never argue with users' },
  { value: 'never_discuss_legal_or_medical', label: 'Never discuss legal or medical topics' },
] as const;

export const ESCALATION_BEHAVIORS = [
  {
    value: 'hold',
    label: 'Hold for review',
    hint: 'The message waits in Needs Review. Nothing else happens.',
  },
  {
    value: 'notify',
    label: 'Notify me immediately',
    hint: 'Same hold, plus a notification the moment it lands.',
  },
  {
    value: 'draft_no_send',
    label: 'Draft reply but don’t send',
    hint: 'SPARK writes a reply for you to edit and send yourself.',
  },
] as const;

/** The prototype's five platform rows. */
export const PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X' },
  { value: 'youtube_shorts', label: 'YouTube Shorts' },
] as const;

/**
 * `Settings WS EI Voice`'s three sliders.
 *
 * The prototype's own end labels. These are *not* `tone_vector`'s four axes —
 * they overlap without matching, so mapping one onto the other would mean
 * dropping an axis or inventing a correspondence nobody chose.
 */
export const TONE_AXES = [
  { key: 'casual' as const, low: 'Formal', high: 'Casual' },
  { key: 'friendly' as const, low: 'Professional', high: 'Friendly' },
  { key: 'warm' as const, low: 'Direct', high: 'Warm' },
];

export const EMOJI_LEVELS = [
  { value: 'none', label: 'None' },
  { value: 'light', label: 'Light 😀' },
  { value: 'expressive', label: 'Expressive 🚀🔥' },
] as const;

/**
 * Sales Assist (`SET-WS-EI-SALES`).
 *
 * Each option authorises the agent to *do* something specific, so the labels say
 * what will happen rather than naming a capability — "Share your booking link"
 * is a promise the owner is making, and it should read like one.
 */
export const QUALIFICATION_OPTIONS = [
  { value: 'ask_qualifying_questions', label: 'Ask qualifying questions', hint: 'What they want, when, budget.' },
  { value: 'share_booking_link', label: 'Share your booking link', hint: 'Sends people straight to your calendar.' },
  { value: 'share_pricing_link', label: 'Share your pricing page', hint: 'Only if your prices are public.' },
  { value: 'collect_contact_details', label: 'Collect contact details', hint: 'Asks for a name and a way to reach them.' },
] as const;

/**
 * The prototype says "Send to CRM + notify me" for the first of these, and this
 * is the one F21 label that is deliberately *not* adopted.
 *
 * There is no CRM integration. `opportunities.routed_to` is free text and
 * `engage.opportunity.create`'s own comment says so outright — the destination is
 * an email address or a reference somebody reads. A label promising a CRM would
 * be the copy claiming an integration the product does not have, which is a
 * different kind of error from a plainer word.
 */
export const HANDOFF_DESTINATIONS = [
  { value: 'crm_notify', label: 'Send on + notify me' },
  { value: 'save_notify', label: 'Save + notify me' },
  { value: 'nurture_only', label: 'Nurture only' },
] as const;

export const TEMPERATURES = [
  { value: 'hot' as const, label: 'Hot', emoji: '🔥', hint: 'Ready to buy' },
  { value: 'warm' as const, label: 'Warm', emoji: '🌡️', hint: 'Interested, not yet' },
  { value: 'cold' as const, label: 'Cold', emoji: '❄️', hint: 'Just looking' },
];

export const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The five steps, in the prototype's order. */
export const STEPS = ['autonomy', 'boundaries', 'platforms', 'voice', 'sales'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_TITLES: Record<Step, string> = {
  autonomy: 'How much may SPARK say on its own?',
  boundaries: 'Set boundaries for your Agent',
  platforms: 'Platforms',
  voice: 'How should your Agent sound?',
  sales: 'Sales Assist Configuration',
};
