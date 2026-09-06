import { KIND_META, type RecipeKind } from './recipeMeta';

/**
 * Everything the wizard collects, and how it maps onto a recipe config.
 *
 * Kept apart from the components because three of them write to it and
 * `AutomationScreen` turns it into `config` — and the mapping is the part worth
 * reading in one place, since every field below is either a real column of
 * `AutoTrendConfig` / `RssConfig` / `BulkConnectorConfig` or is not collected at
 * all. See `runners.ts` for those three schemas.
 */

export interface WizardDraft {
  kind: RecipeKind;
  name: string;
  /** `RecipeCommonConfig.targetPlatforms` — stored, not yet read by the engine. */
  targetPlatforms: string[];

  /* ── AutoTrend ─────────────────────────────────────────────────────── */
  /** The design's "Choose Recipe Type". Only `repurpose` is what the runner does. */
  recipeType: 'repurpose' | 'reshare';
  queryTab: 'keywords' | 'influencers';
  keywords: string[];
  excludeKeywords: string[];
  /** `AutoTrendConfig.region` / `.language` — both passed to `TrendSource.fetch`. */
  region: string;
  language: string;
  /** `AutoTrendConfig.minScore` — how strong a signal before the recipe acts. */
  signal: number;
  /** `AutoTrendConfig.maxOutputs` — posts a single run may produce. */
  maxOutputs: number;
  brandSafety: boolean;

  /* ── Bulk Connector ────────────────────────────────────────────────── */
  bulkSource: 'csv' | 'canva' | 'drive' | 'folder';
  /** The picked file, read in the browser and sent as `csvText`. No URL, no id. */
  csvName: string;
  csvText: string;
  /** A Canva or Drive folder *link* — the id is pulled out of it. */
  canvaUrl: string;
  driveUrl: string;

  /* ── RSS ───────────────────────────────────────────────────────────── */
  feedUrl: string;
  feedType: 'News/Blogs' | 'Podcast Stations';

  /* ── frequency, CTA & schedule ─────────────────────────────────────── */
  cadence: 'custom' | 'regular';
  /** Custom mode's named cadence. */
  frequency: 'daily' | 'weekdays' | 'weekly';
  /** Regular mode's raw interval. */
  everyN: number;
  everyUnit: 'hours' | 'days';
  startDate: string;
  endDate: string;
  /** `RecipeCommonConfig.goal` — applied, folded into every output's intent. */
  goal: string;
  /** `RecipeCommonConfig.ctaUrl` — stored, not applied. See that field's own note. */
  ctaUrl: string;
  reviewFirst: boolean;
  startToday: boolean;
}

export function emptyDraft(kind: RecipeKind): WizardDraft {
  return {
    kind,
    name: KIND_META[kind].name,
    targetPlatforms: [],
    recipeType: 'repurpose',
    queryTab: 'keywords',
    keywords: [],
    excludeKeywords: [],
    region: '',
    language: '',
    /* The schema's own default. */
    signal: 0.4,
    maxOutputs: 3,
    brandSafety: false,
    bulkSource: 'csv',
    csvName: '',
    csvText: '',
    canvaUrl: '',
    driveUrl: '',
    feedUrl: '',
    feedType: 'News/Blogs',
    cadence: 'custom',
    frequency: 'daily',
    everyN: 6,
    everyUnit: 'hours',
    startDate: '',
    endDate: '',
    goal: '',
    ctaUrl: '',
    reviewFirst: true,
    startToday: true,
  };
}

/**
 * How often the scheduler polls this recipe, in minutes.
 *
 * Both halves of the design's toggle land here, because `intervalMinutes` is
 * the only cadence a recipe has: "Daily" is 1440, "every 6 hours" is 360.
 * Weekdays is 1440 too — the engine has no day-of-week filter, which is why the
 * step says so next to the option rather than letting it look scheduled.
 */
export function intervalMinutesFor(d: WizardDraft): number {
  if (d.cadence === 'regular') {
    const minutes = d.everyUnit === 'days' ? d.everyN * 1440 : d.everyN * 60;
    return Math.min(60 * 24 * 7, Math.max(15, Math.round(minutes)));
  }
  return d.frequency === 'weekly' ? 60 * 24 * 7 : 1440;
}

/** A Canva or Drive folder id, from whatever the person pasted. */
export function folderIdFrom(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const canva = raw.match(/\/folder\/([A-Za-z0-9_-]+)/);
  if (canva?.[1]) return canva[1];
  const drive = raw.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (drive?.[1]) return drive[1];
  /* Not a link — assume they pasted the id itself, which is still valid input. */
  return raw;
}

/** `YYYY-MM-DD` from a date input to the ISO datetime the config wants. */
function isoFrom(day: string, endOfDay = false): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The `config` object `recipe.create` stores for this draft. */
export function configFor(d: WizardDraft): Record<string, unknown> {
  const common: Record<string, unknown> = {
    reviewBeforePublish: d.reviewFirst,
    ...(d.targetPlatforms.length ? { targetPlatforms: d.targetPlatforms } : {}),
    ...(d.goal.trim() ? { goal: d.goal.trim() } : {}),
    /* `ctaUrl` is `.url()` on the schema — an unparseable one would fail the
       whole create, so a half-typed link is simply not sent. */
    ...(/^https?:\/\/\S+$/i.test(d.ctaUrl.trim()) ? { ctaUrl: d.ctaUrl.trim() } : {}),
    ...(d.cadence === 'custom' && !d.startToday && isoFrom(d.startDate) ? { startAt: isoFrom(d.startDate) } : {}),
    ...(d.cadence === 'custom' && isoFrom(d.endDate, true) ? { endAt: isoFrom(d.endDate, true) } : {}),
  };

  if (d.kind === 'rss') return { ...common, feedUrl: d.feedUrl.trim() };

  if (d.kind === 'auto_trend') {
    return {
      ...common,
      minScore: d.signal,
      maxOutputs: d.maxOutputs,
      ...(d.region ? { region: d.region } : {}),
      ...(d.language ? { language: d.language } : {}),
      ...(d.keywords.length ? { keywords: d.keywords } : {}),
      ...(d.excludeKeywords.length ? { excludeKeywords: d.excludeKeywords } : {}),
    };
  }

  if (d.bulkSource === 'csv') return { ...common, source: 'csv', csvText: d.csvText };
  if (d.bulkSource === 'canva') return { ...common, source: 'canva', canvaFolderId: folderIdFrom(d.canvaUrl) };
  if (d.bulkSource === 'drive') return { ...common, source: 'drive', driveFolderId: folderIdFrom(d.driveUrl) };
  return { ...common, source: 'folder' };
}
