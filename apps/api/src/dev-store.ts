import { randomUUID } from 'node:crypto';
import type { ScopedDb } from '@sparksocial/tools';
import type { AssetRole, Genome, Role } from '@sparksocial/shared';
import { EMBEDDING_DIM, deterministicEmbedding } from '@sparksocial/shared/embedding';
import { createDevRunStore, type DevRunStore } from './dev-runs.js';
import { createDevCampaignStore } from './dev-campaigns.js';
import { createDevBrandStore } from './dev-brands.js';
import { createDevApprovalStore } from './dev-approvals.js';
import { createDevHumanLoopStore } from './dev-human-loop.js';
import { createDevConsentStore } from './dev-consent.js';
import type {
  ApprovalStore,
  BrandGovernanceStore,
  CampaignStore,
  ConsentStore,
  ContentDraft,
  ContentLinkRecord,
  ContentMetricsSnapshot,
  EngagementMessage,
  HumanLoopStore,
  LearningArm,
  OAuthConnectionRecord,
  OrgSettingsRecord,
  Opportunity,
  RecipeOutputRecord,
  RecipeRecord,
  RenderRecord,
  TrendObservation,
  TrendWatchlistEntry,
} from '@sparksocial/tools/defineTool';
import type { ToolCallRecord } from '@sparksocial/tools';
import type { DueContentSource } from '@sparksocial/db';

/**
 * DEVELOPMENT STORE — in-memory, empty until something real writes to it.
 *
 * Stands in for `@sparksocial/db` until Postgres is wired. Holds nothing at
 * boot: every genome, asset, draft and run in here exists only because a real
 * tool call created it, the same as it would against Postgres. The §13 golden
 * cases (`@sparksocial/playbooks`'s `GOLDEN_SET`) are exercised directly by the
 * acceptance eval and by tests that import them as fixtures — they have no
 * business being pre-loaded into a store a live user session also reads from,
 * which is exactly how a fixture's business name ends up on someone's real
 * dashboard.
 *
 * Every accessor takes `orgId` and filters on it, mirroring the scoped layer's
 * shape — a dev store that ignored tenancy would train the wrong habits into
 * every handler written against it.
 *
 * Assets are real rows, not static counts: `inventory()` is *computed* from
 * whatever `create()` has added, so `asset.ingest_url` followed by
 * `playbook.resolve` shows the new asset immediately, the same way Postgres
 * would. Retrieval mirrors `packages/db/src/scoped.ts::buildRetrieveQuery`'s
 * scoring in plain JS (cosine similarity minus a recency penalty minus a usage
 * penalty) — same formula, no SQL, because there is no database here to run it
 * against.
 */

interface GenomeRow {
  genome: Genome;
  orgId: string;
}

interface AssetRow {
  id: string;
  genomeId: string;
  orgId: string;
  role: AssetRole;
  mediaType: 'image' | 'video' | 'audio';
  rightsStatus: 'cleared' | 'pending' | 'restricted';
  caption: string;
  embedding: number[];
  usageCount: number;
  lastUsedAt: Date | null;
  source: string;
  url: string;
  folderId: string | null;
}

interface AssetFolderRow {
  id: string;
  genomeId: string;
  orgId: string;
  name: string;
  createdAt: Date;
}

interface ContentRow {
  genomeId: string;
  orgId: string;
  isAvatarFormat: boolean;
  embedding: number[] | null;
  publishedAt: Date;
}

/**
 * Re-exported so existing importers keep working, but the values now come from
 * `@sparksocial/shared` — the same constant `schema.ts` uses for its
 * `vector(N)` columns.
 *
 * These were independent: 8 here, 1536 in the schema. Nothing compared them, so
 * every test passed and the first insert against real Postgres would have
 * failed with a dimension error. A fake whose *shape* differs from production
 * is not a fake, it is a second implementation.
 */
export const EMBED_DIM = EMBEDDING_DIM;
export { deterministicEmbedding };

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mirrors buildRetrieveQuery's SQL — same shape, computed in JS against the Map. */
function score(a: AssetRow, queryEmbedding: number[], now: Date, cooldownDays = 21): number {
  const similarity = cosineSimilarity(a.embedding, queryEmbedding);
  const recencyPenalty = a.lastUsedAt
    ? Math.max(0, 1 - (now.getTime() - a.lastUsedAt.getTime()) / (86_400_000 * cooldownDays)) * 0.5
    : 0;
  const diversityPenalty = Math.min(a.usageCount * 0.03, 0.3);
  return similarity - recencyPenalty - diversityPenalty;
}

export interface DevStoreOptions {
  /**
   * The run store is injected rather than created here because the *recorder*
   * half of it belongs to the agent endpoint, and both halves must be the same
   * arrays — a timeline reading a different store than the loop writes to would
   * always render empty.
   */
  runStore?: DevRunStore;
  campaignStore?: CampaignStore;
  brandStore?: BrandGovernanceStore;
  /**
   * The queue reads inputs back from the audit rows rather than copying them,
   * so it needs a way to reach them. `memoryInvokeDeps` owns that array, which
   * is why this is injected from `index.ts` rather than constructed here.
   */
  approvalStore?: ApprovalStore;
  humanLoopStore?: HumanLoopStore;
  consentStore?: ConsentStore;
  /**
   * How `agent.explain` reaches a recorded call. Same injection and same reason
   * as `approvalStore`: the audit rows live in `memoryInvokeDeps`, and copying
   * them into this store would create a second version of what happened that
   * can disagree with the first.
   */
  findCall?: (callId: string) => ToolCallRecord | undefined;
  /**
   * Every audit row, for `metrics.toolActivity` — PRD §5's publish-attempt,
   * block and draft counts.
   *
   * Injected for the same reason `findCall` is: the rows live in
   * `memoryInvokeDeps`, and copying them into this store would create a second
   * version of what happened that can disagree with the first.
   */
  allCalls?: () => ToolCallRecord[];
}

export function createDevStore(
  opts: DevStoreOptions = {},
): ScopedDb & { seedCount: number; runs: ScopedDb['runs']; findDue: DueContentSource['findDue'] } {
  const {
    runStore = createDevRunStore(),
    campaignStore = createDevCampaignStore(),
    brandStore = createDevBrandStore(),
    approvalStore = createDevApprovalStore(() => undefined),
    humanLoopStore = createDevHumanLoopStore(),
    consentStore = createDevConsentStore(),
    findCall = () => undefined,
    allCalls = () => [],
  } = opts;
  const genomes = new Map<string, GenomeRow>();
  const assets = new Map<string, AssetRow>();
  const assetFolders = new Map<string, AssetFolderRow>();
  const content: ContentRow[] = [];
  // Drafts and scheduled slots — separate from `content`, which only ever
  // holds the *published* seed history `recent()` reads. A draft's fuller
  // shape (copy/why/status) has no seed data and no reason to share a type
  // with rows that are `isAvatarFormat`+`embedding`-only by construction.
  const drafts = new Map<string, ContentDraft & { orgId: string }>();
  // Keyed on `${contentItemId}:${platform}` — the same upsert target the real
  // schema's unique index enforces, so a re-sync overwrites in dev mode too.
  const metrics = new Map<string, ContentMetricsSnapshot & { orgId: string; genomeId: string }>();
  const contentLinks: (ContentLinkRecord & { orgId: string })[] = [];
  // Keyed by row id; a second map from `${platform}:${externalId}` enforces
  // the same at-least-once-delivery upsert the real unique index does.
  const engagementMessages = new Map<string, EngagementMessage & { orgId: string }>();
  const engagementByExternalId = new Map<string, string>(); // "orgId:genomeId:platform:externalId" -> message id
  const renders: (RenderRecord & { orgId: string; genomeId: string })[] = [];
  const opportunities: (Opportunity & { orgId: string })[] = [];
  const trendWatchlist: (TrendWatchlistEntry & { orgId: string; genomeId: string })[] = [];
  /** `DISC-02`'s time series, keyed by [source, trendId, hour] — the same bucket the Postgres unique index enforces. */
  const trendObservationRows = new Map<string, TrendObservation>();
  // Keyed on `${genomeId}:${pillar}` — one arm per (genome, pillar), same unique target as the real schema.
  const learningArms = new Map<string, LearningArm & { orgId: string; genomeId: string }>();
  const scoredContentItems = new Set<string>(); // idempotency for recordOutcome, mirrors the real unique index on contentItemId
  const recipes = new Map<string, RecipeRecord & { orgId: string }>();
  const recipeRuns = new Map<string, { id: string; recipeId: string; orgId: string; genomeId: string }>();
  const recipeOutputs: (RecipeOutputRecord & { orgId: string })[] = [];
  // Keyed on `${genomeId}:${provider}` — one connection per (genome, provider), same unique target as the real schema.
  const oauthConnectionsMap = new Map<string, OAuthConnectionRecord & { orgId: string }>();
  const knowledgeChunkRows: Array<{ id: string; orgId: string; genomeId: string; docId: string; text: string; citation?: unknown; createdAt: Date }> = [];
  // Typed as the record itself rather than a hand-listed copy of its fields —
  // the inline literal is how this drifted when §8.12's 2FA/residency/retention
  // columns landed.
  const orgSettingsMap = new Map<string, OrgSettingsRecord>();
  const brandMemberRows = new Map<string, { orgId: string; brandId: string; userId: string; role: Role; createdAt: Date }>();
  const reviewLinkRows = new Map<string, { id: string; orgId: string; token: string; brandId: string; scope: 'calendar' | 'content_item'; targetId?: string; createdBy: string; expiresAt: Date; createdAt: Date; revokedAt?: Date }>();

  let nextDraft = 1;
  let nextRecipe = 1;
  let nextRun = 1;
  let nextOutput = 1;

  return {
    seedCount: genomes.size,

    genomes: {
      async createDraft({ brandId, orgId: org, identity, dimensions, voice }) {
        const id = `gen_draft_${nextDraft++}`;
        // Built from what the caller actually supplied — `genome.create` sends
        // a name and category the owner typed, `genome.bootstrap_from_url`
        // sends what the crawl inferred. Neither ever runs through here as a
        // clone of a fixture, so a genome this store hands back always traces
        // to one real operation instead of to `@sparksocial/playbooks`'s
        // golden set. `dimensions`/`voice` are commonly `{}` at this point —
        // onboarding fills them in next via `genome.dimensions.set`/
        // `genome.identity.set` — so every field the caller didn't resolve
        // gets a neutral, empty default rather than a borrowed one.
        genomes.set(id, {
          genome: {
            genome_id: id,
            workspace_id: brandId,
            version: 1,
            identity: identity as Genome['identity'],
            dimensions: (dimensions ?? {}) as Genome['dimensions'],
            voice: {
              tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 },
              pov_statements: [],
              banned_phrases: [],
              required_disclaimers: [],
              reading_level: 8,
              ...(voice as Partial<Genome['voice']>),
            },
            audience: { segments: [] },
            offer: { products: [], primary_cta: '' },
            constraints: {
              compliance_profile: 'none',
              avatar_enabled: false,
              max_posts_per_week: 12,
              approval_mode: 'review_first_week',
              avatar_override: null,
            },
            learned: { top_formats: [], best_post_times: [], mix_weights_override: null, confidence: 0, frozen: false },
          },
          orgId: org,
        });
        return { id };
      },

      async patchDimensions({ genomeId, orgId: org, dimensions, avatarEnabled }) {
        const row = genomes.get(genomeId);
        if (!row || row.orgId !== org) return { id: genomeId, version: 1 };
        row.genome = {
          ...row.genome,
          version: row.genome.version + 1,
          dimensions: dimensions as Genome['dimensions'],
          constraints: { ...row.genome.constraints, avatar_enabled: avatarEnabled },
        };
        return { id: genomeId, version: row.genome.version };
      },

      async patchConstraints({ genomeId, orgId: org, patch }) {
        const row = genomes.get(genomeId);
        if (!row || row.orgId !== org) return { id: genomeId, version: 1 };
        row.genome = {
          ...row.genome,
          version: row.genome.version + 1,
          constraints: {
            ...row.genome.constraints,
            ...(patch.heygenAvatarId !== undefined ? { heygen_avatar_id: patch.heygenAvatarId } : {}),
            ...(patch.elevenlabsVoiceId !== undefined ? { elevenlabs_voice_id: patch.elevenlabsVoiceId } : {}),
            ...(patch.complianceProfile !== undefined ? { compliance_profile: patch.complianceProfile } : {}),
            ...(patch.avatarEnabled !== undefined ? { avatar_enabled: patch.avatarEnabled } : {}),
            ...(patch.avatarOverride !== undefined
              ? {
                  avatar_override: patch.avatarOverride
                    ? { reason: patch.avatarOverride.reason, set_by: patch.avatarOverride.setBy, set_at: patch.avatarOverride.setAt }
                    : null,
                }
              : {}),
          },
        };
        return { id: genomeId, version: row.genome.version };
      },

      async patchIdentity({ genomeId, orgId: org, identity }) {
        const row = genomes.get(genomeId);
        if (!row || row.orgId !== org) return { id: genomeId, version: 1 };
        row.genome = {
          ...row.genome,
          version: row.genome.version + 1,
          identity: { ...row.genome.identity, ...identity },
        };
        return { id: genomeId, version: row.genome.version };
      },

      async patchOffer({ genomeId, orgId: org, offer }) {
        const row = genomes.get(genomeId);
        if (!row || row.orgId !== org) return { id: genomeId, version: 1 };
        row.genome = {
          ...row.genome,
          version: row.genome.version + 1,
          offer: { ...row.genome.offer, ...offer },
        };
        return { id: genomeId, version: row.genome.version };
      },

      async patchLearned({ genomeId, orgId: org, patch }) {
        const row = genomes.get(genomeId);
        if (!row || row.orgId !== org) return { id: genomeId, version: 1 };
        row.genome = {
          ...row.genome,
          version: row.genome.version + 1,
          learned: { ...row.genome.learned, ...patch },
        };
        return { id: genomeId, version: row.genome.version };
      },

      async get(genomeId, org) {
        const row = genomes.get(genomeId);
        // Scope mismatch reads as "not found", never as someone else's genome.
        return row && row.orgId === org ? row.genome : undefined;
      },

      async listForOrg(org) {
        return [...genomes.entries()]
          .filter(([, row]) => row.orgId === org)
          .map(([id, row]) => ({
            id,
            brandId: row.genome.workspace_id,
            name: row.genome.identity.business_name,
            updatedAt: new Date(),
          }));
      },
    },

    assets: {
      async inventory(genomeId, org) {
        const counts: Partial<Record<AssetRole, number>> = {};
        for (const a of assets.values()) {
          if (a.genomeId !== genomeId || a.orgId !== org || a.rightsStatus !== 'cleared') continue;
          counts[a.role] = (counts[a.role] ?? 0) + 1;
        }
        return counts;
      },

      async retrieve({ genomeId, orgId: org, embedding, requiredRoles, k }) {
        const now = new Date();
        const pool = [...assets.values()].filter(
          (a) =>
            a.genomeId === genomeId &&
            a.orgId === org &&
            a.rightsStatus === 'cleared' &&
            (!requiredRoles?.length || requiredRoles.includes(a.role)),
        );
        return pool
          .map((a) => ({
            assetId: a.id,
            role: a.role,
            caption: a.caption,
            score: score(a, embedding, now),
            usageCount: a.usageCount,
            lastUsedAt: a.lastUsedAt,
            rightsStatus: a.rightsStatus,
            url: a.url,
            mediaType: a.mediaType,
            folderId: a.folderId,
          }))
          .sort((x, y) => y.score - x.score)
          .slice(0, k);
      },

      async create({ genomeId, orgId: org, url, assetRole, mediaType, rightsStatus, caption, embedding, source }) {
        const id = randomUUID();
        assets.set(id, {
          id,
          genomeId,
          orgId: org,
          role: assetRole,
          mediaType,
          rightsStatus,
          caption,
          embedding,
          usageCount: 0,
          lastUsedAt: null,
          source,
          url,
          folderId: null,
        });
        return { id };
      },

      async captionsByRole(genomeId, org, roles) {
        return [...assets.values()]
          .filter((a) => a.genomeId === genomeId && a.orgId === org && roles.includes(a.role))
          .map((a) => a.caption);
      },

      async info(ids, genomeId, org) {
        const now = Date.now();
        const out: Record<string, { rightsStatus: string; lastUsedDaysAgo?: number; url: string; mediaType: string }> = {};
        for (const id of ids) {
          const a = assets.get(id);
          if (!a || a.genomeId !== genomeId || a.orgId !== org) continue;
          out[id] = {
            rightsStatus: a.rightsStatus,
            lastUsedDaysAgo: a.lastUsedAt ? (now - a.lastUsedAt.getTime()) / 86_400_000 : undefined,
            url: a.url,
            mediaType: a.mediaType,
          };
        }
        return out;
      },

      async setRights({ id, genomeId, orgId: org, rightsStatus }) {
        const a = assets.get(id);
        if (!a || a.genomeId !== genomeId || a.orgId !== org) return undefined;
        a.rightsStatus = rightsStatus;
        return { id, rightsStatus };
      },

      async recordUsage({ id, genomeId, orgId: org }) {
        const a = assets.get(id);
        if (!a || a.genomeId !== genomeId || a.orgId !== org) return undefined;
        a.usageCount += 1;
        a.lastUsedAt = new Date();
        return { id, usageCount: a.usageCount, lastUsedAt: a.lastUsedAt };
      },

      async moveToFolder({ id, genomeId, orgId: org, folderId }) {
        const a = assets.get(id);
        if (!a || a.genomeId !== genomeId || a.orgId !== org) return undefined;
        if (folderId) {
          const folder = assetFolders.get(folderId);
          if (!folder || folder.genomeId !== genomeId || folder.orgId !== org) return undefined;
        }
        a.folderId = folderId;
        return { id, folderId };
      },
    },

    assetFolders: {
      async create({ genomeId, orgId: org, name }) {
        const id = randomUUID();
        const row = { id, genomeId, orgId: org, name, createdAt: new Date() };
        assetFolders.set(id, row);
        // A brand-new folder is empty, and `LIB-01` shows the count.
        return { ...row, assetCount: 0 };
      },

      async list(genomeId, org) {
        return [...assetFolders.values()]
          .filter((f) => f.genomeId === genomeId && f.orgId === org)
          .sort((a, b) => a.name.localeCompare(b.name))
          // Counted from the same `assets` map the real query counts from, so an
          // empty folder still reports zero rather than being omitted — see
          // `listAssetFolders`'s left join.
          .map((f) => ({
            ...f,
            assetCount: [...assets.values()].filter((a) => a.orgId === org && a.folderId === f.id).length,
          }));
      },
    },

    content: {
      async recent(genomeId, org, windowDays) {
        const cutoff = Date.now() - windowDays * 86_400_000;
        return content
          .filter((c) => c.genomeId === genomeId && c.orgId === org && c.publishedAt.getTime() >= cutoff)
          .map((c) => ({ isAvatarFormat: c.isAvatarFormat, embedding: c.embedding }));
      },

      async createDraft({ genomeId, orgId: org, playbookId, mode, pillar, copy, why, campaignId, recipeId, intent, sourceTrendId, scheduledAt }) {
        const row: ContentDraft & {
          orgId: string;
          recipeId?: string;
          intent?: string;
          sourceTrendId?: string;
        } = {
          id: randomUUID(),
          orgId: org,
          genomeId,
          playbookId,
          mode,
          // Same rule as `scoped.createContentDraft`: a row created with a date
          // is created scheduled.
          status: scheduledAt ? 'scheduled' : 'draft',
          copy,
          why,
          createdAt: new Date(),
          ...(pillar ? { pillar } : {}),
          ...(campaignId ? { campaignId } : {}),
          ...(recipeId ? { recipeId } : {}),
          ...(intent ? { intent } : {}),
          ...(sourceTrendId ? { sourceTrendId } : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        };
        drafts.set(row.id, row);
        return row;
      },

      async get(id, genomeId, org) {
        const row = drafts.get(id);
        return row && row.orgId === org && row.genomeId === genomeId ? row : undefined;
      },

      async updateDraft({ id, genomeId, orgId: org, copy, why }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;
        if (row.status === 'published') return undefined;
        row.copy = copy;
        row.why = why;
        return row;
      },

      async list(genomeId, org, { status, limit }) {
        // Ad-hoc drafts only — calendar-slot rows live in `campaignStore`'s own
        // map in dev mode (see the note on the `drafts` declaration above), a
        // pre-existing dev-store simplification this doesn't newly introduce.
        return [...drafts.values()]
          .filter((r) => r.orgId === org && r.genomeId === genomeId && (!status || r.status === status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      },

      async schedule({ id, genomeId, orgId: org, scheduledAt }) {
        // Same `drafts`-only reach as `list`/`get` — see the note above.
        const row = drafts.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;
        if (row.status === 'published') return undefined;
        row.scheduledAt = scheduledAt;
        row.status = 'scheduled';
        return row;
      },

      async markPublished({ id, orgId: org, platform, embedding, externalId, via, url }) {
        // Same `drafts`-only reach as `list`/`get`/`schedule`. `content` (the
        // published-history array `recent()` reads) is seed-only in dev mode —
        // see the note on its declaration above — so a real publish through
        // this store flips the draft row's status (which is what stops
        // `findDue` re-selecting it) and carries the receipt, but does not
        // feed `recent()`; the seeded rows there already exist for exactly
        // that purpose. The embedding itself has nowhere to go — `ContentDraft`
        // has no field for it, the same honest gap `recent()`'s seed rows fill.
        const row = drafts.get(id);
        if (!row || row.orgId !== org) return;
        row.status = 'published';
        // PRD §5's "time to first post" measures to here, so the dev store has
        // to stamp it too — a metric that is real under Postgres and null in
        // development is a metric nobody trusts.
        row.publishedAt = new Date();
        row.platform = platform;
        row.externalId = externalId;
        row.via = via;
        if (url) row.url = url;
        void embedding;
      },

      async markRolledBack({ id, orgId: org }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org) return;
        row.status = 'rolled_back';
      },

      async markBlocked({ id, orgId: org, reason }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org) return;
        row.status = 'blocked';
        row.blockedReason = reason;
      },

      async markNeedsReview({ id, orgId: org, reason }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org) return;
        row.status = 'needs_review';
        row.blockedReason = reason;
      },

      async markApproved({ id, orgId: org }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org) return;
        row.status = 'approved';
        delete row.blockedReason;
      },

      async markRejected({ id, orgId: org, reason }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org) return;
        row.status = 'draft';
        row.blockedReason = reason;
      },

      /**
       * Mirrors `scoped.contentPublishOrigin`, including its defaults: no
       * recipe means not automation, an unreadable recipe config means review.
       * Implemented here rather than left to throw for the reason the file
       * header gives — a policy branch that fires under Postgres and is inert
       * in development is a bug nobody finds until it is live.
       */
      async publishOrigin({ id, genomeId, orgId: org }) {
        const row = drafts.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;

        // PRD §7.2's per-campaign approval scope, same as the real join — read
        // through the campaign store this store already holds rather than a
        // second copy of the rows.
        const campaignMode = row.campaignId
          ? (await campaignStore.get(row.campaignId, org))?.approvalMode
          : undefined;
        const modePart = campaignMode
          ? { campaignApprovalMode: campaignMode as 'autopublish' | 'review_first_week' | 'review_everything' }
          : {};

        const recipeId = (row as { recipeId?: string }).recipeId;
        if (!recipeId) return { reviewBeforePublish: false, ...modePart };
        const cfg = recipes.get(recipeId)?.config as { reviewBeforePublish?: unknown } | undefined;
        return {
          recipeId,
          reviewBeforePublish: typeof cfg?.reviewBeforePublish === 'boolean' ? cfg.reviewBeforePublish : true,
          ...modePart,
        };
      },

      async pendingReviewCount(genomeId, org) {
        return [...drafts.values()].filter(
          (r) => r.orgId === org && r.genomeId === genomeId && r.status === 'needs_review',
        ).length;
      },

      async recordRender({ contentItemId, genomeId, orgId: org, aspect, storageUrl, engine, costCents }) {
        const row: RenderRecord & { orgId: string; genomeId: string } = {
          id: randomUUID(),
          contentItemId,
          orgId: org,
          genomeId,
          aspect,
          storageUrl,
          engine,
          costCents,
          createdAt: new Date(),
        };
        renders.push(row);
        return row;
      },

      async listRenders(contentItemId, genomeId, org) {
        return renders
          .filter((r) => r.contentItemId === contentItemId && r.orgId === org && r.genomeId === genomeId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },

    analytics: {
      async record({ genomeId, orgId: org, contentItemId, platform, likes, comments, shares, views, impressions, saves }) {
        const snapshot: ContentMetricsSnapshot = {
          contentItemId,
          platform,
          likes,
          comments,
          shares,
          views,
          impressions,
          saves,
          syncedAt: new Date(),
        };
        metrics.set(`${contentItemId}:${platform}`, { ...snapshot, orgId: org, genomeId });
        return snapshot;
      },

      async listForItems(contentItemIds, org, genomeId) {
        const ids = new Set(contentItemIds);
        return [...metrics.values()]
          .filter((m) => ids.has(m.contentItemId) && m.orgId === org && m.genomeId === genomeId)
          .map(({ orgId: _orgId, genomeId: _genomeId, ...snapshot }) => snapshot);
      },
    },

    ctaLinks: {
      async create({ genomeId, orgId: org, contentItemId, dubLinkId, shortUrl, destinationUrl }) {
        const row: ContentLinkRecord & { orgId: string } = {
          id: randomUUID(), genomeId, orgId: org, contentItemId, dubLinkId, shortUrl, destinationUrl, createdAt: new Date(),
        };
        contentLinks.push(row);
        return row;
      },

      async listForItems(contentItemIds, org, genomeId) {
        const ids = new Set(contentItemIds);
        return contentLinks
          .filter((l) => ids.has(l.contentItemId) && l.orgId === org && l.genomeId === genomeId)
          .map(({ orgId: _orgId, ...row }) => row);
      },
    },

    engagement: {
      async ingest({ genomeId, orgId: org, platform, externalId, kind, authorHandle, authorName, text, contentItemId, receivedAt }) {
        const externalKey = `${org}:${genomeId}:${platform}:${externalId}`;
        const existingId = engagementByExternalId.get(externalKey);
        if (existingId) {
          // Same "retry lands the same row" upsert the real unique index
          // enforces — refresh the delivery-side fields, leave any
          // classification already on the row untouched.
          const existing = engagementMessages.get(existingId)!;
          existing.text = text;
          if (authorName) existing.authorName = authorName;
          return existing;
        }

        const row: EngagementMessage & { orgId: string } = {
          id: randomUUID(),
          orgId: org,
          genomeId,
          platform,
          externalId,
          kind,
          authorHandle,
          ...(authorName ? { authorName } : {}),
          text,
          ...(contentItemId ? { contentItemId } : {}),
          receivedAt: receivedAt ?? new Date(),
          status: 'new',
          createdAt: new Date(),
        };
        engagementMessages.set(row.id, row);
        engagementByExternalId.set(externalKey, row.id);
        return row;
      },

      async get(id, genomeId, org) {
        const row = engagementMessages.get(id);
        return row && row.orgId === org && row.genomeId === genomeId ? row : undefined;
      },

      async classify({ id, genomeId, orgId: org, category, intentScore, suggestedReply, why }) {
        const row = engagementMessages.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;
        row.status = 'classified';
        row.category = category;
        row.intentScore = intentScore;
        if (suggestedReply) row.suggestedReply = suggestedReply;
        row.why = why;
        return row;
      },

      async list(genomeId, org, { status, category, limit }) {
        return [...engagementMessages.values()]
          .filter(
            (r) =>
              r.orgId === org &&
              r.genomeId === genomeId &&
              (!status || r.status === status) &&
              (!category || r.category === category),
          )
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
          .slice(0, limit);
      },

      async markReplied({ id, genomeId, orgId: org }) {
        const row = engagementMessages.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;
        row.status = 'replied';
        // `resolvedAt` is PRD §5's Reply SLA endpoint — see the schema column.
        row.resolvedAt = new Date();
        return row;
      },

      async markAutoHandled({ id, genomeId, orgId: org }) {
        const row = engagementMessages.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;
        row.status = 'auto_handled';
        // `resolvedAt` is PRD §5's Reply SLA endpoint — see the schema column.
        row.resolvedAt = new Date();
        return row;
      },

      async markEscalated({ id, genomeId, orgId: org }) {
        const row = engagementMessages.get(id);
        if (!row || row.orgId !== org || row.genomeId !== genomeId) return undefined;
        row.status = 'escalated';
        // `resolvedAt` is PRD §5's Reply SLA endpoint — see the schema column.
        row.resolvedAt = new Date();
        return row;
      },

      async audit(genomeId, org, { statuses, since, until, limit }) {
        return [...engagementMessages.values()]
          .filter(
            (r) =>
              r.orgId === org &&
              r.genomeId === genomeId &&
              statuses.includes(r.status) &&
              (!since || r.receivedAt >= since) &&
              (!until || r.receivedAt <= until),
          )
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
          .slice(0, limit);
      },
    },

    opportunities: {
      async create({ genomeId, orgId: org, inboxItemId, temperature, recommendedAction }) {
        const row: Opportunity & { orgId: string } = {
          id: randomUUID(),
          orgId: org,
          genomeId,
          inboxItemId,
          temperature,
          recommendedAction,
          createdAt: new Date(),
        };
        opportunities.push(row);
        return row;
      },

      async get(id, genomeId, org) {
        return opportunities.find((o) => o.id === id && o.orgId === org && o.genomeId === genomeId);
      },

      async route({ id, genomeId, orgId: org, routedTo }) {
        const row = opportunities.find((o) => o.id === id && o.orgId === org && o.genomeId === genomeId);
        if (!row) return undefined;
        row.routedTo = routedTo;
        return row;
      },
    },

    campaigns: campaignStore,

    trends: {
      async add({ genomeId, orgId: org, trendId, source, topic, note }) {
        const existing = trendWatchlist.find((w) => w.genomeId === genomeId && w.orgId === org && w.trendId === trendId);
        if (existing) {
          if (note) existing.note = note;
          return existing;
        }
        const row = { id: `watch_${randomUUID()}`, genomeId, orgId: org, trendId, source, topic, createdAt: new Date(), ...(note ? { note } : {}) };
        trendWatchlist.push(row);
        return row;
      },
      async remove({ genomeId, orgId: org, trendId }) {
        const idx = trendWatchlist.findIndex((w) => w.genomeId === genomeId && w.orgId === org && w.trendId === trendId);
        if (idx >= 0) trendWatchlist.splice(idx, 1);
      },
      async list(genomeId, org) {
        return trendWatchlist.filter((w) => w.genomeId === genomeId && w.orgId === org);
      },
    },

    /**
     * Bucketed to the hour and last-write-wins, exactly like the Postgres one —
     * a dev store that recorded every call would make the chart look dense here
     * and sparse in production, which is the wrong way round for catching
     * "there is not enough history to say anything" in development.
     */
    trendObservations: {
      async record(observations) {
        for (const o of observations) {
          const at = new Date(o.observedAt.getTime());
          at.setUTCMinutes(0, 0, 0);
          trendObservationRows.set(JSON.stringify([o.source, o.trendId, at.toISOString()]), { ...o, observedAt: at });
        }
      },
      async series({ source, trendId, sinceDays, limit }) {
        const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
        return [...trendObservationRows.values()]
          .filter((o) => o.source === source && o.trendId === trendId && o.observedAt.getTime() >= since)
          .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
          .slice(0, limit ?? 720);
      },
    },

    learning: {
      async list(genomeId, org) {
        return [...learningArms.values()].filter((a) => a.genomeId === genomeId && a.orgId === org);
      },
      async recordOutcome({ genomeId, orgId: org, contentItemId, pillar, reward }) {
        const recorded = !scoredContentItems.has(contentItemId);
        if (recorded) {
          scoredContentItems.add(contentItemId);
          const key = `${genomeId}:${pillar}`;
          const existing = learningArms.get(key);
          if (existing) {
            existing.alpha += reward;
            existing.beta += 1 - reward;
            existing.observations += 1;
            existing.updatedAt = new Date();
          } else {
            learningArms.set(key, {
              pillar,
              alpha: 1 + reward,
              beta: 1 + (1 - reward),
              observations: 1,
              updatedAt: new Date(),
              orgId: org,
              genomeId,
            });
          }
        }
        const arm = learningArms.get(`${genomeId}:${pillar}`)!;
        return { recorded, arm };
      },
      async reset(genomeId, org) {
        for (const key of [...learningArms.keys()]) {
          const arm = learningArms.get(key)!;
          if (arm.genomeId === genomeId && arm.orgId === org) learningArms.delete(key);
        }
        // `scoredContentItems` is idempotency for `recordOutcome`, keyed only
        // on `contentItemId` (mirroring the real unique index) — clearing it
        // for this genome's own items is what lets a post scored before the
        // reset be re-scored after, same reasoning as `resetLearning`'s
        // real-store comment on why `learning_outcomes` must be cleared too.
        for (const id of [...scoredContentItems]) {
          const draft = drafts.get(id);
          if (draft && draft.genomeId === genomeId && draft.orgId === org) scoredContentItems.delete(id);
        }
      },
    },

    recipes: {
      async create({ genomeId, orgId: org, kind, name, config, intervalMinutes }) {
        const id = `recipe_${nextRecipe++}`;
        const row = {
          id, genomeId, orgId: org, kind, name, config, status: 'active' as const,
          createdAt: new Date(), updatedAt: new Date(),
          ...(intervalMinutes ? { intervalMinutes } : {}),
        };
        recipes.set(id, row);
        return row;
      },
      async get(id, genomeId, org) {
        const row = recipes.get(id);
        return row && row.genomeId === genomeId && row.orgId === org ? row : undefined;
      },
      async list(genomeId, org) {
        return [...recipes.values()].filter((r) => r.genomeId === genomeId && r.orgId === org);
      },
      async setStatus({ id, genomeId, orgId: org, status }) {
        const row = recipes.get(id);
        if (!row || row.genomeId !== genomeId || row.orgId !== org) return undefined;
        row.status = status;
        row.updatedAt = new Date();
        return row;
      },
      async delete(id, genomeId, org) {
        const row = recipes.get(id);
        if (row && row.genomeId === genomeId && row.orgId === org) recipes.delete(id);
      },
      async markRan(id, genomeId, org, at) {
        const row = recipes.get(id);
        if (row && row.genomeId === genomeId && row.orgId === org) {
          row.lastRunAt = at;
          row.updatedAt = new Date();
        }
      },
      async findDue(before) {
        return [...recipes.values()].filter(
          (r) =>
            r.status === 'active' &&
            r.intervalMinutes &&
            (!r.lastRunAt || r.lastRunAt.getTime() + r.intervalMinutes * 60_000 <= before.getTime()),
        );
      },
      async recordRun({ genomeId, orgId: org, recipeId, status, outputCount, outputs }) {
        const runId = `run_${nextRun++}`;
        recipeRuns.set(runId, { id: runId, recipeId, orgId: org, genomeId });
        for (const preview of outputs) {
          recipeOutputs.push({
            id: `output_${nextOutput++}`,
            recipeId,
            runId,
            genomeId,
            orgId: org,
            status: 'pending_review',
            preview,
            createdAt: new Date(),
          });
        }
        void status;
        void outputCount;
        return { runId };
      },
      async listOutputs(genomeId, org, { status, limit }) {
        return recipeOutputs
          .filter((o) => o.genomeId === genomeId && o.orgId === org && (!status || o.status === status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      },
      async decideOutput({ id, genomeId, orgId: org, status, contentItemId }) {
        const row = recipeOutputs.find((o) => o.id === id && o.genomeId === genomeId && o.orgId === org);
        if (!row) return undefined;
        row.status = status;
        row.decidedAt = new Date();
        if (contentItemId) row.contentItemId = contentItemId;
        return row;
      },
    },

    oauthConnections: {
      async get(genomeId, org, provider) {
        const row = oauthConnectionsMap.get(`${genomeId}:${provider}`);
        return row && row.orgId === org ? row : undefined;
      },
      async save({ genomeId, orgId: org, provider, accessToken, refreshToken, expiresAt, connectedBy, scopes, accountLabel }) {
        const key = `${genomeId}:${provider}`;
        const existing = oauthConnectionsMap.get(key);
        const row: OAuthConnectionRecord & { orgId: string } = {
          id: existing?.id ?? `oauth_${randomUUID()}`,
          genomeId,
          orgId: org,
          provider,
          accessToken,
          connectedBy,
          createdAt: existing?.createdAt ?? new Date(),
          updatedAt: new Date(),
          ...(refreshToken ? { refreshToken } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(scopes ? { scopes } : {}),
          ...(accountLabel ? { accountLabel } : {}),
        };
        oauthConnectionsMap.set(key, row);
        return row;
      },
      async remove(genomeId, org, provider) {
        const key = `${genomeId}:${provider}`;
        const existing = oauthConnectionsMap.get(key);
        if (existing && existing.orgId === org) oauthConnectionsMap.delete(key);
      },
    },

    knowledge: {
      async attach({ genomeId, orgId, docId, text, citation }) {
        const row = { id: `kc_${randomUUID()}`, orgId, genomeId, docId, text, createdAt: new Date(), ...(citation ? { citation } : {}) };
        knowledgeChunkRows.push(row);
        return row;
      },
      async listForDoc(genomeId, orgId, docId) {
        return knowledgeChunkRows.filter((r) => r.genomeId === genomeId && r.orgId === orgId && r.docId === docId);
      },
      async listAll(genomeId, orgId) {
        return knowledgeChunkRows.filter((r) => r.genomeId === genomeId && r.orgId === orgId);
      },
    },

    orgSettings: {
      async get(orgId) {
        return (
          orgSettingsMap.get(orgId) ?? {
            orgId,
            plan: 'starter' as const,
            defaultApprovalMode: 'review_first_week',
            ssoRequired: false,
            // Same column defaults as `schema.ts`. `retentionDays` is absent
            // rather than zero: keeping data indefinitely is the default, and a
            // dev store that implied a 0-day policy would be alarming.
            twoFactorRequired: false,
            dataResidency: 'any',
            monthlyCapCents: 500_00,
            updatedAt: new Date(),
          }
        );
      },
      async setPlan({ orgId, plan, monthlyCapCents }) {
        const row = { ...(await this.get(orgId)), plan, monthlyCapCents, updatedAt: new Date() };
        orgSettingsMap.set(orgId, row);
        return row;
      },
      /** A merge patch, mirroring the Postgres one — omitted fields are left alone. */
      async setGovernance({ orgId, defaultApprovalMode, twoFactorRequired, dataResidency, retentionDays }) {
        const current = await this.get(orgId);
        const row = {
          ...current,
          ...(defaultApprovalMode !== undefined ? { defaultApprovalMode } : {}),
          ...(twoFactorRequired !== undefined ? { twoFactorRequired } : {}),
          ...(dataResidency !== undefined ? { dataResidency } : {}),
          // `null` clears; omitted leaves alone.
          ...(retentionDays === null
            ? { retentionDays: undefined }
            : retentionDays !== undefined
              ? { retentionDays }
              : {}),
          updatedAt: new Date(),
        };
        orgSettingsMap.set(orgId, row);
        return row;
      },
      async setSso({ orgId, required }) {
        const row = { ...(await this.get(orgId)), ssoRequired: required, updatedAt: new Date() };
        orgSettingsMap.set(orgId, row);
        return row;
      },
    },

    brandMembers: {
      async set({ orgId, brandId, userId, role }) {
        const row = { orgId, brandId, userId, role, createdAt: new Date() };
        brandMemberRows.set(`${brandId}:${userId}`, row);
        return row;
      },
      async remove({ brandId, userId }) {
        brandMemberRows.delete(`${brandId}:${userId}`);
      },
      async listForBrand(orgId, brandId) {
        return [...brandMemberRows.values()].filter((r) => r.orgId === orgId && r.brandId === brandId);
      },
      async listForUser(orgId, userId) {
        return [...brandMemberRows.values()].filter((r) => r.orgId === orgId && r.userId === userId);
      },
    },

    reviewLinks: {
      async create({ orgId, brandId, scope, targetId, createdBy, expiresAt }) {
        const row = { id: `link_${randomUUID()}`, token: randomUUID(), brandId, scope, createdBy, expiresAt, createdAt: new Date(), orgId, ...(targetId ? { targetId } : {}) };
        reviewLinkRows.set(row.id, row);
        return row;
      },
      async getByToken(token) {
        const row = [...reviewLinkRows.values()].find((r) => r.token === token);
        if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return undefined;
        return row;
      },
      async revoke({ orgId, id }) {
        const row = reviewLinkRows.get(id);
        if (row && row.orgId === orgId) row.revokedAt = new Date();
      },
      async listForBrand(orgId, brandId) {
        return [...reviewLinkRows.values()].filter((r) => r.orgId === orgId && r.brandId === brandId);
      },
    },

    approvals: approvalStore,
    brands: brandStore,
    humanLoop: humanLoopStore,
    consent: consentStore,

    toolCalls: {
      async get(callId, org) {
        const row = findCall(callId);
        // Out of scope reads as not found, so probing call ids leaks nothing —
        // the same rule as `genomes.get`.
        if (!row || row.orgId !== org) return undefined;
        return {
          id: row.id,
          tool: row.tool,
          caller: row.caller,
          decision: row.decision,
          status: row.status,
          costCents: row.costCents,
          at: row.at,
          ...(row.ruleId ? { ruleId: row.ruleId } : {}),
          ...(row.reason ? { reason: row.reason } : {}),
          ...(row.runId ? { runId: row.runId } : {}),
          ...(row.why ? { why: row.why } : {}),
        };
      },
      // `findCall` only supports lookup-by-id in dev mode (whatever backs it
      // in apps/api/app.ts has no enumeration API) — an honest empty list
      // rather than a fabricated one. `org.audit.query` is fully real against
      // Postgres, which is what this dev store stands in for elsewhere too.
      async list() {
        return [];
      },
    },
    /**
     * PRD §5's success metrics, computed from this store's own maps.
     *
     * Implemented rather than stubbed, for the reason this file's header gives
     * about `lookupIdempotent`: a metric that is real under Postgres and zero in
     * development is a number nobody trusts, and the whole point of §5 is having
     * numbers somebody acts on.
     */
    metrics: {
      async successMetrics(genomeId, org, since) {
        const mine = <T extends { orgId: string; genomeId?: string }>(rows: T[]) =>
          rows.filter((r) => r.orgId === org && (r.genomeId === undefined || r.genomeId === genomeId));

        const items = [...drafts.values()].filter((d) => d.orgId === org && d.genomeId === genomeId);
        const publishedInWindow = items.filter(
          (d) => d.status === 'published' && d.publishedAt !== undefined && d.publishedAt >= since,
        );
        const linkedIds = new Set(mine(contentLinks).map((l) => l.contentItemId));

        const msgs = mine([...engagementMessages.values()]).filter((m) => m.receivedAt >= since);
        const resolved = msgs.filter((m) => m.resolvedAt !== undefined);
        const opps = mine(opportunities).filter((o) => o.createdAt >= since);
        const outputs = mine(recipeOutputs);

        const campaignRows = await campaignStore.listForGenome(genomeId, org, 100);
        const firstStart = campaignRows
          .map((c) => c.startAt)
          .sort((a, b) => a.getTime() - b.getTime())[0];
        const firstPublished = items
          .filter((d) => d.publishedAt !== undefined)
          .map((d) => d.publishedAt!)
          .sort((a, b) => a.getTime() - b.getTime())[0];

        return {
          connectedAccounts: mine([...oauthConnectionsMap.values()]).length,
          campaignCount: campaignRows.length,
          firstCampaignStartAt: firstStart ?? null,
          firstPublishedAt: firstPublished ?? null,
          publishedInWindow: publishedInWindow.length,
          postsWithTrackedLink: publishedInWindow.filter((d) => linkedIds.has(d.id)).length,
          postsFromTrends: publishedInWindow.filter((d) => (d as { sourceTrendId?: string }).sourceTrendId)
            .length,
          recipeCount: [...recipes.values()].filter((r) => r.orgId === org && r.genomeId === genomeId)
            .length,
          outputsApproved: outputs.filter((o) => o.status === 'approved').length,
          outputsRejected: outputs.filter((o) => o.status === 'rejected').length,
          messagesInWindow: msgs.length,
          messagesResolved: resolved.length,
          // Over resolved messages only — including the unanswered ones would
          // make an ignored inbox look fast.
          meanReplySeconds: resolved.length
            ? resolved.reduce((acc, m) => acc + (m.resolvedAt!.getTime() - m.receivedAt.getTime()), 0) /
              resolved.length /
              1_000
            : null,
          opportunitiesInWindow: opps.length,
          opportunitiesRouted: opps.filter((o) => o.routedTo).length,
          publishedEverBlocked: items.filter((d) => d.status === 'blocked').length,
          rolledBack: items.filter((d) => d.status === 'rolled_back').length,
          needsReview: items.filter((d) => d.status === 'needs_review').length,
        };
      },

      async toolActivity(org, genomeId, since) {
        const rows = allCalls().filter(
          (c) => c.orgId === org && c.genomeId === genomeId && c.at >= since,
        );
        const count = (predicate: (c: ToolCallRecord) => boolean) => rows.filter(predicate).length;

        return {
          publishAttempts: count((c) => c.tool === 'publish.now'),
          publishBlocked: count((c) => c.tool === 'publish.now' && c.status === 'failed'),
          publishHeld: count((c) => c.tool === 'publish.now' && c.decision === 'approval'),
          draftCalls: count((c) => c.tool === 'content.draft' && c.status === 'succeeded'),
          trendsRanked: count((c) => c.tool === 'trend.rank' && c.status === 'succeeded'),
          repurposeCalls: count((c) => c.tool === 'trend.repurpose' && c.status === 'succeeded'),
        };
      },
    },

    runs: runStore.reader,

    // The scheduler's read. Same `drafts`-only reach as `content.list`/`.get`
    // — see the note on the `drafts` declaration above.
    async findDue(before, limit) {
      return [...drafts.values()]
        .filter((r) => r.status === 'scheduled' && r.scheduledAt !== undefined && r.scheduledAt <= before)
        .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          orgId: r.orgId,
          genomeId: r.genomeId,
          playbookId: r.playbookId,
          platform: r.platform ?? null,
          copy: r.copy,
          intent: (r as { intent?: string }).intent ?? null,
          scheduledAt: r.scheduledAt!,
        }));
    },
  };
}
