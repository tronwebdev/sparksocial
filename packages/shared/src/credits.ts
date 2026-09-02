/**
 * CREDITS — the arithmetic the Credit & Usage screen has never had.
 *
 * Every tool that spends money records `cost_cents`, which CLAUDE.md has required
 * since day one, and the ledger has been real since P1. What was missing sits
 * between that ledger and the screen: **nothing mapped a tool to a category, and
 * nothing converted cents to credits.** So "Render 21.2K / 30K" in
 * `Settings WS Credit Usage.dc.html` had no arithmetic behind it — not a
 * rendering gap, an absent model.
 *
 * ── Why the rate is 2 cents, and why that is a calibration not a guess ────
 *
 * The starter plan's cap is `500_00` cents (`PLAN_CAPS_CENTS` in
 * `packages/agency/src/org.ts`). The prototype's header reads
 * *"15,700 / 25,000 credits"*. $500 ÷ 25,000 = **2 cents per credit**, exactly,
 * with no rounding — the design and the plan tier were built against the same
 * number even though neither says so.
 *
 * That fixes the *unit*. It does not fix the *pricing*: whether a render should
 * cost the credits it currently does is a question about real vendor cost at
 * volume, which is 6.3's load testing and is why that row says 5.1 depends on it.
 * The unit and the price are separable, and this file is the unit.
 *
 * ── Categories are a product decision, so they are declared, not derived ──
 *
 * There is no signal on a tool that says which category it belongs to. `effect`
 * distinguishes read from publish; the name prefix groups by domain, not by what
 * the money bought. A prefix rule would put `content.generate_avatar_video` and
 * `content.draft` in one bucket, when one is a vendor video render costing 50c
 * and the other is a model call costing 2c — which is precisely the distinction
 * the screen exists to draw. So the map is explicit and every cost-bearing tool
 * appears in it.
 */

/**
 * The prototype's four, plus one.
 *
 * `Settings WS Credit Usage.dc.html` names Render, Transcription, Stock and AI
 * generation. `delivery` is added because real money is spent there —
 * `publish.now` calls an aggregator, `whatsapp.send` calls Meta — and it belongs
 * to none of the four. Folding it into one of them would misreport two
 * categories rather than one, and leaving it out would make the category totals
 * disagree with the headline spend, which is the fastest way to make a billing
 * screen untrustworthy.
 */
export type CreditCategory = 'render' | 'transcription' | 'stock' | 'ai_generation' | 'delivery';

export const CREDIT_CATEGORIES: readonly CreditCategory[] = [
  'render',
  'transcription',
  'stock',
  'ai_generation',
  'delivery',
];

export const CREDIT_CATEGORY_LABEL: Record<CreditCategory, string> = {
  render: 'Render',
  transcription: 'Transcription',
  stock: 'Stock assets',
  ai_generation: 'AI generation',
  delivery: 'Delivery',
};

export const CREDIT_CATEGORY_HINT: Record<CreditCategory, string> = {
  render: 'Turning a draft into a finished video or image.',
  transcription: 'Turning speech into text.',
  stock: 'Licensing footage or photography.',
  ai_generation: 'Writing copy, generating images, and reading your material.',
  delivery: 'Publishing a post and sending messages.',
};

/**
 * Every tool that declares `estimateCents`, and which category its spend is.
 *
 * Complete by construction: `creditCategoriesAreComplete` in the test walks the
 * registry and fails if a cost-bearing tool is missing from this map. A tool that
 * spends money and appears in no category would be spend the screen cannot
 * explain, which is worse than a wrong label.
 */
const CATEGORY_BY_TOOL: Record<string, CreditCategory> = {
  /* ── Render: a vendor turning beats into a media file ────────────────── */
  'compose.render': 'render',
  'compose.static': 'render',
  'compose.fanout': 'render',
  'content.generate_avatar_video': 'render',
  'content.generate_broll': 'render',
  'content.generate_dub': 'render',
  'content.generate_voiceover': 'render',
  'direct.media.ingest': 'render',

  /* ── AI generation: a model call ─────────────────────────────────────── */
  'content.draft': 'ai_generation',
  'content.generate_image': 'ai_generation',
  'draft.variants': 'ai_generation',
  'draft.repurpose': 'ai_generation',
  'trend.hooks': 'ai_generation',
  'brand.logo.generate': 'ai_generation',
  'direct.brief.generate': 'ai_generation',
  'direct.session.batch': 'ai_generation',
  'engage.classify': 'ai_generation',
  'engage.reply.draft': 'ai_generation',
  'genome.bootstrap_from_url': 'ai_generation',
  'genome.create': 'ai_generation',
  'asset.caption.set': 'ai_generation',
  'asset.retrieve': 'ai_generation',
  'asset.ingest_url': 'ai_generation',
  'knowledge.ingest_docs': 'ai_generation',
  'knowledge.ingest_site': 'ai_generation',

  /* ── Delivery: reaching the outside world ────────────────────────────── */
  'publish.now': 'delivery',
  'whatsapp.send': 'delivery',
  'link.shorten': 'delivery',
};

/**
 * Two categories the design names that nothing currently spends against.
 *
 * **Transcription** has no tool: nothing in the registry turns speech into text.
 * AssemblyAI is in the stack per CLAUDE.md and is not called by any tool.
 * **Stock** has no tool either: no stock-media vendor is integrated, and
 * `asset.ingest_url` pulls in a file the brand already has rather than licensing
 * one.
 *
 * They stay in the vocabulary rather than being deleted, because the screen shows
 * four categories and a brand that later gains transcription should not need a
 * migration to see it. They report **zero**, and the screen says why — an empty
 * category that looks like "you spent nothing on this" when the truth is "this
 * does not exist yet" is the same lie as an invented number.
 */
export const CATEGORIES_WITHOUT_TOOLS: readonly CreditCategory[] = ['transcription', 'stock'];

/**
 * The category a tool's spend belongs to, or `undefined` when the tool spends
 * nothing.
 *
 * Undefined rather than a fallback category: a free tool has no place on a
 * spending breakdown, and giving it one would put every `genome.list` on the
 * bill at zero and bury the four rows that matter.
 */
export function creditCategoryFor(toolName: string): CreditCategory | undefined {
  return CATEGORY_BY_TOOL[toolName];
}

/** Every tool this map knows about — the completeness test reads it. */
export const CATEGORISED_TOOLS: readonly string[] = Object.keys(CATEGORY_BY_TOOL);

/**
 * 1 credit = 2 cents. See the header for the calibration.
 *
 * A named constant rather than an inline `/ 2`, because changing the rate is a
 * pricing decision that has to be visible in a diff.
 */
export const CENTS_PER_CREDIT = 2;

/**
 * Cents to credits, rounded **up**.
 *
 * Up rather than nearest, and the direction is deliberate: a 1-cent call must
 * cost at least 1 credit, or a brand could make an unbounded number of them
 * against a balance that never moves. Rounding is applied at the point of
 * display and never stored — the ledger stays in cents, which is the unit the
 * vendors actually bill in.
 */
export function centsToCredits(cents: number): number {
  return Math.ceil(Math.max(0, cents) / CENTS_PER_CREDIT);
}

/** Credits back to cents, for a cap a person typed in credits. */
export function creditsToCents(credits: number): number {
  return Math.max(0, Math.round(credits)) * CENTS_PER_CREDIT;
}

/**
 * A month's spend projected to its end, from the share of the month elapsed.
 *
 * Straight-line, and the screen says so. Anything cleverer — weekday weighting,
 * a campaign's own schedule — would be a forecast the data cannot support: a
 * brand two days into a month has two days of history, and a confident curve
 * drawn through it is a guess wearing a model's clothes.
 *
 * Returns `undefined` for the first day, where the multiplier is unstable enough
 * to produce numbers that are worse than no number. A screen showing "no forecast
 * yet" on the 1st is honest; one showing "you will spend $14,000" because
 * somebody rendered a video at 00:04 is not.
 */
export function forecastCents(args: {
  spentCents: number;
  periodStart: Date;
  now: Date;
  /** Days in the billing month. */
  daysInPeriod: number;
}): number | undefined {
  const msElapsed = args.now.getTime() - args.periodStart.getTime();
  const daysElapsed = msElapsed / 86_400_000;
  if (daysElapsed < 1) return undefined;
  return Math.round(args.spentCents * (args.daysInPeriod / daysElapsed));
}
