import { z, ZodTypeAny } from 'zod';
import type {
  Role, Effect, Autonomy, AssetRole, RunStatus, RunTrigger, StepType, Explanation,
} from '@sparksocial/shared/types';
import type { Genome, ComplianceProfile } from '@sparksocial/shared/genome';

/* ── Context handed to every handler ───────────────────────────────── */

export interface ToolCtx {
  orgId: string;
  brandId?: string;
  /** Required for anything touching assets, knowledge, memories, or content. */
  genomeId?: string;
  userId?: string;          // absent when SPARK acts on a schedule
  role: Role;
  runId?: string;           // agent_runs.id when called by SPARK
  approvalMode: 'autopublish' | 'review_first_week' | 'review_everything';
  brandCreatedAt?: Date;    // for review_first_week evaluation
  budget: { remainingCents: number; monthlyCapCents: number };
  db: ScopedDb;             // from packages/db — see scoped.ts
  logger: Logger;
  trace: Trace;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface Trace {
  span<T>(name: string, fn: () => Promise<T>): Promise<T>;
  event(name: string, meta?: Record<string, unknown>): void;
}

/**
 * The repository surface handed to handlers. Structural on purpose: the concrete
 * implementation comes from @sparksocial/db, and every accessor on it is already
 * genome-scoped (see `packages/db/src/scoped.ts`). Handlers never build raw queries.
 *
 * Grows one accessor at a time as tools land — keeping it explicit rather than
 * `unknown` is what makes "the handler is scoped through the repository layer"
 * checkable by the compiler instead of by review.
 */
export interface ScopedDb {
  genomes: {
    createDraft(args: {
      brandId: string;
      orgId: string;
      identity: unknown;
      dimensions: unknown;
      voice: unknown;
      source: 'user' | 'inference' | 'learning';
    }): Promise<{ id: string }>;
    patchDimensions(args: {
      genomeId: string;
      orgId: string;
      dimensions: unknown;
      avatarEnabled: boolean;
    }): Promise<{ id: string; version: number }>;
    /**
     * Merges a partial constraints patch without touching `dimensions` or the
     * rest of `constraints` — `patchDimensions`'s sibling for fields
     * `dimensions.set` has no business setting, starting with the vendor
     * avatar/voice registration (`genome.avatar_config.set`).
     */
    patchConstraints(args: {
      genomeId: string;
      orgId: string;
      patch: {
        heygenAvatarId?: string;
        elevenlabsVoiceId?: string;
        complianceProfile?: ComplianceProfile;
        avatarEnabled?: boolean;
        /** `null` clears an explicit override, reverting to the plain derived default. */
        avatarOverride?: { reason: string; setBy: string; setAt: string } | null;
      };
    }): Promise<{ id: string; version: number }>;
    /**
     * Merges a partial identity patch — the write side of `genome.identity.set`
     * (ONB-02's chip-correction screen). Same single-field-merge shape as
     * `patchConstraints`; only the keys present in `identity` change.
     */
    patchIdentity(args: {
      genomeId: string;
      orgId: string;
      identity: Partial<Genome['identity']>;
    }): Promise<{ id: string; version: number }>;
    /**
     * Merges a partial offer patch — the write side of `genome.offer.set`.
     * Same single-field-merge shape as `patchIdentity`; only the keys
     * present in `offer` change. Exists because nothing else in onboarding
     * or the crawl ever sets `offer.primary_cta`, and fourteen playbook
     * beats source their CTA from it (see `genome/src/offer.ts`).
     */
    patchOffer(args: {
      genomeId: string;
      orgId: string;
      offer: Partial<Genome['offer']>;
    }): Promise<{ id: string; version: number }>;
    /**
     * Merges a partial `learned` patch — the write side of the learning loop
     * (plan §6.7). Same single-field-merge shape as `patchOffer`; only the
     * keys present in `patch` change. The only writer of this is
     * `learning.reweight` — nothing else in the registry has any business
     * setting a genome's learned mix weights or confidence.
     */
    patchLearned(args: {
      genomeId: string;
      orgId: string;
      patch: Partial<Genome['learned']>;
    }): Promise<{ id: string; version: number }>;
    /** Scoped read. Returns undefined rather than throwing when out of scope. */
    get(genomeId: string, orgId: string): Promise<Genome | undefined>;
    /**
     * Every genome in the org — the brand switcher's source, and the only way a
     * caller discovers which `genomeId` values it is entitled to. Deliberately
     * takes no `genomeId`: it answers "what may I ask for", so gating it on an
     * already-chosen genome would be circular.
     */
    listForOrg(orgId: string): Promise<Array<{ id: string; brandId: string; name: string; updatedAt: Date }>>;
  };
  assets: {
    /**
     * Counts by asset_role for the genome — the resolver's availability input.
     * Must reflect assets actually ingested via `create`; a store that returns
     * static counts here would make `playbook.resolve` lie about the Asset Graph.
     */
    inventory(genomeId: string, orgId: string): Promise<Partial<Record<AssetRole, number>>>;
    /** §4.3 retrieval — ranked by similarity minus recency/usage penalties. */
    retrieve(args: {
      genomeId: string;
      orgId: string;
      embedding: number[];
      requiredRoles?: AssetRole[];
      k: number;
    }): Promise<
      Array<{
        assetId: string;
        role: AssetRole;
        caption: string | null;
        score: number;
        usageCount: number;
        lastUsedAt: Date | null;
        rightsStatus: string;
        url: string;
        mediaType: string;
        folderId: string | null;
      }>
    >;
    /** §4.1 ingest — the only way a new asset enters the graph. */
    create(args: {
      genomeId: string;
      orgId: string;
      url: string;
      assetRole: AssetRole;
      mediaType: 'image' | 'video' | 'audio';
      rightsStatus: 'cleared' | 'pending' | 'restricted';
      caption: string;
      embedding: number[];
      source: string;
    }): Promise<{ id: string }>;
    /** Concatenatable grounding text for `guard.claim_grounding` (§10). */
    captionsByRole(genomeId: string, orgId: string, roles: AssetRole[]): Promise<string[]>;
    /** Rights + reuse-cooldown lookup for `guard.rights` / `guard.duplicate` (§10). */
    info(
      ids: string[],
      genomeId: string,
      orgId: string,
    ): Promise<Record<string, { rightsStatus: string; lastUsedDaysAgo?: number; url: string; mediaType: string }>>;
    /**
     * `asset.rights.set` — the only writer of `rightsStatus` after ingest.
     * Returns undefined when the id is out of scope or doesn't exist, same
     * "one outcome for both" rule as `ContentStore.updateDraft`.
     */
    setRights(args: {
      id: string;
      genomeId: string;
      orgId: string;
      rightsStatus: 'cleared' | 'pending' | 'restricted';
    }): Promise<{ id: string; rightsStatus: string } | undefined>;
    /**
     * `asset.reuse`'s write, also called automatically by `publish.now` for
     * every `referencedAssetIds` entry on success — see that tool's own
     * comment for why. Increments `usageCount` and sets `lastUsedAt` to now.
     */
    recordUsage(args: {
      id: string;
      genomeId: string;
      orgId: string;
    }): Promise<{ id: string; usageCount: number; lastUsedAt: Date | null } | undefined>;
    /**
     * `asset.folder.move`'s write. `folderId: null` moves an asset back out
     * of any folder. Returns undefined when the asset is out of scope, or
     * when a non-null `folderId` doesn't resolve to a real folder in the
     * same genome — one outcome for both, same "out of scope reads as not
     * found" rule as `ContentStore.updateDraft`.
     */
    moveToFolder(args: {
      id: string;
      genomeId: string;
      orgId: string;
      folderId: string | null;
    }): Promise<{ id: string; folderId: string | null } | undefined>;
  };
  /** Named groupings for assets — `asset.folder.create`/`.move` (the latter lives on `assets`, since it writes that table). See {@link AssetFolderStore}. */
  assetFolders: AssetFolderStore;
  /** Content history and drafts. See {@link ContentStore}. */
  content: ContentStore;
  /** CTA link attribution — `link.shorten`'s optional write, `analytics.cta_traffic`'s read. See {@link CtaLinkStore}. */
  ctaLinks: CtaLinkStore;
  /** Post performance snapshots — `analytics.sync`'s one write. See {@link AnalyticsStore}. */
  analytics: AnalyticsStore;
  /** The engagement inbox — `engage.ingest`/`.classify`. See {@link EngagementStore}. */
  engagement: EngagementStore;
  /** Sales opportunities surfaced from the engagement inbox. See {@link OpportunityStore}. */
  opportunities: OpportunityStore;
  /**
   * Agent run history — the Agent Timeline's read side (plan §4.5). Read-only by
   * construction: runs are written by `RunRecorder` inside the agent loop, and
   * nothing a *tool* does should ever be able to rewrite the record of what the
   * agent did. The Timeline is the trust mechanism that makes autopublish
   * acceptable, so its history has to be append-only from every other angle.
   */
  /**
   * Campaigns and their calendars (§6.8). Reached through the same handle as
   * everything else so a handler has one injection point, though the campaign
   * row itself carries no confidential material — see {@link CampaignStore}.
   */
  campaigns: CampaignStore;
  /** Org-level plan/governance/SSO config — `org.*` (plan §6.9, §12 P6). See {@link OrgSettingsStore}. */
  orgSettings: OrgSettingsStore;
  /** Saved/tracked trends per genome — `trend.watchlist`. See {@link TrendWatchlistStore}. */
  trends: TrendWatchlistStore;
  /** Thompson-sampling arms and outcomes — the learning loop (plan §6.7). See {@link LearningStore}. */
  learning: LearningStore;
  /** Automation recipes and their output queue (plan §12 P5). See {@link RecipeStore}. */
  recipes: RecipeStore;
  /** A brand's own connected third-party accounts (Canva today) — `brand.oauth.connect`. See {@link OAuthConnectionStore}. */
  oauthConnections: OAuthConnectionStore;
  /** Claim-grounding source text — `brand.knowledge.attach`'s one write. See {@link KnowledgeStore}. */
  knowledge: KnowledgeStore;
  /** Which team members can see which brand — agency isolation (plan §6.9). See {@link BrandMemberStore}. */
  brandMembers: BrandMemberStore;
  /** Unauthenticated, expiring client review links — `whitelabel.link.create`. See {@link ReviewLinkStore}. */
  reviewLinks: ReviewLinkStore;
  /** The Review queue. See {@link ApprovalStore}. */
  approvals: ApprovalStore;
  /** The approval ladder's storage (PRD §7.1). */
  brands: BrandGovernanceStore;
  /** SPARK's questions to the owner and their answers. See {@link HumanLoopStore}. */
  humanLoop: HumanLoopStore;
  /** Likeness consent for avatar/voice cloning (§10). See {@link ConsentStore}. */
  consent: ConsentStore;
  /**
   * Read-only view of the audit trail, for `agent.explain`.
   *
   * Deliberately read-only and deliberately narrow: `writeToolCall` in
   * `invoke.ts` is the only writer, and a tool able to rewrite the record of
   * what the agent did would undo the Timeline's entire purpose.
   */
  toolCalls: {
    /**
     * One recorded call. Returns undefined rather than throwing when the row
     * belongs to another org — the same "out of scope reads as not found" rule
     * as `genomes.get`, so probing ids leaks nothing.
     */
    get(callId: string, orgId: string): Promise<RecordedCall | undefined>;
    /**
     * `org.audit.query` — every call across the whole org, newest first, not
     * one genome's slice of it. Same "projection, never the row" rule as
     * `get`: input/output are never selected.
     */
    list(orgId: string, args: { tool?: string; since?: Date; until?: Date; limit: number }): Promise<RecordedCall[]>;
  };
  runs: {
    /** Most recent runs for the brand, newest first. `limit` is enforced by the store. */
    list(brandId: string, limit: number): Promise<RunSummary[]>;
    /**
     * One run with its ordered steps. Returns undefined rather than throwing
     * when the run belongs to another brand — same "out of scope reads as not
     * found" rule as `genomes.get`, so probing ids leaks nothing.
     */
    get(runId: string, brandId: string): Promise<RunDetail | undefined>;
  };
}

export type ApprovalMode = 'autopublish' | 'review_first_week' | 'review_everything';

export interface BrandGovernance {
  brandId: string;
  name: string;
  approvalMode: ApprovalMode;
  /** `review_first_week` graduates seven days after this. */
  createdAt: Date;
  /** The kill switch. `policy.ts` denies every non-read agent call when true. */
  agentPaused: boolean;
  pausedAt?: Date;
  pausedBy?: string;
  pauseReason?: string;
  /**
   * Target posts per week — how loud the account is, set by the owner and read
   * by calendar generation. Distinct from the kill switch: pausing stops the
   * agent, frequency shapes what it does while running.
   */
  postsPerWeek: number;
  /** `approval.policy.set` — per-family autonomy overrides, e.g. `{ engage: 'approval' }`. */
  familyOverrides?: Partial<Record<string, Autonomy>>;
  /** Platforms that always route publish-effect calls to approval, regardless of approvalMode. */
  restrictedPlatforms?: string[];
  /** Content types (playbook pillar, media type — caller-defined) that always route to approval. */
  restrictedContentTypes?: string[];
  /** Publishing freeze windows — crisis pause, holiday, etc. */
  quietWindows?: Array<{ from: Date; to: Date; reason: string }>;
  /** Permission toggles PRD §6 names — `spendCredits`/`automationAutoPublish`. */
  permissions?: { spendCredits?: boolean; automationAutoPublish?: boolean };

  /**
   * ── The brand's own governance (PRD §8.2 ONB-03, §8.12, §9) ───────────────
   *
   * Distinct from the approval ladder above, which is about *who signs off*.
   * This is about *what the brand will not say* — and it did not exist in any
   * layer of this system until now, which left §9's whole guardrail-enforcement
   * section with nothing to enforce. See `brands` in `schema.ts`.
   */
  /** Subjects SPARK may not post about. Flag under normal mode, block under strict. */
  restrictedTopics?: string[];
  /** Assertions this brand does not make. Same soft/hard escalation as topics. */
  claimsToAvoid?: string[];
  /** §9's strict compliance mode: a restricted topic or claim blocks rather than flags. */
  strictMode: boolean;
  /** ONB-03's voice sliders. Overrides the genome's inferred `tone_vector` where set. */
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  /** Words never to use, checked verbatim by `guard.brand_voice`. */
  bannedPhrases?: string[];
  logoUrl?: string;
  brandColors?: string[];

  /**
   * ── Scheduling (PRD §8.2 required, §8.7 a Calendar input) ─────────────────
   */
  /**
   * ── PRD §8.8's engagement configuration ──────────────────────────────────
   *
   * *"Inputs/Config: Engagement autonomy level. Enabled engagement types
   * (comments/DMs/story replies). Approval rules for sending replies."*
   *
   * None of it existed, which is what made `autonomyConfigured` forgeable:
   * there was nothing on the server to compare a claim against.
   *
   * `off` is the default and is not the same as unset — a brand that has never
   * chosen leaves SPARK suggesting replies for a person to send, which is the
   * conservative rung and matches how `approvalMode` defaults.
   */
  engagementAutonomy: 'off' | 'suggest' | 'auto';
  /** Which surfaces SPARK may answer on. Empty means every enabled type. */
  engagementTypes?: string[];

  /** IANA zone name. Defaults to `UTC` so every brand has a defined one. */
  timezone: string;
  /** Local hours-of-day posts are placed into. Empty falls back to `DEFAULT_POSTING_WINDOWS`. */
  postingWindows?: number[];
}

/**
 * Where the approval ladder actually lives (PRD §7.1, §9).
 *
 * `policy.ts` has implemented every rung from the start; until this existed
 * there was nowhere to record which rung a brand was on, so both auth resolvers
 * returned a hardcoded `autopublish` and the ladder was real in tests and inert
 * in production.
 *
 * `get` upserts rather than returning undefined: a brand that has never had its
 * mode set must still land somewhere defined, and the safe default is the
 * conservative rung, not the permissive one.
 */
export interface BrandGovernanceStore {
  get(brandId: string, orgId: string, name?: string): Promise<BrandGovernance>;
  setApprovalMode(brandId: string, orgId: string, mode: ApprovalMode): Promise<BrandGovernance>;
  /**
   * Stops or restarts the agent for one brand.
   *
   * Scoped per brand rather than per org: in an agency workspace one client's
   * agent going wrong is not a reason to freeze the other thirty-nine.
   */
  setAgentPaused(args: {
    brandId: string;
    orgId: string;
    paused: boolean;
    by: string;
    reason?: string;
  }): Promise<BrandGovernance>;
  /** Target posts per week. Range is enforced by the tool, not here. */
  setFrequency(args: {
    brandId: string;
    orgId: string;
    postsPerWeek: number;
    by: string;
  }): Promise<BrandGovernance>;
  /**
   * `approval.policy.set` — merges a partial patch over the five fields above.
   * A key set to `undefined` leaves the stored value untouched; `null` (on
   * the nullable ones) clears it back to "no override". Merges rather than
   * replaces wholesale for the same reason `patchConstraints` does: setting
   * `restrictedPlatforms` should not silently wipe `quietWindows` someone
   * configured in a separate call.
   */
  setPolicy(args: {
    brandId: string;
    orgId: string;
    patch: {
      familyOverrides?: Partial<Record<string, Autonomy>> | null;
      restrictedPlatforms?: string[] | null;
      restrictedContentTypes?: string[] | null;
      quietWindows?: Array<{ from: Date; to: Date; reason: string }> | null;
      permissions?: { spendCredits?: boolean; automationAutoPublish?: boolean } | null;
    };
  }): Promise<BrandGovernance>;

  /**
   * `brand.governance.set` — the brand's own rules: voice, restricted topics,
   * claims to avoid, strict mode, brand kit, timezone, posting windows.
   *
   * Kept separate from {@link setPolicy} rather than folded into it, because the
   * two answer different questions and are edited by different people at
   * different times. `setPolicy` is "who has to sign this off" and is an
   * operator's setting; this is "what may we say and when do we say it", is
   * captured in onboarding, and is the brand's own statement about itself.
   * Merging them would mean one screen owning both, and a partial patch from
   * either able to clear the other's fields.
   *
   * Same merge semantics as `setPolicy`: `undefined` leaves a field alone,
   * `null` clears it.
   */
  setGovernance(args: {
    brandId: string;
    orgId: string;
    patch: {
      restrictedTopics?: string[] | null;
      claimsToAvoid?: string[] | null;
      strictMode?: boolean;
      toneVector?: { formal: number; playful: number; technical: number; bold: number } | null;
      bannedPhrases?: string[] | null;
      logoUrl?: string | null;
      brandColors?: string[] | null;
      timezone?: string;
      postingWindows?: number[] | null;
      engagementAutonomy?: 'off' | 'suggest' | 'auto';
      engagementTypes?: string[] | null;
    };
  }): Promise<BrandGovernance>;
}

/**
 * The subset of a `tool_calls` row `agent.explain` is allowed to return.
 *
 * Narrower than `ToolCallRecord` on purpose. That row carries `input` and
 * `output` verbatim — a genome draft, a recipient phone number, a caption — and
 * `agent.explain` answers "why did you do that", not "show me everything you
 * held at the time". Widening this is how an explainability feature becomes a
 * data-exfiltration one.
 */
export interface RecordedCall {
  id: string;
  tool: string;
  caller: 'user' | 'agent';
  decision: string;
  status: string;
  ruleId?: string;
  reason?: string;
  costCents: number;
  at: Date;
  runId?: string;
  /** Absent when the tool makes no user-visible decision, or the call never ran. */
  why?: Explanation;
}

/**
 * SPARK's side of the conversation with the owner (plan §3.2 `human.*`).
 *
 * The asymmetry that matters is in the schema, not the handlers: `body` is
 * written by us and `answer` comes from a person over WhatsApp, which is an
 * untrusted channel. An answer is recorded, shown and used as *content*; it can
 * never authorise a tool call. See `whatsapp.receive`.
 */
export interface HumanMessage {
  id: string;
  brandId: string;
  /** `ask` expects a reply and parks the run; `notify` does not. */
  kind: 'ask' | 'notify';
  body: string;
  /** Offered choices, for an `ask`. Free text is still accepted. */
  options?: string[];
  urgency: 'low' | 'normal' | 'high';
  runId?: string;
  createdAt: Date;
  /** UNTRUSTED. The owner's words, verbatim. */
  answer?: string;
  answeredAt?: Date;
  answeredBy?: string;
  /** Where it was delivered, e.g. `whatsapp`. Absent until sent. */
  channel?: string;
}

export interface HumanLoopStore {
  create(args: {
    brandId: string;
    orgId: string;
    kind: 'ask' | 'notify';
    body: string;
    options?: string[];
    urgency: 'low' | 'normal' | 'high';
    runId?: string;
  }): Promise<HumanMessage>;
  get(id: string, orgId: string): Promise<HumanMessage | undefined>;
  /** Unanswered `ask` items, oldest first — the owner's inbox. */
  listPending(brandId: string, orgId: string, limit: number): Promise<HumanMessage[]>;
  /**
   * Record the owner's reply. Returns undefined when the id is out of scope or
   * already answered, so a replayed webhook cannot overwrite a decision.
   */
  answer(args: {
    id: string;
    orgId: string;
    answer: string;
    by: string;
  }): Promise<HumanMessage | undefined>;
  /** Note the delivery channel once a transport has accepted it. */
  markDelivered(id: string, orgId: string, channel: string): Promise<void>;
}

/** One row in `consent_records` — see the table comment in `packages/db/src/schema.ts`. */
export interface ConsentRecord {
  id: string;
  genomeId: string;
  orgId: string;
  /** Free text — `'avatar_clone' | 'voice_clone'`, invariant 5: never a closed enum a niche could hardcode against. */
  kind: string;
  /** Who the consent is for, e.g. "Emeka, owner" — kept apart from `kind` because one genome can have several subjects. */
  subject: string;
  evidenceUrl?: string;
  grantedBy: string;
  grantedAt: Date;
  revokedBy?: string;
  revokedAt?: Date;
}

/**
 * Likeness consent (§10) behind `genome.constraints.avatar_enabled` and
 * `guardrails.rights()`'s `avatarEnabled` input.
 *
 * Append-only, mirroring {@link CreditStore}'s ledger: `revoke` writes a new
 * fact (who revoked, when) rather than deleting or editing the grant, so the
 * history of who was ever allowed stays intact.
 */
export interface ConsentStore {
  grant(args: {
    genomeId: string;
    orgId: string;
    kind: string;
    subject: string;
    evidenceUrl?: string;
    grantedBy: string;
  }): Promise<ConsentRecord>;
  /** No-op (returns undefined) when `id` is out of scope or already revoked — idempotent on replay. */
  revoke(args: { id: string; orgId: string; revokedBy: string }): Promise<ConsentRecord | undefined>;
  /**
   * True when the newest record for this genome + kind (+ `subject`, if given)
   * has no `revokedAt`. Omitting `subject` asks "is anyone cleared" — what
   * `avatarEnabled` needs, since the gate is genome-wide, not per person.
   */
  hasActive(genomeId: string, orgId: string, kind: string, subject?: string): Promise<boolean>;
  /** Full history, newest first — the consent record UI's list. */
  list(genomeId: string, orgId: string): Promise<ConsentRecord[]>;
}

/** One `content_items` row — a scheduled slot, an in-progress draft, or a published post. */
export interface ContentDraft {
  id: string;
  genomeId: string;
  campaignId?: string;
  playbookId: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
  pillar?: string;
  status: string;
  platform?: string;
  /** The platform adapter's receipt — set once, by `markPublished`. */
  externalId?: string;
  via?: string;
  url?: string;
  /** Set only when `status === 'blocked'` — see `ContentStore.markBlocked`. */
  blockedReason?: string;
  /**
   * The resolved beats/copy payload. `unknown` at this layer for the same
   * reason `CampaignPlan.plan` is — the shape belongs to whichever package
   * builds it (`@sparksocial/generate`), and the store must not need to know
   * it to persist it.
   */
  copy?: unknown;
  why?: Explanation;
  scheduledAt?: Date;
  createdAt: Date;
}

/**
 * `content_items` (§4/§6.8) — publishing history plus every draft in flight.
 *
 * `recent` predates the rest: it was the guardrail layer's only need of this
 * table (§10's `avatar_saturation`/`duplicate` checks over published posts).
 * `createDraft`/`get`/`updateDraft` are what `content.draft` (the generation
 * tool) needs to actually persist a draft rather than returning one that
 * evaporates the moment the response is sent — the gap left by
 * `calendar.generate`, which only ever writes empty, unfilled slots.
 */
export interface ContentStore {
  /**
   * Trailing-window published items for `guard.avatar_saturation` and
   * `guard.duplicate` (§10). `embedding` is null for items that predate
   * embedding or aren't text-bearing.
   */
  recent(
    genomeId: string,
    orgId: string,
    windowDays: number,
  ): Promise<Array<{ isAvatarFormat: boolean; embedding: number[] | null }>>;

  /**
   * A brand-new draft, for the ad-hoc "one brief → draft pack" path (CC-02)
   * where no calendar slot exists yet.
   */
  createDraft(args: {
    genomeId: string;
    orgId: string;
    playbookId: string;
    mode: 'synthesize' | 'assemble' | 'direct_finish';
    pillar?: string;
    copy: unknown;
    why: Explanation;
    campaignId?: string;
    /**
     * The recipe that produced this, when one did — `policy.ts` rule 7's
     * automation branch reads it back through `publishOrigin`. Without it a
     * recipe's output was indistinguishable from a person's once it became a
     * content item, so "automation auto-publish is disabled" could not be
     * enforced against the only thing it was about.
     */
    recipeId?: string;
    /** The brief, for a row whose copy will be written later (by the scheduler). */
    intent?: string;
    /**
     * Create it already scheduled.
     *
     * A recipe that publishes unattended has to be able to put a post on the
     * calendar without a human opening the Draft Panel first. The copy is
     * written by the scheduler when the slot comes due — same path a campaign
     * slot takes.
     */
    scheduledAt?: Date;
  }): Promise<ContentDraft>;

  get(id: string, genomeId: string, orgId: string): Promise<ContentDraft | undefined>;

  /**
   * Fills in an existing slot — the normal path, since `calendar.generate`
   * already created the row with `playbookId`/`mode`/`pillar`/`scheduledAt`
   * set and nothing else. Undefined when `id` is out of scope, already
   * published, or does not exist — one outcome for all three, same reasoning
   * as `HumanLoopStore.answer`.
   */
  updateDraft(args: {
    id: string;
    genomeId: string;
    orgId: string;
    copy: unknown;
    why: Explanation;
  }): Promise<ContentDraft | undefined>;

  /**
   * Every content item for a genome, newest first — the Draft List's (CC-03)
   * source. Genome-wide, not per-campaign: `content.draft`'s ad-hoc path
   * (CC-02) creates rows with no `campaignId` at all, so a campaign-scoped
   * read (`CampaignStore.slots`) would never surface them.
   */
  list(genomeId: string, orgId: string, args: { status?: string; limit: number }): Promise<ContentDraft[]>;

  /**
   * Places or moves a content item on the calendar. `CAL-04` ("create post
   * for date") and `CAL-05` (drag-and-drop reschedule) are the same
   * operation from the store's point of view — set `scheduledAt`, mark it
   * `scheduled` — so one method serves both.
   */
  schedule(args: { id: string; genomeId: string; orgId: string; scheduledAt: Date }): Promise<ContentDraft | undefined>;

  /**
   * The write side of `recent()` — called once, by `publish.now`, the moment
   * a post actually goes live. Sets `status: 'published'`, `platform` (the
   * only place that column is ever filled for a manual publish, since the
   * Draft Panel only chooses a platform at this exact step) and the copy's
   * `embedding`, which is what makes the row visible to `recent()` at all.
   *
   * `externalId`/`via`/`url` are the platform adapter's receipt — persisted
   * here because nothing else in the registry has anywhere to put it, and
   * `analytics.sync` (P4) needs `externalId` to know what to poll for metrics.
   */
  markPublished(args: {
    id: string;
    orgId: string;
    platform: string;
    embedding: number[];
    externalId: string;
    via: string;
    url?: string;
    publishedAt?: Date;
  }): Promise<void>;

  /**
   * `publish.rollback`'s write — the inverse of `markPublished`, and
   * deliberately not a reset back to `'draft'`: a rolled-back post has a real
   * history (it *was* live) that re-entering the ordinary draft pipeline
   * would erase. `externalId`/`via`/`url` are kept, not cleared, so the
   * record of what was deleted survives the rollback.
   */
  markRolledBack(args: { id: string; orgId: string; reason?: string }): Promise<void>;

  /**
   * The scheduler's write when a due item's `publish.now` call comes back
   * `GUARDRAIL_BLOCKED` (`apps/api/src/scheduler.ts`). A guardrail *block*
   * (unlike a *flag*, which the policy engine can hold for review) means the
   * content itself is the problem — the same input will fail identically on
   * every future tick, so leaving `status: 'scheduled'` in place would mean
   * `findDue` re-selects and re-fails it forever. Sets `status: 'blocked'`,
   * distinct from `'scheduled'` (so it stops being due) and from `'draft'`
   * (so it doesn't look like it was never scheduled — a person needs to see
   * *why* it stalled, via `reason`, not just that it's editable again).
   */
  markBlocked(args: { id: string; orgId: string; reason: string }): Promise<void>;

  /**
   * Where this item came from, for `policy.ts` rule 7's automation branch —
   * `publish.now`'s `policySubject` reads it before the handler runs.
   *
   * Deliberately narrow: it answers "was this a recipe's doing, and did that
   * recipe ask for review" and nothing else. A wider "get the item" would
   * tempt the policy layer into deciding things from content it has no
   * business reading. `undefined` when the item does not exist — which
   * `policySubject` treats as "not automation" rather than as fatal, since
   * `publish.now`'s own handler will fail on the missing row a moment later
   * with a better message than the policy engine could give.
   */
  publishOrigin(args: {
    id: string;
    genomeId: string;
    orgId: string;
  }): Promise<{ recipeId?: string; reviewBeforePublish: boolean } | undefined>;

  /**
   * ── PRD §7.4's two missing states ────────────────────────────────────────
   *
   * *"Unified statuses across content: Draft → Needs Review → Approved →
   * Scheduled → Published. Failed / Blocked."*
   *
   * `content_items.status` only ever held `draft`, `scheduled`, `published`,
   * `failed` or `blocked`. `needs_review` existed solely as an *engagement*
   * category and `approved` only on approval and recipe-output rows, so a post
   * held by the approval ladder stayed `scheduled` while a `tool_calls` row sat
   * at `gated` — the Review queue was assembled from audit rows and the content
   * item itself had no idea it was waiting on anyone.
   *
   * Two things followed. §8.7's "filters by status" could not offer a Needs
   * Review filter, because no item was ever in that state. And a held item
   * stayed `scheduled`, so `findDue` re-selected it on every tick and re-held
   * it, forever.
   */

  /**
   * A publish was held for a human. Sets `status: 'needs_review'` and records
   * why, so the calendar can say what is waiting and on what rule.
   *
   * Deliberately takes the item *out* of `scheduled`: it is no longer due, it is
   * pending a decision, and re-attempting it every minute until somebody
   * notices is not the same thing as waiting for them.
   */
  markNeedsReview(args: { id: string; orgId: string; reason: string }): Promise<void>;

  /**
   * A human approved it. Sets `status: 'approved'`.
   *
   * Usually momentary — `approval.decide` replays the held call straight away
   * and a successful replay moves it to `published` within the same request. It
   * persists exactly when it matters most: when the replay *failed*, so the
   * calendar shows "a person approved this and it still did not go out", which
   * is otherwise indistinguishable from "nobody has looked at it".
   */
  markApproved(args: { id: string; orgId: string }): Promise<void>;

  /**
   * A reviewer said no. Returns the item to `draft` with the reason recorded.
   *
   * `draft`, not a `rejected` state of its own: PRD §7.4's ladder has no such
   * rung, and the honest description of a post a reviewer turned down is that it
   * is editable again. A terminal `rejected` would make the ordinary next
   * action — fix the copy and resubmit — impossible without a second tool to
   * undo it.
   */
  markRejected(args: { id: string; orgId: string; reason: string }): Promise<void>;

  /** Write side of `compose.render` — one row per aspect ratio rendered. */
  recordRender(args: {
    contentItemId: string;
    genomeId: string;
    orgId: string;
    aspect: string;
    storageUrl: string;
    engine: string;
    costCents: number;
  }): Promise<RenderRecord>;

  /** Every render already produced for a content item, newest first. */
  listRenders(contentItemId: string, genomeId: string, orgId: string): Promise<RenderRecord[]>;
}

/** One `renders` row — `compose.render`'s output for a single aspect ratio. */
export interface RenderRecord {
  id: string;
  contentItemId: string;
  aspect: string;
  storageUrl: string;
  engine: string;
  costCents: number;
  createdAt: Date;
}

/** One platform's performance snapshot, returned by {@link AnalyticsStore.record}. */
export interface ContentMetricsSnapshot {
  contentItemId: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  impressions: number;
  syncedAt: Date;
}

/**
 * `content_metrics` (P4, `CC-04`'s `analytics.sync`) — one row per
 * `(contentItemId, platform)`, upserted on every sync. Kept off `ContentStore`
 * even though both tables describe the same post: a draft/publish is
 * something SPARK or a human *decides*, a metrics sync is a fact reported by
 * the platform, and conflating the two would let a sync accidentally touch
 * publishing state it has no business changing.
 */
export interface AnalyticsStore {
  record(args: {
    genomeId: string;
    orgId: string;
    contentItemId: string;
    platform: string;
    likes: number;
    comments: number;
    shares: number;
    views: number;
    impressions: number;
    raw: unknown;
  }): Promise<ContentMetricsSnapshot>;
  /** Every synced platform snapshot across a set of posts — `campaign.report_vs_outcome`'s roll-up. */
  listForItems(contentItemIds: string[], orgId: string, genomeId: string): Promise<ContentMetricsSnapshot[]>;
}

/** One `link.shorten` call attributed to a content item — `analytics.cta_traffic`'s storage. */
export interface ContentLinkRecord {
  id: string;
  genomeId: string;
  contentItemId: string;
  dubLinkId: string;
  shortUrl: string;
  destinationUrl: string;
  createdAt: Date;
}

export interface CtaLinkStore {
  create(args: {
    genomeId: string;
    orgId: string;
    contentItemId: string;
    dubLinkId: string;
    shortUrl: string;
    destinationUrl: string;
  }): Promise<ContentLinkRecord>;
  /** Every attributed link across a set of posts, this genome only. */
  listForItems(contentItemIds: string[], orgId: string, genomeId: string): Promise<ContentLinkRecord[]>;
}

/** One row in the engagement inbox (PRD §8.8, `ENG-01`→`ENG-02.4`) — a comment, DM, or story reply from the audience. */
export interface EngagementMessage {
  id: string;
  genomeId: string;
  platform: string;
  externalId: string;
  kind: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  contentItemId?: string;
  receivedAt: Date;
  status: string;
  category?: string;
  intentScore?: number;
  suggestedReply?: string;
  why?: Explanation;
  createdAt: Date;
}

/**
 * The engagement inbox (PRD §8.8) — `engage.ingest` writes, `engage.classify`
 * triages, `engage.reply.send`/`.autohandle`/`.escalate`/`.takeover` move a
 * row out of the open feed. Genome-scoped like `ContentStore`: an audience
 * message quotes (and sometimes reveals) the same client-confidential detail
 * a draft does.
 */
export interface EngagementStore {
  /**
   * Upserted on `(orgId, genomeId, platform, externalId)` — inbound delivery
   * is at-least-once on every platform, and a webhook retry must land the
   * same feed row rather than duplicate it.
   */
  ingest(args: {
    genomeId: string;
    orgId: string;
    platform: string;
    externalId: string;
    kind: string;
    authorHandle: string;
    authorName?: string;
    text: string;
    contentItemId?: string;
    receivedAt?: Date;
  }): Promise<EngagementMessage>;

  get(id: string, genomeId: string, orgId: string): Promise<EngagementMessage | undefined>;

  /** The triage write — sorts a message into the feed's tabs. */
  classify(args: {
    id: string;
    genomeId: string;
    orgId: string;
    category: string;
    intentScore: number;
    suggestedReply?: string;
    why: Explanation;
  }): Promise<EngagementMessage | undefined>;

  /**
   * The inbox feed's read — `engage.list` (`ENG-02`'s tabs), newest first.
   * `status`/`category` are independent filters (a caller can pass either,
   * both, or neither); `category` is left as `string` here rather than
   * `EngagementCategory` because `defineTool.ts` sits below `packages/engage`
   * in the build order and cannot import its enum.
   */
  list(
    genomeId: string,
    orgId: string,
    args: { status?: string; category?: string; limit: number },
  ): Promise<EngagementMessage[]>;

  /**
   * `engage.audit.query`'s read — resolved engagement actions (status in
   * `statuses`, i.e. not `new`/`classified`) within an optional time window,
   * newest first. Kept apart from `list` above: that call answers "what's in
   * my feed right now" against one `status`, this answers "what did SPARK (or
   * a human) actually do" against a fixed set of terminal statuses plus a
   * date range `list` has no caller for.
   */
  audit(
    genomeId: string,
    orgId: string,
    args: { statuses: string[]; since?: Date; until?: Date; limit: number },
  ): Promise<EngagementMessage[]>;

  /**
   * `engage.reply.send`'s write, once delivery succeeds. Flips `status` to
   * `replied` — no new column for the sent text or the outbound platform
   * message id: the enum already on the row
   * (`new|classified|replied|auto_handled|escalated|dismissed`) has a slot
   * for exactly this, and the reply text itself is exactly the `text` the
   * caller supplied, already captured on the audit row (`tool_calls.input`)
   * the same way every other write's input is.
   */
  markReplied(args: { id: string; genomeId: string; orgId: string }): Promise<EngagementMessage | undefined>;

  /**
   * `engage.autohandle`'s write, once the unattended send succeeds. A
   * deliberately separate status from `replied` — the row's `status` column
   * (`new|classified|replied|auto_handled|escalated|dismissed`) already
   * distinguishes an unattended SPARK send from a human-approved one, and
   * collapsing them onto `replied` would erase that distinction from every
   * read that groups by status (`engage.list`, `engage.audit.query`).
   */
  markAutoHandled(args: { id: string; genomeId: string; orgId: string }): Promise<EngagementMessage | undefined>;

  /**
   * Flips `status` to `escalated` — `engage.escalate`'s write, and also
   * `engage.takeover`'s (see that tool's own comment for why the two share
   * one status value rather than each getting its own).
   */
  markEscalated(args: { id: string; genomeId: string; orgId: string }): Promise<EngagementMessage | undefined>;
}

/**
 * A sales lead surfaced from the engagement inbox — the master plan's own
 * schema sketch (§3.2's `opportunities` table: "inbox_item_id, temperature
 * (hot|warm|cold), recommended_action, routed_to"). Kept as its own table
 * rather than columns on `engagement_messages` because a message classified
 * `sales_opportunity` can be worked without ever becoming one (a human may
 * decide it isn't, or several opportunities could in principle be raised
 * against the same thread later) — this is a decision made *about* a
 * message, not an attribute intrinsic to it.
 */
export interface Opportunity {
  id: string;
  genomeId: string;
  /** The `engagement_messages.id` this was raised from. */
  inboxItemId: string;
  temperature: 'hot' | 'warm' | 'cold';
  recommendedAction: string;
  /** Free text — a person's name, an email, a CRM reference. No CRM integration exists yet. */
  routedTo?: string;
  createdAt: Date;
}

/** `engage.opportunity.create`/`.route`'s storage. Genome-scoped like {@link EngagementStore}. */
export interface OpportunityStore {
  create(args: {
    genomeId: string;
    orgId: string;
    inboxItemId: string;
    temperature: 'hot' | 'warm' | 'cold';
    recommendedAction: string;
  }): Promise<Opportunity>;

  get(id: string, genomeId: string, orgId: string): Promise<Opportunity | undefined>;

  /** `engage.opportunity.route`'s write — updates `routed_to` on an existing row. */
  route(args: { id: string; genomeId: string; orgId: string; routedTo: string }): Promise<Opportunity | undefined>;
}

/**
 * SPEND — plan §9. What `policy.ts` rule 4 has always been asking about.
 *
 * Deliberately **not** on `ScopedDb`. Handlers must not be able to read or
 * write the budget: spend is decided by the policy engine before a handler
 * runs and recorded by `invokeTool` after it returns, and a tool that could
 * touch its own balance mid-flight would make both meaningless. The resolver
 * reads it into `ToolCtx.budget`; `InvokeDeps.recordCost` writes it. Two
 * places, both outside the handler.
 */
export interface CreditStore {
  /**
   * Cap and spend for the current period, in one call.
   *
   * One call rather than two accessors because they are read together on every
   * single request, and two round-trips on the hot path to compute one
   * subtraction is a cost with no benefit.
   */
  budget(orgId: string, now: Date): Promise<{ monthlyCapCents: number; spentCents: number }>;

  /**
   * Append one charge. Idempotent on `callId` — a second write for the same
   * call is silently ignored rather than raising, because the caller is
   * `invokeTool` finishing a successful call and failing it *after* the work
   * was done would be worse than a duplicate that never lands.
   */
  record(entry: {
    callId: string;
    orgId: string;
    brandId?: string;
    tool: string;
    costCents: number;
    at: Date;
  }): Promise<void>;

  /**
   * `org.credits.grant` — a manual goodwill/plan credit, never tied to a real
   * `tool_calls` row (`callId` is generated internally, not accepted from the
   * caller). Kept off `record()` on purpose: `record` is idempotent-by-replay
   * because `invokeTool` might call it twice for one real spend; a grant is a
   * one-off financial event; and this method is not exposed on `ScopedDb` —
   * only `org.credits.grant`'s factory receives it directly, the same
   * isolation `CreditStore` itself already documents for the whole interface.
   */
  grant(entry: { orgId: string; brandId?: string; amountCents: number; reason: string }): Promise<void>;
}

/** One item in the Review queue. */
export interface PendingApproval {
  id: string;
  /** The gated `tool_calls` row this is holding. */
  callId: string;
  tool: string;
  /** The original input, replayed verbatim on approve. */
  input: unknown;
  requestedAt: Date;
  ruleId?: string;
  reason?: string;
  genomeId?: string;
  requestedBy?: string;
  status?: string;
  brandId?: string;
}

/**
 * The Review queue (PRD §7.5, plan §4.4).
 *
 * Without this, `review_first_week` and `review_everything` gate calls into
 * nothing: the audit row records that a decision was held and there is no way
 * to act on it. The queue is what makes the approval ladder a product feature
 * rather than a policy outcome.
 */
export interface ApprovalStore {
  /** Called when a call is gated. Idempotent on `callId`. */
  enqueue(args: {
    callId: string;
    orgId: string;
    brandId?: string;
    tool: string;
    ruleId?: string;
    reason?: string;
  }): Promise<void>;
  pending(orgId: string, brandId: string | undefined, limit: number): Promise<PendingApproval[]>;
  /** Undefined rather than throwing when out of scope. */
  get(callId: string, orgId: string): Promise<PendingApproval | undefined>;
  /** Throws NOT_FOUND if it is not still pending — the concurrency guard. */
  resolve(callId: string, orgId: string, outcome: 'approved' | 'rejected', decidedBy: string): Promise<void>;
}

/** A campaign as stored — the outcome unit of §6.8. */
export interface CampaignRecord {
  id: string;
  genomeId: string;
  name: string;
  objective: string;
  windowDays: number;
  startAt: Date;
  status: string;
  /** The plan snapshot the owner approved. Deliberately opaque here. */
  plan: unknown;
  /**
   * §6.8 Step 1's "target & window" follow-up — free-standing, since not every
   * objective has one ("grow audience" often doesn't). Absent, not zero, when
   * nothing was stated: `campaign.report_vs_outcome` reports against volume/mix
   * honestly rather than comparing to an invented number.
   */
  targetCount?: number;
  targetLabel?: string;
  /**
   * `CMP-01.4`'s connected-account selection. Empty or absent means "wherever
   * each chosen format is meant for" — see `campaigns.platforms` in `schema.ts`
   * on the scheduler fallback this replaces.
   */
  platforms?: string[];
}

export interface CampaignSlotInput {
  playbookId: string;
  mode: string;
  pillar: string;
  scheduledAt: Date;
  /**
   * Which account this slot posts to.
   *
   * Written at placement time from the campaign's own `platforms`, rather than
   * left for the scheduler to guess from the playbook. `content_items.platform`
   * existed and nothing ever populated it, which is the entire reason
   * `apps/api/src/scheduler.ts` carried a *"falling back to the playbook's first
   * declared platform"* branch.
   */
  platform?: string;
}

/**
 * Campaign + calendar persistence (§6.8, `CMP-01.*`, `CAL-01`→`CAL-06`).
 *
 * Separate from `ScopedDb` on purpose: `ScopedDb` is the client-confidential
 * surface that `scoped.ts` fences, and a campaign is an objective over a window
 * — it holds no assets or copy. Its *slots* do, which is why `replaceSlots` and
 * `slots` take a `genomeId` and route through the scoped layer underneath.
 */
export interface CampaignStore {
  create(args: {
    orgId: string;
    genomeId: string;
    name: string;
    objective: string;
    windowDays: number;
    startAt: Date;
    plan: unknown;
    targetCount?: number;
    targetLabel?: string;
    platforms?: string[];
  }): Promise<{ id: string }>;
  /** Undefined rather than throwing when out of scope. */
  get(campaignId: string, orgId: string): Promise<CampaignRecord | undefined>;
  listForGenome(genomeId: string, orgId: string, limit: number): Promise<CampaignRecord[]>;
  /** Replaces the campaign's unpublished slots. Regeneration is the normal path. */
  replaceSlots(args: {
    campaignId: string;
    orgId: string;
    genomeId: string;
    slots: CampaignSlotInput[];
  }): Promise<number>;
  slots(
    campaignId: string,
    orgId: string,
    genomeId: string,
  ): Promise<
    Array<{
      id: string;
      playbookId: string | null;
      mode: string | null;
      pillar: string | null;
      status: string;
      scheduledAt: Date | null;
    }>
  >;
  setStatus(campaignId: string, orgId: string, status: string): Promise<void>;
}

/** One genome tracking one trend over time — `trend.watchlist`'s storage. */
export interface TrendWatchlistEntry {
  id: string;
  trendId: string;
  source: string;
  topic: string;
  note?: string;
  createdAt: Date;
}

export interface TrendWatchlistStore {
  /** Upsert by (genome, trend) — watching the same trend twice is one watch, not two. */
  add(args: { genomeId: string; orgId: string; trendId: string; source: string; topic: string; note?: string }): Promise<TrendWatchlistEntry>;
  remove(args: { genomeId: string; orgId: string; trendId: string }): Promise<void>;
  list(genomeId: string, orgId: string): Promise<TrendWatchlistEntry[]>;
}

/** One (genome, pillar) Thompson-sampling arm — `learning.*`'s storage (plan §6.7). */
export interface LearningArm {
  pillar: string;
  alpha: number;
  beta: number;
  observations: number;
  updatedAt: Date;
}

export interface LearningStore {
  list(genomeId: string, orgId: string): Promise<LearningArm[]>;
  /**
   * Records one outcome and moves its arm's Beta posterior. Idempotent on
   * `contentItemId` — a re-ingested metrics snapshot for a post already
   * scored must not move the arm twice; `recorded: false` says which
   * happened, so a caller can tell "already scored" from "just scored".
   */
  recordOutcome(args: {
    genomeId: string;
    orgId: string;
    contentItemId: string;
    pillar: string;
    reward: number;
  }): Promise<{ recorded: boolean; arm: LearningArm }>;
  /**
   * `learning.reset` — deletes every arm and outcome for this genome, back to
   * true cold start. Distinct from `genomes.patchLearned({confidence: 0, ...})`:
   * that would zero the *summary* while leaving the arms' accumulated
   * alpha/beta behind, so the very next `learning.reweight` would recompute
   * confidence right back up from data that was supposed to be gone.
   */
  reset(genomeId: string, orgId: string): Promise<void>;
}

/** One automation recipe (AutoTrend / Bulk Connector / RSS) — data-driven per CLAUDE.md invariant 5. */
export interface RecipeRecord {
  id: string;
  genomeId: string;
  kind: string;
  name: string;
  config: unknown;
  status: 'active' | 'paused';
  intervalMinutes?: number;
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeOutputRecord {
  id: string;
  recipeId: string;
  runId: string;
  genomeId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  preview: unknown;
  contentItemId?: string;
  createdAt: Date;
  decidedAt?: Date;
}

export interface RecipeStore {
  create(args: { genomeId: string; orgId: string; kind: string; name: string; config: unknown; intervalMinutes?: number }): Promise<RecipeRecord>;
  get(id: string, genomeId: string, orgId: string): Promise<RecipeRecord | undefined>;
  list(genomeId: string, orgId: string): Promise<RecipeRecord[]>;
  setStatus(args: { id: string; genomeId: string; orgId: string; status: 'active' | 'paused' }): Promise<RecipeRecord | undefined>;
  delete(id: string, genomeId: string, orgId: string): Promise<void>;
  markRan(id: string, genomeId: string, orgId: string, at: Date): Promise<void>;
  /** Every org's recipes due to run now — the scheduler's read, not genome-scoped by the caller. */
  findDue(before: Date): Promise<Array<RecipeRecord & { orgId: string }>>;
  recordRun(args: {
    genomeId: string;
    orgId: string;
    recipeId: string;
    status: 'succeeded' | 'failed';
    outputCount: number;
    error?: string;
    outputs: unknown[];
  }): Promise<{ runId: string }>;
  listOutputs(genomeId: string, orgId: string, args: { status?: string; limit: number }): Promise<RecipeOutputRecord[]>;
  decideOutput(args: {
    id: string;
    genomeId: string;
    orgId: string;
    status: 'approved' | 'rejected';
    contentItemId?: string;
  }): Promise<RecipeOutputRecord | undefined>;
}

/** One named grouping of assets — `asset.folder.create`'s row. */
export interface AssetFolderRecord {
  id: string;
  genomeId: string;
  name: string;
  createdAt: Date;
  /** How many assets are in it — `LIB-01`'s folder list shows this. Zero for a new folder. */
  assetCount: number;
}

export interface AssetFolderStore {
  create(args: { genomeId: string; orgId: string; name: string }): Promise<AssetFolderRecord>;
  list(genomeId: string, orgId: string): Promise<AssetFolderRecord[]>;
}

/** A brand's stored OAuth token for one third-party provider (Canva, or a native publishing platform). */
export interface OAuthConnectionRecord {
  id: string;
  genomeId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  connectedBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** Scopes granted at connect time, when the provider's token response reports them. Absent, not empty-array, when the provider doesn't say. */
  scopes?: string[];
  /** Human-readable "@handle" or page/channel name, when cheaply available right after token exchange. */
  accountLabel?: string;
}

export interface OAuthConnectionStore {
  get(genomeId: string, orgId: string, provider: string): Promise<OAuthConnectionRecord | undefined>;
  save(args: {
    genomeId: string;
    orgId: string;
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    connectedBy: string;
    scopes?: string[];
    accountLabel?: string;
  }): Promise<OAuthConnectionRecord>;
  remove(genomeId: string, orgId: string, provider: string): Promise<void>;
}

/** One ingested chunk of claim-grounding source text — `brand.knowledge.attach`'s storage. */
export interface KnowledgeChunk {
  id: string;
  genomeId: string;
  docId: string;
  text: string;
  citation?: unknown;
  createdAt: Date;
}

export interface KnowledgeStore {
  attach(args: { genomeId: string; orgId: string; docId: string; text: string; embedding: number[]; citation?: unknown }): Promise<KnowledgeChunk>;
  listForDoc(genomeId: string, orgId: string, docId: string): Promise<KnowledgeChunk[]>;
  /**
   * Every chunk for the genome, regardless of `docId` — `knowledge.ground_claim`'s
   * and `guard.claim_grounding`'s corpus. Without this, nothing written by
   * `brand.knowledge.attach`/`knowledge.ingest_site`/`.ingest_docs` was ever
   * actually read back by the guardrail it exists to feed — see
   * `packages/guardrails/src/gather.ts`'s own comment on that gap.
   */
  listAll(genomeId: string, orgId: string): Promise<KnowledgeChunk[]>;
}

/** Org-level config `org.governance.set`/`org.billing.plan.set`/`org.security.sso.configure` read and write (plan §12 P6). */
export interface OrgSettingsRecord {
  orgId: string;
  plan: 'starter' | 'growth' | 'agency';
  defaultApprovalMode: string;
  ssoRequired: boolean;
  monthlyCapCents: number;
  updatedAt: Date;
}

export interface OrgSettingsStore {
  /** Upsert-on-read, like `brands.get` — a missing row resolves to the schema defaults, never to "unset". */
  get(orgId: string): Promise<OrgSettingsRecord>;
  setPlan(args: { orgId: string; plan: 'starter' | 'growth' | 'agency'; monthlyCapCents: number }): Promise<OrgSettingsRecord>;
  setGovernance(args: { orgId: string; defaultApprovalMode: string }): Promise<OrgSettingsRecord>;
  setSso(args: { orgId: string; required: boolean }): Promise<OrgSettingsRecord>;
}

/** One team member's brand-level access — `team.permission.set` (plan §6.9). Clerk owns org membership; this owns which specific brands within it a member can reach. */
export interface BrandMember {
  userId: string;
  brandId: string;
  role: Role;
  createdAt: Date;
}

export interface BrandMemberStore {
  set(args: { orgId: string; brandId: string; userId: string; role: Role }): Promise<BrandMember>;
  remove(args: { orgId: string; brandId: string; userId: string }): Promise<void>;
  listForBrand(orgId: string, brandId: string): Promise<BrandMember[]>;
  listForUser(orgId: string, userId: string): Promise<BrandMember[]>;
}

/** `whitelabel.link.create`'s storage — a signed, expiring, brand-scoped public review token. */
export interface ReviewLink {
  id: string;
  token: string;
  brandId: string;
  scope: 'calendar' | 'content_item';
  targetId?: string;
  createdBy: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface ReviewLinkStore {
  create(args: {
    orgId: string;
    brandId: string;
    scope: 'calendar' | 'content_item';
    targetId?: string;
    createdBy: string;
    expiresAt: Date;
  }): Promise<ReviewLink>;
  /** Resolves a public token — no `orgId` scope, since the whole point is an unauthenticated caller presenting only the token. Undefined once expired or revoked. */
  getByToken(token: string): Promise<ReviewLink | undefined>;
  revoke(args: { orgId: string; id: string }): Promise<void>;
  listForBrand(orgId: string, brandId: string): Promise<ReviewLink[]>;
}

/** One row in the Timeline's run list. */
export interface RunSummary {
  id: string;
  agent: string;
  goal: string;
  trigger: RunTrigger;
  status: RunStatus;
  costCents: number;
  startedAt: Date;
  endedAt?: Date;
  /** Set on a delegated subagent run, pointing at the orchestrator's run. */
  parentRunId?: string;
}

/** A run plus the ordered steps that make up its timeline. */
export interface RunDetail extends RunSummary {
  tokens: { input: number; output: number };
  error?: { code: string; message: string };
  steps: Array<{
    /** Monotonic within the run — the render order, never sorted on time. */
    idx: number;
    type: StepType;
    payload: unknown;
    ms: number;
    at: Date;
  }>;
}

/* ── Guardrail identifiers (engine spec §10) ───────────────────────── */

export type GuardrailId =
  | 'claim_grounding'
  | 'compliance_profile'
  /** PRD §9's restricted topics and claims-to-avoid — see `guardrails/src/restrictedTopics.ts`. */
  | 'restricted_topics'
  | 'brand_voice'
  | 'avatar_saturation'
  | 'duplicate'
  | 'platform_policy'
  | 'rights';

/* ── The publish context the policy engine reads ────────────────────── */

/**
 * What `policy.ts` rule 7 needs to know about *this* publish, beyond the tool
 * and the brand: which platform, what kind of content, and whether it came out
 * of an automation recipe.
 *
 * ── Why the tool derives this and the caller does not ──────────────────────
 *
 * These four fields were read by the policy engine from `InvokeRequest.subject`
 * from the day rule 7 was written, and nothing ever set them. The write side
 * was complete — `approval.policy.set` persists `restrictedPlatforms`, the
 * settings panel edits it, `loadBrandGovernance` loads it — so a workspace
 * could switch on "Instagram requires review", see it saved, and publish to
 * Instagram unreviewed forever.
 *
 * The obvious repair is to have the caller pass `subject`, and it is the wrong
 * one: every rule here *adds* a restriction, so a caller that omits the field
 * is a caller that escapes the restriction. "Restrict autopublish on Instagram"
 * has to mean the restriction holds for a caller that would rather it did not.
 *
 * So the tool declares how its own input maps to this shape, and `invoke.ts`
 * computes it from *validated input* after the tool has been resolved. There is
 * no request field to omit. `guardrailFlags` stays on the request — flags
 * describe the invocation's context (untrusted content in the turn) rather than
 * the post, and can only ever escalate.
 */
export interface PolicySubject {
  platform?: string;
  contentType?: string;
  isAutomationOutput?: boolean;
  reviewBeforePublish?: boolean;
  /**
   * `policy.ts` rule 6's input — PRD §8.8's eligibility gate and autonomy
   * requirement for the `engage.*` publish family.
   *
   * Here for exactly the reason the four fields above are: it used to arrive on
   * `InvokeRequest` and was forwarded verbatim from the HTTP request body, so a
   * client could post `engagement: { eligible: true, autonomyConfigured: true }`
   * and send unattended replies for a campaign that had never published
   * anything. Unlike the fields above it failed *closed* when omitted — rule 6
   * denies without it — which is why nothing ever looked broken. Forgeable is
   * worse than broken: broken gets reported.
   *
   * Derived by the tool from the message's own campaign and the brand's stored
   * autonomy setting. There is no request field left to forge.
   */
  engagement?: { eligible: boolean; autonomyConfigured: boolean };
}

/* ── The contract ──────────────────────────────────────────────────── */

export interface ToolDef<I extends ZodTypeAny = ZodTypeAny, O extends ZodTypeAny = ZodTypeAny> {
  /** Dot-namespaced: "campaign.propose_plan". Family is the segment before the first dot. */
  name: string;
  version: number;

  /**
   * Written FOR THE MODEL. This string is prompt surface — SPARK selects tools by
   * reading it. Say what it does, when to use it, and what it costs. Keep it under
   * ~40 words and avoid implementation detail.
   */
  summary: string;

  input: I;
  /** Include a `why: Explanation` field for any user-visible agent decision. */
  output: O;

  effect: Effect;
  autonomy: Autonomy;
  scopes: Role[];

  /** Run before the handler; any block aborts the call with GUARDRAIL_BLOCKED. */
  guardrails?: GuardrailId[];

  /** Pre-flight cost estimate in cents, checked against remaining budget. */
  estimateCents?: (input: z.infer<I>) => number;

  /**
   * The publish context `policy.ts` rule 7 evaluates against brand governance —
   * see {@link PolicySubject} on why this belongs to the tool and not the caller.
   *
   * Required (by `defineTool`'s own check) on every `effect: 'publish'` tool, so
   * that adding a new publish path cannot silently opt out of platform and
   * content-type restrictions. Async and given `ctx` because some of it is a
   * fact about a stored row rather than about the input — whether a content item
   * came from a recipe, and whether that recipe asked for review — and rule 7
   * has to know before the handler runs.
   */
  policySubject?: (input: z.infer<I>, ctx: ToolCtx) => Promise<PolicySubject>;

  /** When false, callers must supply an idempotency key. */
  idempotent: boolean;

  /** PRD UI flow IDs this tool backs, e.g. ['CAL-03', 'CC-02']. Documentation only. */
  surfaces?: string[];

  handler: (input: z.infer<I>, ctx: ToolCtx) => Promise<z.infer<O>>;
}

export const defineTool = <I extends ZodTypeAny, O extends ZodTypeAny>(
  def: ToolDef<I, O>,
): ToolDef<I, O> => {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(def.name)) {
    throw new Error(`Tool name must be dot-namespaced lowercase: got "${def.name}"`);
  }
  if (def.effect === 'publish' && def.autonomy === 'human_only') {
    throw new Error(`"${def.name}": publish tools must be gateable, not human_only`);
  }
  if ((def.effect === 'spend') && !def.estimateCents) {
    throw new Error(`"${def.name}": spend tools must provide estimateCents`);
  }
  /* Rule 7's restrictions are only as good as the weakest publish tool. Making
   * this a boot-time failure rather than a review-time convention is what stops
   * the next publish path from quietly reintroducing the gap `PolicySubject`
   * documents. */
  if (def.effect === 'publish' && !def.policySubject) {
    throw new Error(
      `"${def.name}": publish tools must provide policySubject, or brand platform/content-type ` +
        `restrictions cannot be enforced against them (see PolicySubject in defineTool.ts)`,
    );
  }
  return def;
};

export const toolFamily = (name: string): string => name.split('.')[0];
