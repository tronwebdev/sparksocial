import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  uniqueIndex,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIM } from '@sparksocial/shared/embedding';
import type { Autonomy } from '@sparksocial/shared/types';

/**
 * Drizzle schema — the subset the scoped query layer guards.
 *
 * Master plan §5. Every table carries `org_id`; brand-scoped tables carry `brand_id`;
 * content and asset tables carry `genome_id`. The four tables below are the ones that
 * hold client-confidential material, so they are the ones `scoped.ts` requires a
 * `genomeId` predicate for. Keep `SCOPED_TABLES` in scoped.ts in sync with this list.
 *
 * Target: Azure Database for PostgreSQL Flexible Server. `pgvector` must be allow-listed
 * as a server parameter before `CREATE EXTENSION vector` will succeed.
 *
 * Embeddings are `EMBEDDING_DIM`-dim (`text-embedding-3-large`), mandated by the engine spec for
 * ClientForce consistency.
 */

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    folderId: uuid('folder_id'),
    mediaType: text('media_type').notNull(),
    /** AssetRole from @sparksocial/shared — typed at the repository boundary. */
    assetRole: text('asset_role').notNull(),
    storagePath: text('storage_path').notNull(), // Azure Blob Storage
    muxId: text('mux_id'),
    caption: text('caption'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    quality: jsonb('quality'),
    /** 'cleared' | 'pending' | 'restricted' — retrieval only ever returns 'cleared'. */
    rightsStatus: text('rights_status').notNull().default('pending'),
    usageCount: integer('usage_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    source: text('source'),
    provenance: jsonb('provenance'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assets_scope_idx').on(t.orgId, t.genomeId)],
);

/**
 * `asset_folders` — `asset.folder.create`'s only write, and what `assets.folderId`
 * (above) has pointed at since before either the table or the tools existed:
 * the column was there, nothing ever created a row it could reference or read
 * it back. `name` isn't unique — two folders named "B-roll" in different
 * genomes are unrelated, and even within one genome a duplicate name is a
 * person's problem to notice, not this table's to prevent.
 */
export const assetFolders = pgTable(
  'asset_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('asset_folders_scope_idx').on(t.orgId, t.genomeId)],
);

/**
 * `content_links` — `link.shorten`'s CTA attribution, when called with a
 * `contentItemId`. `link.shorten` itself is a pure passthrough to Dub with no
 * storage of its own; this is what lets `analytics.cta_traffic` later ask
 * "how many clicks did this post's link get" instead of the caller having to
 * remember a Dub link id themselves. `dubLinkId` is Dub's own id (`link_...`),
 * not the short URL — that's what `DubClient.getClicks` queries by.
 */
export const contentLinks = pgTable(
  'content_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    contentItemId: uuid('content_item_id').notNull(),
    dubLinkId: text('dub_link_id').notNull(),
    shortUrl: text('short_url').notNull(),
    destinationUrl: text('destination_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('content_links_scope_idx').on(t.orgId, t.genomeId, t.contentItemId)],
);

/**
 * `renders` (§6.5, plan schema sketch: "id, content_item_id, aspect,
 * storage_path, mux_id, engine, cost_cents") — the output of `compose.render`.
 * Kept separate from `content_items` rather than a jsonb column on it because
 * one content item renders to several aspect ratios (one row each), and a
 * failed re-render must not clobber a previous good one — `compose.render`
 * inserts, it never updates.
 */
export const renders = pgTable(
  'renders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    contentItemId: uuid('content_item_id').notNull(),
    aspect: text('aspect').notNull(),
    storageUrl: text('storage_url').notNull(),
    engine: text('engine').notNull(), // 'remotion' today; 'ffmpeg'/'satori' if compose grows other engines
    costCents: integer('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('renders_scope_idx').on(t.orgId, t.genomeId),
    // `compose.render`'s own read: "has this content item already been rendered?"
    index('renders_content_item_idx').on(t.contentItemId),
  ],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    /** A caller-chosen grouping key ("faq_1", a source URL) — not a database-generated id, so it isn't a `uuid` column. */
    docId: text('doc_id').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    citation: jsonb('citation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('knowledge_chunks_scope_idx').on(t.orgId, t.genomeId)],
);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    confidence: integer('confidence'),
    sourceRunId: uuid('source_run_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('memories_scope_idx').on(t.orgId, t.genomeId)],
);

export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    campaignId: uuid('campaign_id'),
    /**
     * The recipe that produced this item, when one did.
     *
     * `policy.ts` rule 7 has always had a branch for automation output
     * (`isAutomationOutput` → honour the recipe's review setting, then the
     * workspace's `automationAutoPublish` permission) and no way to know an
     * item *was* one: recipe outputs lived only in `recipe_outputs`, and by the
     * time anything became publishable the link was gone. This column is that
     * link, read by `publish.now`'s `policySubject` before the handler runs.
     * Null for everything a campaign or a person created.
     */
    recipeId: uuid('recipe_id'),
    /**
     * What this specific post is about, in one line — `content.draft`'s `intent`
     * input, persisted.
     *
     * Needed because drafting is no longer only something a person does in the
     * Draft Panel: the scheduler now drafts a due slot that has no copy yet
     * (see `apps/api/src/scheduler.ts`), and a recipe that publishes unattended
     * creates the slot hours before anything writes its copy. Both need the
     * intent to survive in between. Null for a slot whose pillar and playbook
     * are the whole of the brief.
     */
    intent: text('intent'),
    /**
     * The trend this post came out of, when it came out of one.
     *
     * PRD §5's Discovery section asks for "Trend-to-post conversion rate", which
     * needs a link between a trend and the post it produced. There was none:
     * `trend.repurpose` returns a *suggestion* and the caller then calls
     * `content.draft`, so the two were connected only in the mind of whoever
     * clicked. This column is that link, set by `content.draft`'s `fromTrendId`.
     *
     * Not a foreign key: trends come from third-party sources and are not rows
     * we own, so the id is a vendor's string kept for attribution.
     */
    sourceTrendId: text('source_trend_id'),
    playbookId: text('playbook_id'),
    mode: text('mode'), // synthesize | assemble | direct_finish
    pillar: text('pillar'),
    status: text('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    platform: text('platform'),
    /** The platform adapter's receipt (`PublishReceipt`), set once by `markPublished`. */
    externalId: text('external_id'),
    publishVia: text('publish_via'),
    publishUrl: text('publish_url'),
    /**
     * Set only when `status: 'blocked'` — the scheduler's write when a
     * guardrail hard-blocks a due item (`GUARDRAIL_BLOCKED`), since that will
     * fail identically on every future tick with nothing to retry into. Holds
     * the guardrail's own `fixAction`/message so a person opening the item
     * sees why it stalled without re-deriving it.
     */
    blockedReason: text('blocked_reason'),
    copy: jsonb('copy'),
    /**
     * The copy's embedding at publish time — the guardrail layer's `duplicate`
     * check (§10) compares a new draft against the trailing 90 days of these.
     * Computed once, here, rather than re-embedding historical copy on every
     * guardrail run: that would mean every duplicate check pays for N embedding
     * calls where N is how much has been published recently, which grows
     * unboundedly with account age.
     */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    /** The Explanation payload — PRD §7.3, rendered by <WhyPopover />. */
    why: jsonb('why'),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('content_items_scope_idx').on(t.orgId, t.genomeId),
    // The guardrail layer's trailing-window read (`recentContent`) filters
    // scope *and* `published_at >= cutoff` on every draft evaluated. Carrying
    // the date in the index keeps that from widening into a scan of the
    // genome's entire publishing history as an account ages — which is exactly
    // the account that most needs the duplicate check to stay fast.
    index('content_items_published_idx').on(t.orgId, t.genomeId, t.publishedAt.desc()),
  ],
);

/**
 * A performance snapshot for one published post on one platform — `CC-04`'s
 * `analytics.sync` (P4). One row per `(contentItemId, platform)`, upserted on
 * every sync rather than appended: this is "what the platform reports right
 * now", not a time series, and a caller wanting history has the `syncedAt` on
 * each write plus the raw vendor response for anything a later pass needs to
 * reconstruct trend data from.
 *
 * Scoped like `content_items` — post performance is exactly the kind of
 * competitive detail invariant 2 exists to isolate, so this carries `org_id`/
 * `genome_id` and goes through `scoped.ts` the same way.
 */
export const contentMetrics = pgTable(
  'content_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    contentItemId: uuid('content_item_id').notNull(),
    platform: text('platform').notNull(),
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    views: integer('views').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    /**
     * PRD `CC-04` names three headline metrics — Impressions, **Saves** and
     * Replies — and this table carried likes/comments/shares/views/impressions.
     *
     * Saves is the one worth having most and the one that was missing: on
     * Instagram and TikTok it is the strongest signal that a post was *useful*
     * rather than merely seen, which is exactly what a brand posting craft and
     * how-to content needs to know. Zero-defaulted rather than nullable, because
     * a platform that does not report saves genuinely had none to report.
     */
    saves: integer('saves').notNull().default(0),
    /** The vendor's unnormalized response — nothing is lost to normalization. */
    raw: jsonb('raw'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('content_metrics_scope_idx').on(t.orgId, t.genomeId),
    // Upsert target: a re-sync of the same post/platform updates in place.
    uniqueIndex('content_metrics_item_platform_idx').on(t.contentItemId, t.platform),
  ],
);

/**
 * The inbox — PRD §8.8 / `ENG-01`→`ENG-02.4`. One row per inbound comment,
 * DM, or story reply from the audience. Distinct from `human_messages`, which
 * is SPARK asking the *owner* a question; this is the audience reaching the
 * brand, the thing `engage.classify` triages into the feed's four tabs
 * (Needs Review / Suggested Replies / Auto-Handled / Sales Opportunities).
 *
 * `externalId` is the platform's own message/comment id — unique per
 * `(orgId, genomeId, platform, externalId)`, so a webhook retry (every
 * platform's inbound delivery is at-least-once) upserts rather than
 * duplicating the same message in the feed twice.
 */
export const engagementMessages = pgTable(
  'engagement_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(), // comment | dm | story_reply
    authorHandle: text('author_handle').notNull(),
    authorName: text('author_name'),
    text: text('text').notNull(),
    /** The post this is a reply to, when known — not every DM is. */
    contentItemId: uuid('content_item_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * new | classified | replied | auto_handled | escalated | dismissed |
     * converted. Plain text, no DB CHECK constraint — adding a value here
     * (as `converted` was) never needs a migration on its own.
     * `engage.audit.query` (`packages/engage/src/auditQuery.ts`) treats
     * `converted` as a resolved status alongside the rest, reserved for a
     * future "this became a real sale" event; nothing sets it yet.
     */
    status: text('status').notNull().default('new'),
    /** needs_review | suggested_reply | auto_handled | sales_opportunity — set by `engage.classify`. */
    category: text('category'),
    /** 0-1, the same scale `Explanation.factors[].weight` and the genome's own `confidence` use. */
    intentScore: real('intent_score'),
    suggestedReply: text('suggested_reply'),
    /** The Explanation payload — PRD §7.3, same contract every agent-visible decision carries. */
    why: jsonb('why'),
    /**
     * When this message stopped needing anyone's attention — replied,
     * auto-handled, escalated or dismissed.
     *
     * PRD §5 lists "Reply SLA (time to reply)" as an engagement success metric
     * and it was not measurable: `status` recorded *that* a message was answered
     * and nothing recorded *when*, so the interval the metric is defined as had
     * no second endpoint. Null while a message is still open, which is also how
     * the metric distinguishes "not answered yet" from "answered instantly".
     */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('engagement_messages_scope_idx').on(t.orgId, t.genomeId),
    // Feed queries filter scope + status/category, newest first — the shape
    // `ENG-02`'s tabs read.
    index('engagement_messages_feed_idx').on(t.orgId, t.genomeId, t.status, t.receivedAt.desc()),
    uniqueIndex('engagement_messages_external_idx').on(t.orgId, t.genomeId, t.platform, t.externalId),
  ],
);

/**
 * Sales leads surfaced from the engagement inbox — the master plan's own
 * schema sketch (§3.2: "inbox_item_id, temperature(hot|warm|cold),
 * recommended_action, routed_to"). `engage.opportunity.create` inserts,
 * `engage.opportunity.route` updates `routed_to`; there is no delete.
 *
 * Kept separate from `engagement_messages` rather than columns on it —
 * same reasoning `renders` gets its own table apart from `content_items`:
 * this is a decision made *about* a message (a human/SPARK judging it a real
 * lead), not an attribute intrinsic to the message itself.
 */
export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    inboxItemId: uuid('inbox_item_id').notNull(),
    /** hot | warm | cold */
    temperature: text('temperature').notNull(),
    recommendedAction: text('recommended_action').notNull(),
    /** Free text — a person's name, an email, a CRM reference. No CRM integration exists yet. */
    routedTo: text('routed_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('opportunities_scope_idx').on(t.orgId, t.genomeId),
    // `engage.opportunity.route`'s own lookup, and the eventual "opportunities
    // for this message" read.
    index('opportunities_inbox_item_idx').on(t.inboxItemId),
  ],
);

/**
 * THE BRAND GENOME — engine spec §3.2, `packages/shared/src/genome.ts`'s `Genome` type.
 *
 * `identity`/`voice`/`audience`/`offer`/`constraints`/`learned` are stored as JSONB
 * rather than normalized: they are read and written as one unit by every caller
 * (`ScopedDb.genomes.get` returns the whole `Genome`), and none of them are queried
 * independently today. `dimensions` gets the same treatment for consistency, but is
 * the one column worth a GIN index the moment the resolver needs to query across
 * genomes by dimension rather than always loading one genome by id — CLAUDE.md's
 * "index them" note for `dimensions` is aspirational until that query exists.
 *
 * NOT in `SCOPED_TABLES` (`scoped.ts`): a genome is looked up by its own id, which
 * already pins it to one org/brand — there is no cross-genome genome query for the
 * isolation predicate to guard.
 */
export const genomes = pgTable(
  'genomes',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id').notNull(), // Genome.workspace_id
    version: integer('version').notNull().default(1),
    identity: jsonb('identity').notNull(),
    dimensions: jsonb('dimensions').notNull(),
    voice: jsonb('voice').notNull(),
    audience: jsonb('audience').notNull(),
    offer: jsonb('offer').notNull(),
    constraints: jsonb('constraints').notNull(),
    learned: jsonb('learned').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('genomes_org_brand_idx').on(t.orgId, t.brandId)],
);

/**
 * Brand governance — PRD §7.1/§9, engine spec §6.8 Step 5.
 *
 * The policy engine has implemented the full approval ladder from the start;
 * what did not exist was anywhere to *store* which rung a brand is on, so both
 * auth resolvers returned a hardcoded `autopublish`. That made the ladder real
 * in tests and inert in production.
 *
 * `createdAt` is load-bearing, not bookkeeping: `review_first_week` graduates a
 * brand to autopublish seven days after it was created, and the policy engine
 * computes that from this column. Defaulting it to `now()` on insert is what
 * makes the graduation date the brand's real age rather than the date someone
 * happened to change a setting.
 *
 * Not in `SCOPED_TABLES` — a governance setting is configuration, not
 * client-confidential material, same rationale as `genomes` and `campaigns`.
 */
export const brands = pgTable(
  'brands',
  {
    id: text('id').primaryKey(), // Genome.workspace_id
    orgId: text('org_id').notNull(),
    name: text('name').notNull().default(''),
    /** autopublish | review_first_week | review_everything */
    approvalMode: text('approval_mode').notNull().default('review_first_week'),
    /**
     * The kill switch (`policy.ts` rule 1, `agent.paused`).
     *
     * That rule has existed since P1 and there was no column behind it, so
     * `agentPaused` was permanently undefined — the one control that stops a
     * misbehaving agent was unreachable. Defaults false: a brand is not paused
     * until somebody pauses it.
     */
    agentPaused: boolean('agent_paused').notNull().default(false),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedBy: text('paused_by'),
    pauseReason: text('pause_reason'),
    /**
     * Target posts per week (`agent.frequency.set`) — how loud the account is.
     *
     * Orthogonal to the kill switch above: pausing stops the agent acting at
     * all, frequency shapes what it does while running. Three is the cadence
     * the calendar's mix engine was tuned against, so a brand nobody has
     * configured still produces a well-shaped plan.
     */
    postsPerWeek: integer('posts_per_week').notNull().default(3),
    /**
     * `approval.policy.set` — the per-brand configurability `policy.ts` (§9)
     * has read since P1 (`brand.familyOverrides`, `.restrictedPlatforms`,
     * `.restrictedContentTypes`, `.quietWindows`, `.permissions`) but nothing
     * ever wrote: `makeBrandGovernance` only ever populated `approvalMode` and
     * `agentPaused`, so every branch in `evaluate()` that reads these five
     * fields has been unreachable in production, tested only by unit tests
     * that build a `PolicyInput` directly. Null/empty means "no override" —
     * the same rung the fixed three-mode ladder already produced, so a brand
     * nobody has configured behaves exactly as it did before this column existed.
     */
    familyOverrides: jsonb('family_overrides').$type<Partial<Record<string, Autonomy>>>(),
    restrictedPlatforms: jsonb('restricted_platforms').$type<string[]>(),
    restrictedContentTypes: jsonb('restricted_content_types').$type<string[]>(),
    quietWindows: jsonb('quiet_windows').$type<Array<{ from: string; to: string; reason: string }>>(),
    permissions: jsonb('permissions').$type<{
      spendCredits?: boolean;
      automationAutoPublish?: boolean;
      /**
       * PRD §6's "Approval required for media generation (optional)" — the one
       * of the five permission controls with no representation anywhere.
       */
      requireApprovalForMedia?: boolean;
    }>(),
    /**
     * §6's "Publish permission (per role)". Narrows a publish tool's own
     * declared scopes; it can never widen them (`policy.ts` rule 2 runs first).
     * Null means the tool's own scopes stand.
     */
    publishRoles: jsonb('publish_roles').$type<string[]>(),
    /**
     * §10's queue cap — the mitigation for "automation floods
     * feeds/calendars". How many items may sit waiting for review before SPARK
     * stops adding to the pile. Null means no cap.
     */
    maxPendingReview: integer('max_pending_review'),

    /**
     * ── PRD §8.2 ONB-03 / §8.12 SET-WS-01 / §9: the governance a brand states
     * about itself, as opposed to the approval *ladder* above it. ─────────────
     *
     * "Restricted topics" and "claims to avoid" are named in PRD §4, §8.2,
     * §8.8, §8.12 and §9, and existed in no layer of this system: no column, no
     * tool, no screen. `brand.settings.patch` renamed a brand and that was the
     * whole of brand configuration. So §9's guardrail-enforcement section had
     * nothing to enforce, §8.6's "Apply Brand Kit" toggle had no kit to apply,
     * and the stated mitigation for the PRD's own first-listed risk — "wrong or
     * off-brand autoposting" — was unimplementable rather than unimplemented.
     *
     * Deliberately here on `brands` and not on `genomes`. A genome is inferred
     * (crawled, then corrected) and is about what the business *is*; this is
     * asserted by a human and is about what the business *will not say*. The
     * second must not be silently overwritten the next time the first is
     * re-inferred from a website.
     */

    /**
     * Topics SPARK may not post about. Matched case-insensitively as whole
     * phrases against draft copy by `guard.restricted_topics`.
     *
     * `strictMode` decides whether a hit is a flag (routes to review) or a hard
     * block, per §9: *"restricted topics/claims trigger Needs Review (soft) or
     * Blocked (hard) depending on strict mode and rule type."*
     */
    restrictedTopics: jsonb('restricted_topics').$type<string[]>(),
    /**
     * Claims this brand does not make — "guaranteed", "the cheapest", "clinically
     * proven". Distinct from `restrictedTopics`: a topic is a subject to avoid,
     * a claim is an assertion to avoid making *about* a subject it is otherwise
     * happy to discuss. They are separate fields because §9 treats them as
     * separate rule types, and strict mode escalates them differently.
     */
    claimsToAvoid: jsonb('claims_to_avoid').$type<string[]>(),
    /**
     * §9's "strict compliance mode". Off: a restricted topic or claim flags the
     * draft and routes it to review. On: it blocks outright.
     */
    strictMode: boolean('strict_mode').notNull().default(false),
    /**
     * ONB-03's voice sliders, 0–1 each. The same four axes
     * `Genome.voice.tone_vector` carries, asserted at brand level: where both
     * exist this wins, because a person moved these deliberately and the
     * genome's were inferred from a website.
     */
    toneVector: jsonb('tone_vector').$type<{ formal: number; playful: number; technical: number; bold: number }>(),
    /** Words and phrases never to use. Checked verbatim by `guard.brand_voice`. */
    bannedPhrases: jsonb('banned_phrases').$type<string[]>(),
    /** ONB-01's logo, and the brand kit colours §8.6's "Apply Brand Kit" toggle applies. */
    logoUrl: text('logo_url'),
    brandColors: jsonb('brand_colors').$type<string[]>(),

    /**
     * ── PRD §8.2 (required at onboarding) / §8.7 (a Calendar input) ──────────
     *
     * An IANA zone name, e.g. `Europe/London`. The string "timezone" appeared
     * nowhere in this codebase: not in the schema, the genome, the campaign
     * model, or any tool, and there was no time-of-day logic anywhere either.
     * Every post therefore fired at whatever wall-clock instant its campaign
     * happened to be created, in UTC, and two posts placed on the same day got
     * byte-identical timestamps and published simultaneously.
     *
     * Defaults to UTC rather than null so that every existing brand has a
     * defined zone and `placeCalendar` never has to branch on "unknown".
     */
    /**
     * ── PRD §8.8's engagement configuration ─────────────────────────────────
     *
     * *"Inputs/Config: Engagement autonomy level. Enabled engagement types
     * (comments/DMs/story replies). Approval rules for sending replies."*
     *
     * None of it existed, and that absence is what made `policy.ts` rule 6
     * forgeable: `autonomyConfigured` arrived on the HTTP request because there
     * was nothing on the server to compare a claim against.
     *
     * `off` (suggest a reply, a person sends it) is the default and is not the
     * same as unset — the conservative rung, matching how `approvalMode`
     * defaults to `review_first_week` rather than to nothing.
     */
    engagementAutonomy: text('engagement_autonomy').notNull().default('off'),
    /** comment | dm | story_reply. Empty means all of them. */
    engagementTypes: jsonb('engagement_types').$type<string[]>(),

    timezone: text('timezone').notNull().default('UTC'),
    /**
     * §8.7's "posting windows" — local hours-of-day, in `timezone`, that posts
     * are placed into, earliest first. A day with more posts than windows wraps
     * back through the list at a later minute offset rather than stacking two
     * posts on one instant.
     *
     * The default is a plain three-times-a-day spread. It is not researched
     * best-time-to-post data and does not pretend to be: what it fixes is
     * "every post goes out at 03:47 because that is when the campaign was
     * created", and `learning.*` is where a real per-brand answer belongs.
     */
    postingWindows: jsonb('posting_windows').$type<number[]>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('brands_org_idx').on(t.orgId)],
);

/**
 * Per-organisation spend cap — plan §9.
 *
 * A row per org rather than a column on `brands`, because the cap is what an
 * organisation *bought*: an agency on one plan with forty client brands has one
 * budget, not forty. Putting it on `brands` would let a forty-brand workspace
 * spend forty times the plan.
 *
 * Upserted at a conservative default on first read, same rule as `brands`: a
 * missing row must not read as unlimited. The direction matters — the failure
 * mode of guessing high is a bill nobody agreed to.
 */
export const orgBudgets = pgTable('org_budgets', {
  orgId: text('org_id').primaryKey(),
  /** Cents per calendar month, UTC. */
  monthlyCapCents: integer('monthly_cap_cents').notNull().default(500_00),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CREDIT LEDGER — plan §9, and what finally makes `policy.ts` rule 4 mean
 * something.
 *
 * That rule has denied calls over budget since P1, reading `remainingCents`
 * from `ToolCtx`. Both auth resolvers hardcoded `100_000`, so every
 * `estimateCents` in the codebase was computed, recorded on the `tool_calls`
 * row, and compared against a constant. The spend limit was fully implemented,
 * fully tested, and could not be reached.
 *
 * **Append-only, and keyed on the call.** `callId` is unique, so the same tool
 * call can never be billed twice. `invokeTool` already returns early on an
 * idempotent replay before `recordCost` runs, so this is not the primary
 * defence — it is the one that survives a retry introduced at some other layer
 * later, like at-least-once delivery from a queue, where the primary defence
 * does not apply.
 *
 * `costCents` is signed: positive is a spend, negative a refund or a goodwill
 * credit. Balance is `cap - SUM(costCents)` over the period, so a correction is
 * a new row rather than an edit — the ledger stays a record of what happened
 * rather than a mutable current value.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id'),
    /** The `tool_calls` row this bills. Null for manual adjustments. */
    callId: uuid('call_id'),
    tool: text('tool').notNull(),
    /** Positive spends, negative refunds. */
    costCents: integer('cost_cents').notNull(),
    reason: text('reason').notNull().default('tool_call'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One charge per call, enforced by the database rather than by remembering.
    uniqueIndex('credit_ledger_call_idx').on(t.callId),
    // The balance query: one org, one period.
    index('credit_ledger_org_at_idx').on(t.orgId, t.at),
  ],
);

/**
 * SPARK's questions to the owner and their answers (`human.ask`, `human.notify`).
 *
 * `answer` is the only column in this schema written from outside the
 * workspace — it arrives over WhatsApp, which is an unauthenticated channel in
 * the sense that matters: anyone who can reach the owner's number can put text
 * in it. It is stored, displayed and fed to the model as *content*, and
 * `whatsapp.receive` wraps it in `untrusted()` before it ever reaches a prompt.
 * Nothing branches on its value to decide whether an action is permitted.
 *
 * `answeredAt` doubles as the write-once latch: `answer()` refuses a message
 * that already has one, so a retried webhook cannot overwrite a decision SPARK
 * has already acted on.
 *
 * Not in `SCOPED_TABLES` — a question is addressed to a brand, and the brand is
 * the tenancy boundary here; every query filters on `orgId` regardless.
 */
export const humanMessages = pgTable(
  'human_messages',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id').notNull(),
    /** ask | notify */
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    options: jsonb('options').$type<string[]>(),
    /** low | normal | high */
    urgency: text('urgency').notNull().default('normal'),
    runId: text('run_id'),
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredBy: text('answered_by'),
    channel: text('channel'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The owner's inbox: unanswered questions for one brand, oldest first.
    index('human_messages_brand_idx').on(t.orgId, t.brandId, t.answeredAt),
  ],
);

/**
 * CONSENT RECORDS — engine spec §10: *"likeness consent for cloning (store
 * explicit consent record with timestamp and scope)."*
 *
 * Until this table existed, `genome.constraints.avatar_enabled` was a boolean
 * derived purely from an onboarding answer (`proof_asset` includes `person` AND
 * `talent_availability === 'yes_licensed'`) — a self-report with a timestamp
 * nowhere and a scope nowhere. `guardrails/src/rights.ts` has refused to permit
 * a likeness-cloning format without `avatarEnabled` since P2, checking against
 * a flag that had no record behind it — the guardrail was real, the thing it
 * verified was not.
 *
 * **Append-only, like `tool_calls` and `credit_ledger`.** A consent decision is
 * a fact about a moment; revoking consent is a new row with `revokedAt` set, not
 * an edit to the old one, so the record of "consent was granted on this date,
 * by this person, for this scope, and later revoked on this date" survives
 * intact. `hasActive` — the only read this table needs — is "the newest row for
 * this subject has no `revokedAt`."
 *
 * `subject` and `kind` are separate: one genome can have consent on file for
 * several distinct people or voices (an agency's genome might clone two
 * different staff members), and `avatar_enabled` needs to know *whose* consent
 * covers *which* clone a given format asks for — not just that consent exists
 * somewhere for this genome.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    /** 'avatar_clone' | 'voice_clone'. Free text, not an enum — invariant 5's
     *  spirit: a third clone kind should not need a migration to name. */
    kind: text('kind').notNull(),
    /** Who the likeness belongs to, in the owner's own words: "Emeka, owner". */
    subject: text('subject').notNull(),
    /** A signed form, a recorded verbal consent, whatever evidences it. */
    evidenceUrl: text('evidence_url'),
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedBy: text('revoked_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // `hasActive`'s query: newest row for this genome+kind+subject, filtered to
    // ones still standing. Descending on `grantedAt` so "is there a live one"
    // stops at the first match instead of scanning the whole history.
    index('consent_records_lookup_idx').on(t.orgId, t.genomeId, t.kind, t.grantedAt.desc()),
  ],
);

/**
 * The Review queue — PRD §7.5 ("queues are first-class"), plan §4.4.
 *
 * A separate table rather than columns on `tool_calls`, because `tool_calls` is
 * insert-only by design: `invokeTool` writes exactly one row per invocation and
 * never touches it again, which is what makes it a trustworthy audit log. An
 * approval has a *lifecycle* — requested, then decided — so it needs somewhere
 * it is allowed to change.
 *
 * `call_id` points back at the `gated` audit row, which already holds the tool,
 * the input, and the scope it was called in. That row is the replay source when
 * a reviewer approves: nothing about the original call is copied here, so the
 * two can never disagree about what is being approved.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id'),
    /** The `tool_calls` row that was gated. */
    callId: uuid('call_id').notNull(),
    tool: text('tool').notNull(),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    /** Why the policy engine held it — shown in the queue. */
    ruleId: text('rule_id'),
    reason: text('reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('approvals_queue_idx').on(t.orgId, t.brandId, t.status, t.requestedAt.desc()),
    // One approval per gated call: a retry of the same held call must not
    // enqueue a second review item for the same decision.
    uniqueIndex('approvals_call_idx').on(t.callId),
  ],
);

/**
 * Campaigns — the outcome unit (§6.8, `CMP-01.*`).
 *
 * A campaign is an *objective over a window*, never a format or a channel: the
 * whole flow is "outcome first, never format first". The plan it was approved
 * with is stored as a snapshot rather than recomputed, because the resolver and
 * the Asset Graph both move underneath it — reopening a campaign in week three
 * must show the numbers the owner actually agreed to, not what those numbers
 * would be today.
 *
 * Not in `SCOPED_TABLES`: a campaign is scoped by `genome_id` like everything
 * else, but it carries no client-confidential material of its own — the assets
 * and copy live in `content_items`, which is scoped. Kept out of the strict set
 * for the same reason `genomes` is.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    name: text('name').notNull(),
    objective: text('objective').notNull(),
    windowDays: integer('window_days').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    /**
     * The Step 1 follow-up the campaign flow's own spec calls for ("target &
     * window") but nothing ever captured — §6.8's "You wanted 40 bookings.
     * You're at 27" example has no number to compare against without this.
     * Nullable: a campaign proposed without a stated numeric target is normal
     * (e.g. "grow audience" often isn't a count), and `campaign.report_vs_outcome`
     * reports honestly against volume/mix/engagement alone when it's absent
     * rather than inventing one.
     */
    targetCount: integer('target_count'),
    /** What targetCount counts — "bookings", "trials", "signups". Free text like the objective preset itself. */
    targetLabel: text('target_label'),
    /**
     * `CMP-01.4` — the accounts this campaign posts to.
     *
     * PRD §8.4 lists "Connected accounts selection" as a campaign input and
     * there was nowhere to put it, so a campaign was genome + objective +
     * window and nothing else. The cost of that was visible two layers down:
     * `apps/api/src/scheduler.ts` had to fall back to *"the playbook's first
     * declared platform"* for every scheduled post, because nothing in the
     * system had ever recorded where the owner wanted this campaign to publish.
     *
     * Null or empty keeps that fallback, which is still the honest default for
     * a campaign created before this column existed.
     */
    platforms: jsonb('platforms').$type<string[]>(),
    /**
     * PRD §7.2's per-campaign approval scope.
     *
     * §7.2 lists four scopes at which approvals may be switched on — globally,
     * **per campaign**, per content type/platform, and by guardrail trigger —
     * and three of them were real. Null means "use the brand's", which is every
     * campaign created before this column existed.
     *
     * Overrides in *either* direction, which is what makes it a control rather
     * than a second lock: a cautious launch campaign can require review inside
     * an autopublishing brand, and a routine one can publish freely inside a
     * brand that reviews everything.
     */
    approvalMode: text('approval_mode'),
    /** draft | active | done | cancelled */
    status: text('status').notNull().default('draft'),
    /** The approved plan: volume, mix, capture ask, reasoning. */
    plan: jsonb('plan').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_scope_idx').on(t.orgId, t.genomeId, t.startAt.desc())],
);

/**
 * THE AUDIT ROW — master plan §5 `tool_calls`, `packages/tools/src/invoke.ts`'s
 * `ToolCallRecord`.
 *
 * Written exactly once per invocation (`invoke.ts` never updates a row after
 * writing it — gated/failed/succeeded are all terminal), so this is INSERT-only,
 * never UPDATE. `idempotencyKey` is unique-indexed because it is the field
 * `lookupIdempotent` filters on before a non-idempotent tool re-runs a side effect.
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id'),
    userId: text('user_id'),
    tool: text('tool').notNull(),
    version: integer('version').notNull(),
    caller: text('caller').notNull(), // 'user' | 'agent'
    orgId: text('org_id').notNull(),
    brandId: text('brand_id'),
    genomeId: text('genome_id'),
    role: text('role').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    effect: text('effect').notNull(),
    decision: text('decision').notNull(), // Decision['kind']
    ruleId: text('rule_id'),
    reason: text('reason'),
    costCents: integer('cost_cents').notNull().default(0),
    idempotencyKey: text('idempotency_key'),
    status: text('status').notNull(),
    error: jsonb('error'),
    why: jsonb('why'),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('tool_calls_org_brand_idx').on(t.orgId, t.brandId),
    index('tool_calls_run_idx').on(t.runId),
    // Partial-unique would be ideal (NULLs excluded) but Drizzle's pgTable index
    // builder doesn't expose a WHERE clause portably across drivers here — an
    // ordinary index is enough for `lookupIdempotent`'s equality lookup; true
    // uniqueness is enforced by the "replay if found" logic in invoke.ts, which
    // only ever consults, never depends on the DB rejecting a duplicate insert.
    index('tool_calls_idempotency_idx').on(t.idempotencyKey),
  ],
);

/**
 * `idempotency_reservations` — the mutual exclusion `tool_calls` cannot provide.
 *
 * `tool_calls` is INSERT-only and the row lands *after* the handler returns, so
 * `lookupIdempotent` cannot see a call that is still running. Two concurrent
 * `publish.now` calls with the same key both missed the lookup and both posted;
 * the platform adapter's own dedupe was the only thing standing between that
 * and a duplicate post on a customer's feed.
 *
 * A separate table, rather than a status column on `tool_calls`, precisely so
 * that INSERT-only property survives. The primary key *is* the mechanism: the
 * second inserter loses on a uniqueness violation and is told to wait.
 * `invoke.ts` deletes the row when a run fails, so a real retry still works.
 */
export const idempotencyReservations = pgTable('idempotency_reservations', {
  key: text('key').primaryKey(),
  tool: text('tool').notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `agent_runs` / `agent_steps` — master plan §5, §4.5's Agent Timeline,
 * `packages/spark/src/run.ts`'s `AgentRun` / `AgentStep`.
 *
 * Unlike `tool_calls`, a run is INSERT-then-UPDATE: `startRun` inserts with
 * `status: 'running'`, `finishRun` updates the same row to its terminal state.
 * Steps are append-only, ordered by `idx` rather than `at` — see `StepSequence`
 * in `run.ts` for why timestamp ordering isn't trustworthy enough on its own.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    brandId: text('brand_id').notNull(),
    agent: text('agent').notNull(),
    goal: text('goal').notNull(),
    trigger: text('trigger').notNull(), // 'user' | 'schedule' | 'event'
    status: text('status').notNull().default('running'),
    costCents: integer('cost_cents').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    traceId: text('trace_id'),
    parentRunId: uuid('parent_run_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    error: jsonb('error'),
  },
  (t) => [
    // Composite, and descending on `started_at`, because the Agent Timeline's
    // only list query is `WHERE brand_id = ? ORDER BY started_at DESC LIMIT n`.
    // With an index on `brand_id` alone, Postgres filters by index and then
    // sorts *every* run the brand has ever made to find the newest 25 — on the
    // screen people open most. Matching the sort order lets it stop after n.
    index('agent_runs_brand_started_idx').on(t.brandId, t.startedAt.desc()),
    index('agent_runs_parent_idx').on(t.parentRunId),
  ],
);

export const agentSteps = pgTable(
  'agent_steps',
  {
    runId: uuid('run_id').notNull(),
    idx: integer('idx').notNull(),
    type: text('type').notNull(), // 'think' | 'tool' | 'delegate' | 'wait'
    payload: jsonb('payload'),
    ms: integer('ms').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('agent_steps_run_idx').on(t.runId, t.idx)],
);

/* ── P5: Trend Discovery + automation ─────────────────────────────── */

/** `trend.watchlist` — a genome tracking a trend over time. Client-confidential (which trends a brand is watching), so genome-scoped like `memories`. */
export const trendWatchlist = pgTable(
  'trend_watchlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    trendId: text('trend_id').notNull(),
    source: text('source').notNull(),
    topic: text('topic').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trend_watchlist_scope_idx').on(t.orgId, t.genomeId),
    uniqueIndex('trend_watchlist_unique_idx').on(t.genomeId, t.trendId),
  ],
);

/**
 * `trend_observations` — the time series behind `DISC-02`, PRD §8.9.
 *
 * §8.9's functional requirement is *"trend detail includes: metrics + time
 * series"*. `TrendMetrics` is four scalars read live from the source, so
 * before this table the detail screen could show where a trend is and never
 * where it came from — which is precisely the judgement the screen exists to
 * support. Velocity 0.4 on the way up and velocity 0.4 on the way down are the
 * same number and opposite decisions.
 *
 * **Deliberately not scoped through `scoped.ts`.** These rows are public
 * source data about the outside world, not a brand's material — the same
 * reasoning as `brands` and `org_settings`, but with an additional argument
 * that runs the other way: the series is only useful if it accumulates
 * independently of who happens to be looking. One org polling once a week
 * would build nothing. Nothing genome-specific is stored here, so there is no
 * isolation question to answer: a trend's volume is not anybody's secret.
 *
 * Bucketed to the hour rather than stamped with the arrival time. Every
 * `trend.rank` call by every org contributes a sample, so the raw arrival
 * times would produce thousands of near-identical rows a day and a chart that
 * is dense without being informative. The unique index makes recording
 * idempotent, which is what lets any caller record freely.
 */
export const trendObservations = pgTable(
  'trend_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    trendId: text('trend_id').notNull(),
    /** Truncated to the hour — see the note above. */
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    /** The topic as it read at the time. Trends get renamed; the series should not lose its label. */
    topic: text('topic').notNull(),
    volume: integer('volume').notNull(),
    /** 0–1, stored ×1000 as an integer — a float column would invite drift on a value used for ordering. */
    velocityBp: integer('velocity_bp').notNull(),
    saturationBp: integer('saturation_bp').notNull(),
    /** Period-over-period change, ×1000. Signed: negative means dying. */
    growthBp: integer('growth_bp').notNull(),
  },
  // One index, not two: the unique index is `(source, trend_id, observed_at)`,
  // which is already the exact prefix the series read scans, so a second index
  // on the same columns in the same order would be write cost for nothing.
  (t) => [uniqueIndex('trend_observations_unique_idx').on(t.source, t.trendId, t.observedAt)],
);

/**
 * `recipe.*` — Automation Recipes (plan §12 P5, `AUTO-01`→`AUTO-04.4`).
 *
 * One table for every recipe kind (AutoTrend, Bulk Connector, RSS), not one
 * table per kind — CLAUDE.md invariant 5 applied to recipes the same way
 * playbooks apply it to content: `kind` plus a `config` payload is data, and
 * adding a new recipe kind must not require a migration.
 */
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    kind: text('kind').notNull(), // 'auto_trend' | 'bulk_connector' | 'rss'
    name: text('name').notNull(),
    config: jsonb('config').notNull(),
    status: text('status').notNull().default('active'), // 'active' | 'paused'
    /** Minutes between runs. A recipe with no schedule only runs on `recipe.run`. */
    intervalMinutes: integer('interval_minutes'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recipes_scope_idx').on(t.orgId, t.genomeId)],
);

export const recipeRuns = pgTable(
  'recipe_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id').notNull(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    status: text('status').notNull(), // 'succeeded' | 'failed'
    outputCount: integer('output_count').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('recipe_runs_recipe_idx').on(t.recipeId, t.startedAt.desc())],
);

/** One proposed piece of output from a recipe run — the "output queue" (`AUTO-04.4`). */
export const recipeOutputs = pgTable(
  'recipe_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id').notNull(),
    runId: uuid('run_id').notNull(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    status: text('status').notNull().default('pending_review'), // 'pending_review' | 'approved' | 'rejected'
    /** What would be posted — a preview, not yet a `content_items` row. */
    preview: jsonb('preview').notNull(),
    /** Set once approved and turned into a real draft. */
    contentItemId: uuid('content_item_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('recipe_outputs_scope_idx').on(t.orgId, t.genomeId, t.status)],
);

/* ── P6: Learning loop + agency multi-tenancy ─────────────────────── */

/**
 * Thompson sampling arms — one row per (genome, pillar). `alpha`/`beta` are the
 * Beta-distribution parameters plan §6.7 calls for: every outcome updates one of
 * them, `learning.reweight` samples from the resulting distribution, and
 * `confidence` is derived from how concentrated it has become. Genome-scoped:
 * which pillars are winning for a specific client is exactly the kind of
 * competitive detail `scoped.ts` exists to wall off.
 */
export const learningArms = pgTable(
  'learning_arms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    pillar: text('pillar').notNull(),
    /** Beta(alpha, beta) prior/posterior. Start at 1,1 — uniform, no opinion yet. */
    alpha: real('alpha').notNull().default(1),
    beta: real('beta').notNull().default(1),
    observations: integer('observations').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('learning_arms_unique_idx').on(t.genomeId, t.pillar)],
);

/** One ingested outcome — the write side that moves an arm's alpha/beta. */
export const learningOutcomes = pgTable(
  'learning_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    contentItemId: uuid('content_item_id').notNull(),
    pillar: text('pillar').notNull(),
    /** 0–1, normalised engagement against this genome's own recent baseline. */
    reward: real('reward').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('learning_outcomes_scope_idx').on(t.orgId, t.genomeId),
    // One outcome per content item — a re-ingested metric snapshot updates
    // nothing twice, same non-double-billing reasoning as `credit_ledger`.
    uniqueIndex('learning_outcomes_item_idx').on(t.contentItemId),
  ],
);

/**
 * Agency multi-tenancy (plan §6.9, §12 P6). One Clerk org can already hold many
 * `brands` — this table adds *who on the team can see which client*, which is
 * the actual isolation gap: without it, every org member sees every brand.
 * Not genome-scoped (it grants access to a genome, so it cannot itself require
 * the access it grants) — every query filters on `orgId` regardless.
 */
export const brandMembers = pgTable(
  'brand_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(), // mirrors Role in @sparksocial/shared
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('brand_members_org_idx').on(t.orgId),
    uniqueIndex('brand_members_unique_idx').on(t.brandId, t.userId),
  ],
);

/**
 * `whitelabel.link.create` — a signed, expiring, unauthenticated review link
 * for a client with no SparkSocial account. The token is the credential; the
 * public route trusts it instead of a Clerk session, which is exactly why it
 * carries its own expiry and revocation rather than living forever like an
 * internal id would.
 */
export const reviewLinks = pgTable(
  'review_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    brandId: text('brand_id').notNull(),
    token: text('token').notNull(),
    scope: text('scope').notNull(), // 'calendar' | 'content_item'
    targetId: text('target_id'),
    createdBy: text('created_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('review_links_token_idx').on(t.token)],
);

/**
 * Org-level governance/billing (`org.governance.set`, `org.billing.plan.set`,
 * `org.security.sso.configure`). Separate from `org_budgets` on purpose — that
 * table is specifically the spend cap `policy.ts` rule 4 reads; mixing plan
 * tier and SSO policy into it would blur a table whose whole point is being
 * one narrow, hot-path read.
 */
export const orgSettings = pgTable('org_settings', {
  orgId: text('org_id').primaryKey(),
  plan: text('plan').notNull().default('starter'), // 'starter' | 'growth' | 'agency'
  defaultApprovalMode: text('default_approval_mode').notNull().default('review_first_week'),
  ssoRequired: boolean('sso_required').notNull().default(false),
  /**
   * ── PRD §8.12's org security and data governance ─────────────────────────
   *
   * §8.12 asks the org layer for "security (SSO/2FA)" and "data governance
   * (residency/retention)". This table had four columns: plan, default approval
   * mode, SSO required, updated-at. SSO was the only one of the four §8.12 names
   * that existed.
   *
   * Retention has the most teeth of the three for a product that stores crawled
   * customer sites, inbox messages from third parties, and generated media —
   * "we keep everything forever" is a policy whether or not anyone chose it.
   */
  twoFactorRequired: boolean('two_factor_required').notNull().default(false),
  /**
   * Where this org's data must stay. `any` is the honest default: enforcing a
   * region means provisioning storage in it, which is an infrastructure decision
   * (CLAUDE.md's Azure section) rather than a column — so this records the
   * *commitment* and `org.governance.set` refuses to imply more than that.
   */
  dataResidency: text('data_residency').notNull().default('any'),
  /**
   * Days to keep content, inbox messages and audit rows. Null means indefinitely,
   * which is the current behaviour for every existing org and must stay the
   * default — a migration that silently started deleting customer data would be
   * the worst possible reading of this feature.
   */
  retentionDays: integer('retention_days'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `oauth_connections` — a brand's own connected third-party account (Canva,
 * plus the native publishing platforms — `packages/publish/src/integration.ts`).
 * Genome-scoped:
 * an access token that can read one specific brand's private design library
 * is exactly the kind of material `scoped.ts` exists to wall off — leaking
 * Brand A's Canva token into a query run for Brand B would hand over their
 * actual design library, not just a display bug.
 *
 * `refreshToken`/`expiresAt` are nullable because not every OAuth provider
 * issues a refresh token (some access tokens are long-lived or non-expiring)
 * — absence here means "nothing to refresh," not "broken."
 */
export const oauthConnections = pgTable(
  'oauth_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    genomeId: text('genome_id').notNull(),
    provider: text('provider').notNull(), // 'canva', or a native publishing platform
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    connectedBy: text('connected_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Nullable: not every provider's token response reports granted scopes,
    // and not every provider has a cheap "who am I" call for a label.
    scopes: text('scopes').array(),
    accountLabel: text('account_label'),
  },
  (t) => [
    index('oauth_connections_scope_idx').on(t.orgId, t.genomeId),
    uniqueIndex('oauth_connections_unique_idx').on(t.genomeId, t.provider),
  ],
);
