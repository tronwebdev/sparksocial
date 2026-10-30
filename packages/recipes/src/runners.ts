import { z } from 'zod';
import { Platform } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import { checkPublicHttpUrl } from '@sparksocial/shared/safeUrl';
import { byId, type AssetInventory } from '@sparksocial/playbooks';
import { rankTrends, suggestRepurpose, type TrendSource } from '@sparksocial/trends';
import { csvToRecords } from './csv.js';
import { parseFeed } from './rss.js';

/**
 * ONE DISPATCHER PER RECIPE KIND — plan §12 P5, `AUTO-01`→`AUTO-04.4`.
 *
 * `recipe.kind` is data (CLAUDE.md invariant 5's spirit applied to recipes,
 * not just playbooks), so this switches on it rather than having three
 * separate tools. What genuinely differs by vendor is honest about it:
 * `auto_trend` and `rss` need no credential and run for real; `canva`/
 * `drive`/`folder` sub-kinds of `bulk_connector` have no OAuth integration
 * wired up anywhere in this codebase and say so, rather than fabricating a
 * connector that doesn't exist — same rule as every other vendor-gated seam
 * (`fal`, `HeyGen`, native publish adapters).
 */

/**
 * Folds a recipe's `goal` into an output's intent.
 *
 * `intent` is the one string that survives all the way to `content.draft`, where
 * it grounds every written beat — so it is the only place a recipe-level
 * instruction can reach the copy without a new field on `recipe_outputs`. The
 * goal goes *after* the source material, because the material is what the post is
 * about and the goal is what it is for; leading with the goal makes every output
 * from a recipe open the same way.
 *
 * Absent goal returns the intent untouched, which is what every recipe produced
 * before this was read.
 */
export function withGoal(intent: string, goal?: string): string {
  return goal?.trim() ? `${intent} — written toward: ${goal.trim()}` : intent;
}

export interface RecipeOutputPreview {
  title: string;
  intent: string;
  sourceUrl?: string;
  playbookId?: string;
  /** The format's display name, so the queue can say what it will become. */
  playbookName?: string;
  /** The trend an `auto_trend` output came from — `content_items.source_trend_id`. */
  trendId?: string;
  referencedAssetIds?: string[];
  /** Set once the output has become posts — one per chosen account. */
  contentItemIds?: string[];
}

/**
 * Everything an output can be recognised by: its link, its trend, its title.
 *
 * `recipe.run` collects these from what the recipe already produced and skips any
 * new output that shares one — the PRD's "skip items it has already posted".
 * All three rather than one, because the identity that matters differs by kind
 * (a feed item has a link, a trend an id, a sheet row only its words) and because
 * outputs stored before `trendId` existed can only be matched by title.
 */
export function outputKeys(preview: unknown): string[] {
  const p = (preview ?? {}) as Partial<RecipeOutputPreview>;
  const keys: string[] = [];
  if (typeof p.sourceUrl === 'string' && p.sourceUrl) keys.push(`url:${p.sourceUrl.trim().replace(/\/+$/, '').toLowerCase()}`);
  if (typeof p.trendId === 'string' && p.trendId) keys.push(`trend:${p.trendId}`);
  if (typeof p.title === 'string' && p.title.trim()) {
    keys.push(`title:${p.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`);
  }
  return keys;
}

/**
 * The format an item becomes, preferring one the brand can make today.
 *
 * Only `auto_trend` used to pick a format at all, so a feed item or a sheet row
 * reached the queue with nothing to draft from: approving it failed with "No
 * format picked", and with review off it was silently skipped — RSS and Bulk
 * recipes could not produce a single post. They now ask the same matcher the
 * trend path uses, on their own words.
 *
 * "Can make today" because a recipe posts unattended: a format waiting on footage
 * nobody has shot would fail when the scheduler drafts it. The matcher's own pick
 * wins when its words actually matched the item and it is makeable; otherwise one
 * of the best-ranked makeable formats, and a format that supports one of the
 * recipe's chosen accounts is preferred over one that supports none of them.
 *
 * ── "Otherwise" rotates ───────────────────────────────────────────────────
 *
 * When nothing in the item's words matches a format — most news headlines — the
 * matcher's answer is simply its top-ranked format, the same one every time. On
 * staging that made a coffee-news feed five "Comparison (X vs Y)" posts in a row.
 * So an unmatched item takes whichever of the top four makeable formats this run
 * has used least (`formatUse`), ties going to the better-ranked one. A matched
 * item still gets its match: that is a real reason, and rotation is not.
 */
export function pickFormat(
  ctx: Pick<RecipeRunContext, 'genome' | 'assets' | 'formatUse'>,
  item: { topic: string; tags: string[] },
  targetPlatforms: readonly string[] = [],
): { playbookId: string; playbookName: string; intent: string } | undefined {
  const { suggestion, ranked } = suggestRepurpose(ctx.genome, ctx.assets, item);
  const fits = (id: string) =>
    targetPlatforms.length === 0 || (byId(id)?.output.platforms ?? []).some((p) => targetPlatforms.includes(p));
  const use = (id: string) => ctx.formatUse?.set(id, (ctx.formatUse.get(id) ?? 0) + 1);
  if (suggestion && suggestion.matchedOn.length > 0 && !suggestion.unlockable && fits(suggestion.playbookId)) {
    use(suggestion.playbookId);
    return { playbookId: suggestion.playbookId, playbookName: suggestion.playbookName, intent: suggestion.intent };
  }
  const makeable = ranked.filter((r) => !r.unlockable);
  const fitting = makeable.filter((r) => fits(r.playbook.playbook_id));
  const shortlist = (fitting.length ? fitting : makeable).slice(0, 4);
  const count = (id: string) => ctx.formatUse?.get(id) ?? 0;
  const best = shortlist.reduce<(typeof shortlist)[number] | undefined>(
    (pick, r) => (!pick || count(r.playbook.playbook_id) < count(pick.playbook.playbook_id) ? r : pick),
    undefined,
  );
  if (best) {
    use(best.playbook.playbook_id);
    return {
      playbookId: best.playbook.playbook_id,
      playbookName: best.playbook.name,
      intent: `Join the trend "${item.topic}" with a ${best.playbook.name.toLowerCase()} post`,
    };
  }
  return suggestion
    ? { playbookId: suggestion.playbookId, playbookName: suggestion.playbookName, intent: suggestion.intent }
    : undefined;
}

export interface RecipeRunContext {
  genome: Genome;
  assets: AssetInventory;
  trendSource: TrendSource;
  /** Injected so tests don't hit the network; the real one is SSRF-checked before use. */
  fetchText: (url: string) => Promise<string>;
  /**
   * Same injection contract as `fetchText`, for the one caller here that
   * needs an `Authorization: Bearer` header rather than just an `Accept`
   * one — kept as its own function instead of widening `fetchText`'s
   * signature, since every other caller (rss, csv, drive) is a plain
   * unauthenticated GET and has no business taking a token parameter.
   */
  fetchWithAuth?: (url: string, bearerToken: string) => Promise<string>;
  /**
   * Google Drive's public-folder listing is a single shared credential (an
   * API key restricted to the Drive API, same shape as `YOUTUBE_API_KEY`)
   * rather than a per-brand connection — a folder has to be explicitly
   * shared "anyone with the link" to be readable this way at all, so there
   * is no private data this key could expose. Undefined when unconfigured.
   */
  driveApiKey?: string;
  /**
   * Canva designs are per-account, so there is no shared key that works —
   * this resolves the *current genome's own* stored OAuth connection
   * (`brand.oauth.connect`, see `packages/agency`), if one exists. Undefined
   * when the brand has never connected Canva.
   */
  getOAuthAccessToken?: (provider: 'canva') => Promise<string | undefined>;
  /**
   * How often each format has been picked so far in this run — `pickFormat`
   * rotates unmatched items through the top formats with it. `runRecipe` makes
   * a fresh one per run.
   */
  formatUse?: Map<string, number>;
  /**
   * `outputKeys` of everything this recipe produced before. A runner drops any
   * candidate sharing one *before* it applies its per-run cap, so a run is
   * "the next N new items" rather than "the first N items, minus the ones already
   * seen" — the second shrinks to nothing on a feed that publishes slowly.
   * Absent for a preview of an unsaved recipe, which has no history.
   */
  seen?: ReadonlySet<string>;
}

/** Whether a candidate is new to this recipe. */
function isNew(ctx: RecipeRunContext, preview: Partial<RecipeOutputPreview>): boolean {
  return !ctx.seen || !outputKeys(preview).some((k) => ctx.seen!.has(k));
}

export interface RecipeRunResult {
  outputs: RecipeOutputPreview[];
  error?: string;
}

/**
 * The config PRD §8.10 lists as common to every recipe kind, regardless of
 * where its material comes from: *"recipe name, target accounts, goal + CTA
 * URL, frequency schedule, start/end options, review-before-publish checkbox"*.
 *
 * Name and frequency already live on the `recipes` row itself. The rest are
 * here, merged into all three kind-specific schemas rather than repeated in
 * each, so a new recipe kind inherits them by construction.
 *
 * ── `reviewBeforePublish` defaults to true, and the PRD says otherwise ─────
 *
 * §8.10's stated default is "publish automatically if approvals are OFF and
 * content not flagged". That default is honoured at the *workspace* level,
 * where it belongs and where a human has already made the choice: an
 * unattended publish still has to satisfy `policy.ts` rule 7, which consults
 * `approvalMode` and `permissions.automationAutoPublish`. What is true per
 * *recipe* is that a newly created one has never had a single output looked at
 * by anybody, so it opts into review until its owner turns that off — the same
 * reasoning `review_first_week` applies to a whole brand. Turning it off is one
 * boolean, and then the recipe genuinely publishes unattended.
 */
export const RecipeCommonConfig = z.object({
  /** Route review through a person before anything goes out. AUTO-02.5 / 03.5 / 04.4's checkbox. */
  reviewBeforePublish: z.boolean().default(true),
  /**
   * Which connected accounts this recipe posts to. **Applied** — each output
   * becomes one post per chosen account the format supports (or per chosen
   * account, when the format supports none of them: the person picked them).
   * Empty means "whatever the chosen playbook declares" — the same default the
   * scheduler applies to a campaign slot with no platform of its own.
   */
  targetPlatforms: z.array(Platform).default([]),
  /**
   * The goal every output is written toward. **Applied** — folded into the
   * output's `intent`, which is what reaches `content.draft` and grounds the
   * copy. See `withGoal`.
   */
  goal: z.string().max(200).optional(),
  /**
   * The link every post carries. **Applied** — stored on each post as
   * `content_items.link_url` and appended to the caption when it publishes.
   *
   * Deliberately not folded into `intent` like `goal` is. `intent` is prose a
   * writer reads, so a URL placed there becomes *spoken* copy — the defect found
   * on 22 August, when sixteen playbooks recited "https://…". A link belongs in a
   * link field, which is what `link_url` is.
   */
  ctaUrl: z.string().url().optional(),
  /** Not before / not after. A recipe outside its window produces nothing and says so. */
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});
export type RecipeCommonConfig = z.infer<typeof RecipeCommonConfig>;

/**
 * Whether a recipe is inside its configured start/end window right now.
 * Exported because `recipe.run` has to answer this before doing any work, and
 * the scheduler has to answer it before deciding a recipe is even due.
 */
export function withinRunWindow(
  config: unknown,
  now: Date,
): { ok: true } | { ok: false; reason: string; expired: boolean } {
  const parsed = RecipeCommonConfig.partial().safeParse(config);
  if (!parsed.success) return { ok: true };
  const { startAt, endAt } = parsed.data;
  if (startAt && now < new Date(startAt)) {
    /**
     * `expired: false` — and the distinction is load-bearing rather than
     * cosmetic. Both bounds produce "no output from this run", but only one means
     * the recipe is finished: a recipe with a future `startAt` is *waiting*, and
     * retiring it would kill it before it ever ran. `recipe.run` reads this flag
     * to decide whether to mark the recipe completed.
     */
    return { ok: false, reason: `This recipe does not start until ${startAt}.`, expired: false };
  }
  if (endAt && now > new Date(endAt)) {
    return { ok: false, reason: `This recipe finished on ${endAt}.`, expired: true };
  }
  return { ok: true };
}

/** Reads the review flag off any recipe kind's config, defaulting to the safe answer. */
export function requiresReview(config: unknown): boolean {
  const parsed = RecipeCommonConfig.partial().safeParse(config);
  return parsed.success ? parsed.data.reviewBeforePublish !== false : true;
}

export async function runRecipe(kind: string, config: unknown, runCtx: RecipeRunContext): Promise<RecipeRunResult> {
  const ctx: RecipeRunContext = { ...runCtx, formatUse: new Map() };
  switch (kind) {
    case 'auto_trend':
      return runAutoTrend(config, ctx);
    case 'rss':
      return runRss(config, ctx);
    case 'bulk_connector':
      return runBulkConnector(config, ctx);
    default:
      return { outputs: [], error: `Unknown recipe kind: ${kind}` };
  }
}

/* ── auto_trend ──────────────────────────────────────────────────────── */

export const AutoTrendConfig = RecipeCommonConfig.extend({
  region: z.string().optional(),
  language: z.string().optional(),
  /**
   * The lowest `rankTrends` score this recipe acts on.
   *
   * The default was 0.4, and on real feeds nothing reaches it: a brand-relevant
   * trend scores relevance × (opportunity, plus a little for reach), and staging
   * on 30 Oct read 0.06–0.09 for the best of thirty relevant trends. A recipe
   * left on its default therefore never posted. 0.05 keeps everything relevant
   * that is not dead weight; the wizard's stricter settings are 0.15 and 0.3.
   */
  minScore: z.number().min(0).max(1).default(0.05),
  maxOutputs: z.number().int().min(1).max(10).default(3),
  /**
   * AUTO-02.3's "post age": skip anything first published more than this many
   * hours ago. A trend whose source reports no time (a search query, a hashtag)
   * is kept — it is not a post, and guessing its age would be inventing data.
   */
  maxAgeHours: z.number().int().min(1).max(24 * 90).optional(),
  /**
   * `AUTO-02`'s keyword step. **Applied** — passed through to
   * `TrendSource.fetch`, which took no keyword parameter until now, which is why
   * the wizard's whole keyword step had nothing to reach.
   *
   * Ten is not a UI nicety: keywords are OR'd, and a recipe watching twenty
   * topics is watching everything, which is what the source does anyway without
   * any of them. Capped where the control stops being a filter.
   */
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  /**
   * The exclude list, applied after everything else and by us rather than by the
   * vendor: neither Reddit's nor YouTube's search accepts a negation, so this is
   * the half no source can do.
   */
  excludeKeywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

async function runAutoTrend(rawConfig: unknown, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  const parsed = AutoTrendConfig.safeParse(rawConfig);
  if (!parsed.success) return { outputs: [], error: 'Invalid auto_trend config.' };
  const config = parsed.data;

  const fetched = await ctx.trendSource.fetch({
    limit: Math.max(config.maxOutputs * 3, 20),
    ...(config.region ? { region: config.region } : {}),
    ...(config.language ? { language: config.language } : {}),
    // The two fields that make the keyword step real. Passed only when non-empty
    // so a recipe that names none is byte-for-byte the call every recipe made
    // before this parameter existed.
    ...(config.keywords.length ? { keywords: config.keywords } : {}),
    ...(config.excludeKeywords.length ? { excludeKeywords: config.excludeKeywords } : {}),
  });
  /**
   * A keyword recipe that finds nothing has two possible causes and they need
   * different answers: the source returned nothing for those words, or it
   * returned things the genome scores below `minScore`. Reported rather than
   * collapsed into an empty run — "no trends matched" sends the owner to change
   * their keywords, and "matched but scored low" sends them to widen the score,
   * and guessing wrong wastes their next attempt.
   */
  if (fetched.length === 0 && config.keywords.length > 0) {
    return {
      outputs: [],
      error:
        `No trends came back for ${config.keywords.join(', ')}. Some sources search their platform for a ` +
        `keyword and some can only narrow what they already fetched — try fewer or broader words.`,
    };
  }

  const now = Date.now();
  const fresh = config.maxAgeHours
    ? fetched.filter((t) => !t.startedAt || now - Date.parse(t.startedAt) <= config.maxAgeHours! * 3_600_000)
    : fetched;
  if (fresh.length === 0 && fetched.length > 0) {
    return {
      outputs: [],
      error: `${fetched.length} trends came back, but every one was published more than ${config.maxAgeHours} hours ago. Allow older posts, or try again later.`,
    };
  }

  const { ranked } = rankTrends(ctx.genome, fresh);
  const scored = ranked.filter((r) => r.score >= config.minScore);
  const unseen = scored.filter((r) => isNew(ctx, { trendId: r.trend.id, title: r.trend.topic }));
  const eligible = unseen.slice(0, config.maxOutputs);

  if (eligible.length === 0 && scored.length > 0) {
    // Not an error: the recipe already proposed everything that qualifies.
    return { outputs: [] };
  }
  if (eligible.length === 0 && fresh.length > 0 && config.keywords.length > 0) {
    return {
      outputs: [],
      error:
        `${fresh.length} trends matched those keywords, but none scored above ${config.minScore} for this ` +
        `brand. Lower the signal setting, or use words closer to what the brand actually does.`,
    };
  }

  const outputs: RecipeOutputPreview[] = [];
  for (const r of eligible) {
    const format = pickFormat(ctx, r.trend, config.targetPlatforms);
    if (!format) continue;
    outputs.push({
      title: r.trend.topic,
      intent: withGoal(format.intent, config.goal),
      playbookId: format.playbookId,
      playbookName: format.playbookName,
      trendId: r.trend.id,
      ...(r.trend.samples[0]?.url ? { sourceUrl: r.trend.samples[0].url } : {}),
      referencedAssetIds: [],
    });
  }
  return { outputs };
}

/**
 * A feed item or sheet row as an output: its own words, plus the format the
 * matcher picks for them. An item no format fits is still returned, without a
 * `playbookId` — `recipe.run` reports it rather than dropping it unseen.
 */
function itemOutput(
  ctx: RecipeRunContext,
  config: { goal?: string; targetPlatforms: string[] },
  item: { title: string; lead: string; sourceUrl?: string; tags?: string[] },
): RecipeOutputPreview {
  const format = pickFormat(ctx, { topic: item.title, tags: item.tags ?? [] }, config.targetPlatforms);
  return {
    title: item.title,
    intent: withGoal(
      format ? `${item.lead}: "${item.title}" — as a ${format.playbookName.toLowerCase()} post` : `${item.lead}: "${item.title}"`,
      config.goal,
    ),
    ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
    ...(format ? { playbookId: format.playbookId, playbookName: format.playbookName } : {}),
  };
}

/* ── rss ─────────────────────────────────────────────────────────────── */

export const RssConfig = RecipeCommonConfig.extend({
  feedUrl: z.string().url(),
  maxItems: z.number().int().min(1).max(20).default(5),
  /**
   * AUTO-04.3's feed type. A podcast item is an episode, and a brief that calls
   * it "new from the feed" gets written like a news recap; this is the one word
   * that tells the writer which it is.
   */
  feedType: z.enum(['news', 'podcast']).default('news'),
});

async function runRss(rawConfig: unknown, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  const parsed = RssConfig.safeParse(rawConfig);
  if (!parsed.success) return { outputs: [], error: 'Invalid rss config — feedUrl is required.' };
  const config = parsed.data;

  const check = checkPublicHttpUrl(config.feedUrl);
  if (!check.ok) return { outputs: [], error: `Refused to fetch this feed: ${check.reason}` };

  let xml: string;
  try {
    xml = await ctx.fetchText(config.feedUrl);
  } catch (e) {
    return { outputs: [], error: `Could not fetch the feed: ${e instanceof Error ? e.message : String(e)}` };
  }

  /* Read deep, then take the first `maxItems` this recipe has not proposed. */
  const items = parseFeed(xml, 50).filter((item) => isNew(ctx, { sourceUrl: item.link, title: item.title }));
  return {
    outputs: items
      .slice(0, config.maxItems)
      .map((item) =>
        itemOutput(ctx, config, {
          title: item.title,
          lead: config.feedType === 'podcast' ? 'New podcast episode' : 'New from the feed',
          sourceUrl: item.link,
        }),
      ),
  };
}

/* ── bulk_connector ──────────────────────────────────────────────────── */

export const BulkConnectorConfig = RecipeCommonConfig.extend({
  source: z.enum(['csv', 'canva', 'drive', 'folder']),
  csvUrl: z.string().url().optional(),
  csvText: z.string().optional(),
  /** The Drive folder to list. Must be shared "Anyone with the link can view" — this reads through a single shared API key, not a per-brand OAuth connection, so it can only ever see what's public. */
  driveFolderId: z.string().optional(),
  /** The Canva folder to list designs from — read through the brand's own connected Canva account (brand.oauth.connect). */
  canvaFolderId: z.string().optional(),
  /**
   * AUTO-03.5's posting cycle: how many rows or files one run takes.
   *
   * There was no cycle — every run turned the whole sheet into outputs, so a
   * daily recipe over a 60-row sheet proposed 60 posts every day. Now each run
   * takes the next `perRun` items it has not produced before, and a sheet is
   * worked through at that pace until it is used up.
   */
  perRun: z.number().int().min(1).max(20).default(3),
});

async function runBulkConnector(rawConfig: unknown, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  const parsed = BulkConnectorConfig.safeParse(rawConfig);
  if (!parsed.success) return { outputs: [], error: 'Invalid bulk_connector config.' };
  const config = parsed.data;

  switch (config.source) {
    case 'csv':
      return runBulkConnectorCsv(config, ctx);
    case 'drive':
      return runBulkConnectorDrive(config, ctx);
    case 'canva':
      return runBulkConnectorCanva(config, ctx);
    case 'folder':
      // "A local/network folder" has no meaning for a hosted app with no
      // persistent filesystem across requests — this sub-kind was never a
      // buildable target the way csv/drive/canva are; it needs redefining
      // (e.g. "a watched Azure Blob container") before it can be real.
      return { outputs: [], error: 'folder is not a connectable source in a hosted app — use drive or csv instead.' };
    default:
      return { outputs: [], error: `Unknown bulk_connector source: ${config.source satisfies never}` };
  }
}

/** Every bulk source shares the cycle: drop what was produced before, take the next `perRun`. */
type BulkRun = z.infer<typeof BulkConnectorConfig>;

async function runBulkConnectorCsv(config: BulkRun, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  let text = config.csvText;
  if (!text) {
    if (!config.csvUrl) return { outputs: [], error: 'A csvUrl or csvText is required for the csv source.' };
    const check = checkPublicHttpUrl(config.csvUrl);
    if (!check.ok) return { outputs: [], error: `Refused to fetch this URL: ${check.reason}` };
    try {
      text = await ctx.fetchText(config.csvUrl);
    } catch (e) {
      return { outputs: [], error: `Could not fetch the CSV: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  const records = csvToRecords(text);
  const rows = records.map((row) => {
    const title = row.title || row.topic || Object.values(row)[0] || 'Untitled row';
    const link = row.link || row.url;
    return { title, ...(link && /^https?:\/\//i.test(link) ? { sourceUrl: link } : {}) };
  });
  const fresh = rows.filter((r) => isNew(ctx, r)).slice(0, config.perRun);
  return { outputs: fresh.map((r) => itemOutput(ctx, config, { ...r, lead: 'From the imported sheet' })) };
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  createdTime?: string;
}

async function runBulkConnectorDrive(config: BulkRun, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  if (!config.driveFolderId) return { outputs: [], error: 'A driveFolderId is required for the drive source.' };
  if (!ctx.driveApiKey) {
    return { outputs: [], error: 'Google Drive is not connected — GOOGLE_DRIVE_API_KEY is not configured for this workspace.' };
  }

  const params = new URLSearchParams({
    q: `'${config.driveFolderId}' in parents and trashed = false`,
    key: ctx.driveApiKey,
    fields: 'files(id,name,mimeType,webViewLink,createdTime)',
    pageSize: '50',
  });

  let raw: string;
  try {
    raw = await ctx.fetchText(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  } catch (e) {
    return {
      outputs: [],
      error: `Could not list the Drive folder: ${e instanceof Error ? e.message : String(e)}. Confirm the folder is shared as "Anyone with the link can view" — a private folder returns 404 with an API key, not 403, because the key has no identity to be denied against.`,
    };
  }

  let body: { files?: DriveFile[] };
  try {
    body = JSON.parse(raw) as { files?: DriveFile[] };
  } catch {
    return { outputs: [], error: 'Drive returned a response that was not valid JSON.' };
  }

  const files = (body.files ?? []).map((f) => ({
    title: f.name,
    sourceUrl: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  }));
  return {
    outputs: files
      .filter((f) => isNew(ctx, f))
      .slice(0, config.perRun)
      .map((f) => itemOutput(ctx, config, { ...f, lead: 'From the connected Drive folder' })),
  };
}

interface CanvaDesign {
  id: string;
  title?: string;
  urls?: { view_url?: string; edit_url?: string };
  thumbnail?: { url?: string };
}

async function runBulkConnectorCanva(config: BulkRun, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  if (!ctx.getOAuthAccessToken || !ctx.fetchWithAuth) {
    return { outputs: [], error: 'Canva is not connected — no OAuth integration is wired into this run context.' };
  }
  const token = await ctx.getOAuthAccessToken('canva');
  if (!token) {
    return { outputs: [], error: 'Canva is not connected for this brand — use brand.oauth.connect (Canva) first.' };
  }
  if (!config.canvaFolderId) return { outputs: [], error: 'A canvaFolderId is required for the canva source.' };

  let raw: string;
  try {
    raw = await ctx.fetchWithAuth(`https://api.canva.com/rest/v1/folders/${encodeURIComponent(config.canvaFolderId)}/items`, token);
  } catch (e) {
    return {
      outputs: [],
      error: `Could not list the Canva folder: ${e instanceof Error ? e.message : String(e)}. This is the least-verified integration in the codebase (see packages/agency/src/canva.ts's own comment) — if this is a 404, the endpoint path itself may need correcting against Canva's current API docs.`,
    };
  }

  let body: { items?: Array<{ design?: CanvaDesign }> };
  try {
    body = JSON.parse(raw) as { items?: Array<{ design?: CanvaDesign }> };
  } catch {
    return { outputs: [], error: 'Canva returned a response that was not valid JSON.' };
  }

  const designs = (body.items ?? [])
    .map((i) => i.design)
    .filter((d): d is CanvaDesign => !!d)
    .map((d) => ({ title: d.title ?? 'Untitled design', sourceUrl: d.urls?.view_url ?? `https://www.canva.com/design/${d.id}` }));
  return {
    outputs: designs
      .filter((d) => isNew(ctx, d))
      .slice(0, config.perRun)
      .map((d) => itemOutput(ctx, config, { ...d, lead: 'From the connected Canva folder' })),
  };
}
