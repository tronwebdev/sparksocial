import { z } from 'zod';
import type { Genome } from '@sparksocial/shared/genome';
import { checkPublicHttpUrl } from '@sparksocial/shared/safeUrl';
import type { AssetInventory } from '@sparksocial/playbooks';
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

export interface RecipeOutputPreview {
  title: string;
  intent: string;
  sourceUrl?: string;
  playbookId?: string;
  referencedAssetIds?: string[];
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
}

export interface RecipeRunResult {
  outputs: RecipeOutputPreview[];
  error?: string;
}

export async function runRecipe(kind: string, config: unknown, ctx: RecipeRunContext): Promise<RecipeRunResult> {
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

export const AutoTrendConfig = z.object({
  region: z.string().optional(),
  language: z.string().optional(),
  minScore: z.number().min(0).max(1).default(0.4),
  maxOutputs: z.number().int().min(1).max(10).default(3),
});

async function runAutoTrend(rawConfig: unknown, ctx: RecipeRunContext): Promise<RecipeRunResult> {
  const parsed = AutoTrendConfig.safeParse(rawConfig);
  if (!parsed.success) return { outputs: [], error: 'Invalid auto_trend config.' };
  const config = parsed.data;

  const fetched = await ctx.trendSource.fetch({
    limit: Math.max(config.maxOutputs * 3, 20),
    ...(config.region ? { region: config.region } : {}),
    ...(config.language ? { language: config.language } : {}),
  });
  const { ranked } = rankTrends(ctx.genome, fetched);
  const eligible = ranked.filter((r) => r.score >= config.minScore).slice(0, config.maxOutputs);

  const outputs: RecipeOutputPreview[] = [];
  for (const r of eligible) {
    const { suggestion } = suggestRepurpose(ctx.genome, ctx.assets, r.trend);
    if (!suggestion) continue;
    outputs.push({
      title: r.trend.topic,
      intent: suggestion.intent,
      playbookId: suggestion.playbookId,
      referencedAssetIds: [],
    });
  }
  return { outputs };
}

/* ── rss ─────────────────────────────────────────────────────────────── */

export const RssConfig = z.object({
  feedUrl: z.string().url(),
  maxItems: z.number().int().min(1).max(20).default(5),
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

  const items = parseFeed(xml, config.maxItems);
  return {
    outputs: items.map((item) => ({
      title: item.title,
      intent: `New from the feed: "${item.title}"`,
      sourceUrl: item.link,
    })),
  };
}

/* ── bulk_connector ──────────────────────────────────────────────────── */

export const BulkConnectorConfig = z.object({
  source: z.enum(['csv', 'canva', 'drive', 'folder']),
  csvUrl: z.string().url().optional(),
  csvText: z.string().optional(),
  /** The Drive folder to list. Must be shared "Anyone with the link can view" — this reads through a single shared API key, not a per-brand OAuth connection, so it can only ever see what's public. */
  driveFolderId: z.string().optional(),
  /** The Canva folder to list designs from — read through the brand's own connected Canva account (brand.oauth.connect). */
  canvaFolderId: z.string().optional(),
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

async function runBulkConnectorCsv(config: { csvUrl?: string; csvText?: string }, ctx: RecipeRunContext): Promise<RecipeRunResult> {
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
  return {
    outputs: records.map((row) => {
      const title = row.title || row.topic || Object.values(row)[0] || 'Untitled row';
      return { title, intent: `From the imported sheet: "${title}"` };
    }),
  };
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  createdTime?: string;
}

async function runBulkConnectorDrive(config: { driveFolderId?: string }, ctx: RecipeRunContext): Promise<RecipeRunResult> {
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

  return {
    outputs: (body.files ?? []).map((f) => ({
      title: f.name,
      intent: `From the connected Drive folder: "${f.name}"`,
      sourceUrl: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
    })),
  };
}

interface CanvaDesign {
  id: string;
  title?: string;
  urls?: { view_url?: string; edit_url?: string };
  thumbnail?: { url?: string };
}

async function runBulkConnectorCanva(config: { canvaFolderId?: string }, ctx: RecipeRunContext): Promise<RecipeRunResult> {
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

  return {
    outputs: (body.items ?? [])
      .map((i) => i.design)
      .filter((d): d is CanvaDesign => !!d)
      .map((d) => ({
        title: d.title ?? 'Untitled design',
        intent: `From the connected Canva folder: "${d.title ?? 'Untitled design'}"`,
        sourceUrl: d.urls?.view_url ?? `https://www.canva.com/design/${d.id}`,
      })),
  };
}
