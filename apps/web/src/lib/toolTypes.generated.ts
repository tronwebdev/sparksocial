/* eslint-disable */
/**
 * GENERATED — do not edit. `npm run generate:tool-types`.
 *
 * The input and output shape of every tool in the registry, printed from its
 * Zod schemas so a caller cannot invent one. See
 * `scripts/generate-tool-types.mts` for why this is committed rather than
 * built, and why it carries no imports.
 *
 * Two things are printed as the *wire* sees them, not as the server declares
 * them: a `z.date()` is a `string` (it has been through `JSON.stringify`), and
 * a `.default()` is optional on input but guaranteed on output.
 *
 * 206 tools.
 */

export interface ToolIO {
  "agency.roster": {
    input: { windowDays?: number };
    output: { windowDays: number; brands: Array<{ genomeId: string; brandId: string; name: string; updatedAt: string; publishedCount: number; impressions: number; engagements: number; quiet: boolean }>; totals: { brands: number; quiet: number; publishedCount: number; impressions: number; engagements: number }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "agent.approval_mode.get": {
    input: Record<string, never>;
    output: { brandId: string; approvalMode: "autopublish" | "review_first_week" | "review_everything"; graduatesInDays: (number) | (null); recommended: "autopublish" | "review_first_week" | "review_everything"; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "agent.approval_mode.set": {
    input: { mode: "autopublish" | "review_first_week" | "review_everything" };
    output: { brandId: string; approvalMode: "autopublish" | "review_first_week" | "review_everything"; graduatesInDays: (number) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "agent.explain": {
    input: { callId: string };
    output: { callId: string; tool: string; at: string; caller: "user" | "agent"; decision: string; status: string; costCents: number; runId?: string; summary: string; why?: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> }; unexplained: boolean };
  };
  "agent.frequency.set": {
    input: { postsPerWeek: number };
    output: { brandId: string; postsPerWeek: number; effect: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "agent.pause": {
    input: { reason?: string };
    output: { brandId: string; paused: boolean; pausedAt?: string; pausedBy?: string; reason?: string; effect: string; postsPerWeek: number };
  };
  "agent.resume": {
    input: Record<string, never>;
    output: { brandId: string; paused: boolean; pausedAt?: string; pausedBy?: string; reason?: string; effect: string; postsPerWeek: number };
  };
  "agent.run.get": {
    input: { runId: string };
    output: { runId: string; agent: string; goal: string; trigger: "user" | "schedule" | "event"; status: "running" | "succeeded" | "failed" | "cancelled"; costCents: number; startedAt: string; endedAt?: string; parentRunId?: string; durationMs: (number) | (null); tokens: { input: number; output: number }; error?: { code: string; message: string }; steps: Array<{ idx: number; type: "think" | "tool" | "delegate" | "wait"; payload: unknown; ms: number; at: string }> };
  };
  "agent.run.list": {
    input: { limit?: number };
    output: { runs: Array<{ runId: string; agent: string; goal: string; trigger: "user" | "schedule" | "event"; status: "running" | "succeeded" | "failed" | "cancelled"; costCents: number; startedAt: string; endedAt?: string; parentRunId?: string; durationMs: (number) | (null) }> };
  };
  "agent.status": {
    input: Record<string, never>;
    output: { brandId: string; paused: boolean; pausedAt?: string; pausedBy?: string; reason?: string; effect: string; postsPerWeek: number };
  };
  "analytics.brand_series": {
    input: { genomeId: string; windowDays?: number };
    output: { windowDays: number; basis: "publication_date"; days: Array<{ date: string; posts: number; impressions: number; engagements: number; views: number; likes: number; comments: number; shares: number; saves: number }>; totals: { posts: number; impressions: number; views: number; engagements: number; likes: number; comments: number; shares: number; saves: number }; previous: { posts: number; impressions: number; views: number; engagements: number; likes: number; comments: number; shares: number; saves: number }; changePct: { impressions: (number) | (null); engagements: (number) | (null); views: (number) | (null); likes: (number) | (null); comments: (number) | (null); shares: (number) | (null); saves: (number) | (null) }; byPlatform: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; impressions: number; share: number }>; maturing: number; unmeasured: number };
  };
  "analytics.campaign_report": {
    input: { campaignId: string };
    output: { campaignId: string; postsWithMetrics: number; totals: { likes: number; comments: number; shares: number; views: number; impressions: number }; byPlatform: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; likes: number; comments: number; shares: number; views: number; impressions: number }>; topPosts: Array<{ contentItemId: string; engagement: number }> };
  };
  "analytics.cta_traffic": {
    input: { genomeId: string; contentItemId: string };
    output: { contentItemId: string; links: Array<{ shortUrl: string; destinationUrl: string; clicks: number }>; totalClicks: number };
  };
  "analytics.post_metrics": {
    input: { genomeId: string; contentItemId: string };
    output: { contentItemId: string; synced: boolean; platforms: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; likes: number; comments: number; shares: number; views: number; impressions: number; saves: number; syncedAt: string }>; totals: { likes: number; comments: number; shares: number; views: number; impressions: number; saves: number } };
  };
  "analytics.success_metrics": {
    input: { genomeId: string; windowDays?: number };
    output: { windowDays: number; since: string; activation: { connectedAccounts: number; onboardingComplete: boolean; campaignActivated: boolean; hoursToFirstPost: (number) | (null) }; production: { postsPublishedPerWeek: number; draftsPerPublishedPost: (number) | (null); postsWithTrackedLink: number }; discovery: { trendToPostRate: (number) | (null); postsFromTrends: number; repurposeUsageRate: (number) | (null) }; automation: { recipeCount: number; outputApprovalRate: (number) | (null) }; engagement: { replySlaHours: (number) | (null); messagesResolvedRate: (number) | (null); salesOpportunitiesPerWeek: number; nextActionTakenRate: (number) | (null) }; trust: { preventedRate: (number) | (null); publishAttempts: number; blockedOrHeld: number; incidents: number; awaitingReview: number }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "analytics.sync": {
    input: { genomeId: string; contentItemId: string };
    output: { contentItemId: string; platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; likes: number; comments: number; shares: number; views: number; impressions: number; saves: number; syncedAt: string };
  };
  "approval.decide": {
    input: { callId: string; decision: "approve" | "reject"; note?: string };
    output: { callId: string; decision: "approve" | "reject"; executed?: { status: "succeeded" | "gated" | "failed"; newCallId?: string; error?: string } };
  };
  "approval.policy.get": {
    input: Record<string, never>;
    output: { brandId: string; familyOverrides: (Record<string, "auto" | "confirm" | "approval" | "human_only">) | (null); restrictedPlatforms: (Array<string>) | (null); restrictedContentTypes: (Array<string>) | (null); quietWindows: (Array<{ from: string; to: string; reason: string }>) | (null); permissions: ({ spendCredits?: boolean; automationAutoPublish?: boolean; requireApprovalForMedia?: boolean }) | (null); publishRoles: (Array<"owner" | "admin" | "editor" | "approver" | "viewer" | "client">) | (null); maxPendingReview: (number) | (null) };
  };
  "approval.policy.set": {
    input: { familyOverrides?: Record<string, "auto" | "confirm" | "approval" | "human_only">; restrictedPlatforms?: Array<string>; restrictedContentTypes?: Array<string>; publishRoles?: Array<"owner" | "admin" | "editor" | "approver" | "viewer" | "client">; maxPendingReview?: number; quietWindows?: Array<{ from: string; to: string; reason: string }>; permissions?: { spendCredits?: boolean; automationAutoPublish?: boolean; requireApprovalForMedia?: boolean } };
    output: { brandId: string; policy: { brandId: string; familyOverrides: (Record<string, "auto" | "confirm" | "approval" | "human_only">) | (null); restrictedPlatforms: (Array<string>) | (null); restrictedContentTypes: (Array<string>) | (null); quietWindows: (Array<{ from: string; to: string; reason: string }>) | (null); permissions: ({ spendCredits?: boolean; automationAutoPublish?: boolean; requireApprovalForMedia?: boolean }) | (null); publishRoles: (Array<"owner" | "admin" | "editor" | "approver" | "viewer" | "client">) | (null); maxPendingReview: (number) | (null) }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "approval.rule.delete": {
    input: { id: string };
    output: { deleted: boolean };
  };
  "approval.rule.list": {
    input: Record<string, never>;
    output: { rules: Array<{ id: string; trigger: "publish" | "spend_over"; thresholdCents?: number; requiresRole: "owner" | "admin" | "editor" | "approver"; groupIds: Array<string>; groupNames: Array<string>; enabled: boolean; label: string; appliesTo: string }> };
  };
  "approval.rule.set": {
    input: { id?: string; trigger: "publish" | "spend_over"; thresholdCents?: number; requiresRole: "owner" | "admin" | "editor" | "approver"; groupIds?: Array<string>; enabled?: boolean };
    output: { rule: { id: string; trigger: "publish" | "spend_over"; thresholdCents?: number; requiresRole: "owner" | "admin" | "editor" | "approver"; groupIds: Array<string>; groupNames: Array<string>; enabled: boolean; label: string; appliesTo: string }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "assemble.plan": {
    input: { genomeId: string; playbookId: string; intent?: string };
    output: { plan: { playbookId: string; genomeId: string; mediaType: "video" | "image" | "carousel" | "text"; aspectRatios: Array<string>; beats: Array<({ kind: "asset"; beatId: string; durationSec: number; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; assetId: string; caption: (string) | (null); score: number }) | ({ kind: "copy"; beatId: string; durationSec: number; promptRef: string }) | ({ kind: "text"; beatId: string; durationSec: number; text: string; genomePath: string })>; totalDurationSec: number }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "asset.archive": {
    input: { genomeId: string; assetId: string; archived?: boolean };
    output: { assetId: string; archived: boolean; archivedAt?: string };
  };
  "asset.caption.set": {
    input: { genomeId: string; assetId: string; caption: string };
    output: { assetId: string; caption: string };
  };
  "asset.cooldown.check": {
    input: { genomeId: string; assetIds: Array<string>; cooldownDays?: number };
    output: { results: Array<{ assetId: string; inCooldown: boolean; lastUsedDaysAgo?: number; found: boolean }>; cooldownDays: number };
  };
  "asset.folder.create": {
    input: { genomeId: string; name: string };
    output: { folderId: string; name: string };
  };
  "asset.folder.delete": {
    input: { genomeId: string; folderId: string };
    output: { folderId: string; unfiled: number };
  };
  "asset.folder.list": {
    input: { genomeId: string };
    output: { folders: Array<{ folderId: string; name: string; createdAt: string; assetCount: number }> };
  };
  "asset.folder.member.set": {
    input: { genomeId: string; folderId: string; userIds: Array<string> };
    output: { folderId: string; userIds: Array<string> };
  };
  "asset.folder.members": {
    input: { genomeId: string; folderId: string };
    output: { members: Array<{ userId: string; assignedBy: string; assignedAt: string }> };
  };
  "asset.folder.move": {
    input: { genomeId: string; assetId: string; folderId: (string) | (null) };
    output: { assetId: string; folderId: (string) | (null) };
  };
  "asset.folder.rename": {
    input: { genomeId: string; folderId: string; name: string };
    output: { folderId: string; name: string };
  };
  "asset.gaps": {
    input: { genomeId: string; horizonDays?: number };
    output: { genomeId: string; gaps: Array<{ missingRole: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; playbooksBlocked: Array<string>; impact: string; unlockedBy: "upload" | "capture"; suggestedBriefId: (string) | (null) }>; producibleNow: number; producibleIfFilmed: number; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "asset.ingest_url": {
    input: { genomeId: string; url: string; assetRole: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; mediaType: "image" | "video" | "audio" | "document"; rightsStatus?: "cleared" | "pending" | "restricted"; source?: string; filename?: string; sizeBytes?: number };
    output: { assetId: string; caption: string; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "asset"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "asset.retrieve": {
    input: { genomeId: string; intent: string; requiredRoles?: Array<"talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit">; constraints?: { minResolution?: string; pairable?: boolean }; k?: number; offset?: number };
    output: { results: Array<{ assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null); embeddingScore: number; usageCount: number; lastUsedAt: (string) | (null); rightsStatus: "cleared" | "pending" | "restricted"; folderId: (string) | (null); url: string; mediaType: "image" | "video" | "audio" | "document"; filename: (string) | (null); sizeBytes: (number) | (null); createdAt: string }>; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "asset"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "asset.reuse": {
    input: { genomeId: string; assetId: string };
    output: { assetId: string; usageCount: number; lastUsedAt: (string) | (null) };
  };
  "asset.rights.pending": {
    input: { genomeId: string };
    output: { assets: Array<{ assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; rightsStatus: "cleared" | "pending" | "restricted"; caption: (string) | (null); url: string; mediaType: "image" | "video" | "audio" | "document"; folderId: (string) | (null); filename: (string) | (null); sizeBytes: (number) | (null); createdAt: string }> };
  };
  "asset.rights.set": {
    input: { genomeId: string; assetId: string; rightsStatus: "cleared" | "pending" | "restricted" };
    output: { assetId: string; rightsStatus: "cleared" | "pending" | "restricted" };
  };
  "asset.unfiled": {
    input: { genomeId: string };
    output: { assets: Array<{ assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; rightsStatus: "cleared" | "pending" | "restricted"; caption: (string) | (null); url: string; mediaType: "image" | "video" | "audio" | "document"; folderId: (string) | (null); filename: (string) | (null); sizeBytes: (number) | (null); createdAt: string }> };
  };
  "asset.upload_url": {
    input: { genomeId: string; filename: string; contentType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "video/mp4" | "video/quicktime" | "video/webm" | "audio/mpeg" | "audio/mp4" | "audio/wav" | "application/pdf"; sizeBytes: number };
    output: { uploadUrl: string; readUrl: string; key: string; expiresAt: string };
  };
  "brand.create": {
    input: { name: string; category: string; oneLiner?: string; locale?: string };
    output: { brandId: string; genomeId: string; name: string };
  };
  "brand.engagement.platforms.get": {
    input: { brandId?: string };
    output: { brandId: string; brandAutonomy: "off" | "suggest" | "auto"; brandEngagementTypes: Array<string>; platforms: Array<{ platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; autonomy: "off" | "suggest" | "auto"; engagementTypes: Array<string>; enabled: boolean; inherited: boolean; autonomyInherited: boolean; typesInherited: boolean }> };
  };
  "brand.engagement.platforms.set": {
    input: { brandId?: string; platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; autonomy?: "off" | "suggest" | "auto"; engagementTypes?: Array<"comment" | "dm" | "story_reply">; enabled?: boolean; clear?: boolean };
    output: { brandId: string; platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; cleared: boolean; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "brand.export": {
    input: { genomeId: string };
    output: { data: { name: string; identity: Record<string, unknown>; dimensions: Record<string, unknown>; voice: Record<string, unknown>; offer: Record<string, unknown>; constraints: Record<string, unknown> } };
  };
  "brand.governance.get": {
    input: { brandId?: string };
    output: { brandId: string; restrictedTopics: Array<string>; claimsToAvoid: Array<string>; strictMode: boolean; toneVector?: { formal: number; playful: number; technical: number; bold: number }; bannedPhrases: Array<string>; watermark: { enabled: boolean; opacity: number; scale: number }; usingDefaultWatermark: boolean; kitTemplates: Array<{ id: string; category: "intro" | "outro" | "bumper" | "caption" | "lower_third"; name: string; text: string }>; stockVoiceId: string; usingDefaultVoice: boolean; hardRules: Array<"never_discuss_pricing" | "never_promise_results" | "never_auto_reply_to_complaints" | "never_argue" | "never_discuss_legal_or_medical">; escalationBehavior: "hold" | "notify" | "draft_no_send"; engagementTone?: { casual: number; friendly: number; warm: number }; emojiLevel: "none" | "light" | "expressive"; engagementConfiguredAt?: string; logoUrl?: string; brandColors: Array<string>; brandFonts?: { display?: string; body?: string }; timezone: string; postingWindows: Array<number>; usingDefaultWindows: boolean; engagementAutonomy: "off" | "suggest" | "auto"; engagementTypes: Array<string>; agentIdentity: { name: string; named: boolean; voice: Array<string>; riskTolerance: "Low" | "Moderate" | "High"; riskBecause: string }; salesQualification: Array<string>; salesHandoff: { hot: "crm_notify" | "save_notify" | "nurture_only"; warm: "crm_notify" | "save_notify" | "nurture_only"; cold: "crm_notify" | "save_notify" | "nurture_only" }; usingDefaultHandoff: boolean; salesDestination?: string; salesEscalationKeywords: Array<string>; brandKit: { steps: Array<{ id: string; label: string; done: boolean; because: string }>; completed: number; total: number; pct: number; next?: { id: string; label: string; done: boolean; because: string } }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "brand.governance.set": {
    input: { brandId?: string; restrictedTopics?: Array<string>; claimsToAvoid?: Array<string>; strictMode?: boolean; toneVector?: { formal: number; playful: number; technical: number; bold: number }; bannedPhrases?: Array<string>; watermark?: { enabled?: boolean; opacity?: number; scale?: number }; stockVoiceId?: string; hardRules?: Array<"never_discuss_pricing" | "never_promise_results" | "never_auto_reply_to_complaints" | "never_argue" | "never_discuss_legal_or_medical">; escalationBehavior?: "hold" | "notify" | "draft_no_send"; engagementTone?: { casual: number; friendly: number; warm: number }; emojiLevel?: "none" | "light" | "expressive"; engagementConfigured?: boolean; kitTemplates?: Array<{ id: string; category: "intro" | "outro" | "bumper" | "caption" | "lower_third"; name: string; text: string }>; logoUrl?: string; brandColors?: Array<string>; brandFonts?: { display?: "inter" | "dm_sans" | "space_grotesk" | "playfair" | "lora" | "oswald"; body?: "inter" | "dm_sans" | "space_grotesk" | "playfair" | "lora" | "oswald" }; timezone?: string; postingWindows?: Array<number>; engagementAutonomy?: "off" | "suggest" | "auto"; engagementTypes?: Array<"comment" | "dm" | "story_reply">; agentName?: string; salesQualification?: Array<"ask_qualifying_questions" | "share_booking_link" | "share_pricing_link" | "collect_contact_details">; salesHandoff?: { hot: "crm_notify" | "save_notify" | "nurture_only"; warm: "crm_notify" | "save_notify" | "nurture_only"; cold: "crm_notify" | "save_notify" | "nurture_only" }; salesDestination?: string; salesEscalationKeywords?: Array<string> };
    output: { brandId: string; restrictedTopics: Array<string>; claimsToAvoid: Array<string>; strictMode: boolean; toneVector?: { formal: number; playful: number; technical: number; bold: number }; bannedPhrases: Array<string>; watermark: { enabled: boolean; opacity: number; scale: number }; usingDefaultWatermark: boolean; kitTemplates: Array<{ id: string; category: "intro" | "outro" | "bumper" | "caption" | "lower_third"; name: string; text: string }>; stockVoiceId: string; usingDefaultVoice: boolean; hardRules: Array<"never_discuss_pricing" | "never_promise_results" | "never_auto_reply_to_complaints" | "never_argue" | "never_discuss_legal_or_medical">; escalationBehavior: "hold" | "notify" | "draft_no_send"; engagementTone?: { casual: number; friendly: number; warm: number }; emojiLevel: "none" | "light" | "expressive"; engagementConfiguredAt?: string; logoUrl?: string; brandColors: Array<string>; brandFonts?: { display?: string; body?: string }; timezone: string; postingWindows: Array<number>; usingDefaultWindows: boolean; engagementAutonomy: "off" | "suggest" | "auto"; engagementTypes: Array<string>; agentIdentity: { name: string; named: boolean; voice: Array<string>; riskTolerance: "Low" | "Moderate" | "High"; riskBecause: string }; salesQualification: Array<string>; salesHandoff: { hot: "crm_notify" | "save_notify" | "nurture_only"; warm: "crm_notify" | "save_notify" | "nurture_only"; cold: "crm_notify" | "save_notify" | "nurture_only" }; usingDefaultHandoff: boolean; salesDestination?: string; salesEscalationKeywords: Array<string>; brandKit: { steps: Array<{ id: string; label: string; done: boolean; because: string }>; completed: number; total: number; pct: number; next?: { id: string; label: string; done: boolean; because: string } }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "brand.import": {
    input: { name?: string; data: { name: string; identity: Record<string, unknown>; dimensions: Record<string, unknown>; voice: Record<string, unknown>; offer: Record<string, unknown>; constraints: Record<string, unknown> } };
    output: { brandId: string; genomeId: string; name: string };
  };
  "brand.knowledge.attach": {
    input: { genomeId: string; docId: string; text: string; citationLabel?: string };
    output: { id: string; docId: string };
  };
  "brand.knowledge.attach_document": {
    input: { genomeId: string; url: string; filename: string };
    output: { docId: string; pages: number; chunks: number; characters: number };
  };
  "brand.logo.generate": {
    input: { brandId?: string; hint?: string };
    output: { brandId: string; logoUrl: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "brand.oauth.connect": {
    input: { genomeId: string; provider: "canva" };
    output: { authorizeUrl: string };
  };
  "brand.oauth.disconnect": {
    input: { genomeId: string; provider: "canva" | "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts" };
    output: { removed: boolean };
  };
  "brand.oauth.status": {
    input: { genomeId: string; provider: "canva" | "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts" };
    output: { connected: boolean; connectedBy?: string; connectedAt?: string };
  };
  "brand.settings.patch": {
    input: { brandId: string; name: string };
    output: { brandId: string; name: string };
  };
  "calendar.generate": {
    input: { campaignId: string; mixOverride?: Record<"educational" | "product" | "proof" | "personality" | "community", number> };
    output: { campaignId: string; slotCount: number; slots: Array<{ scheduledAt: string; pillar: "educational" | "product" | "proof" | "personality" | "community"; playbookId: string; playbookName: string; mode: "synthesize" | "assemble" | "direct_finish" }>; unfilledPillars: Array<{ pillar: "educational" | "product" | "proof" | "personality" | "community"; count: number }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "calendar.get": {
    input: { campaignId: string };
    output: { campaignId: string; name: string; objective: string; status: string; mixActual: Array<{ pillar: string; count: number }>; slots: Array<{ id: string; scheduledAt: (string) | (null); pillar: (string) | (null); playbookId: (string) | (null); playbookName: (string) | (null); mode: (string) | (null); status: string; platform: ("instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky") | (null); mediaType: (string) | (null) }> };
  };
  "calendar.impact_preview": {
    input: { campaignId: string; mixOverride?: Record<"educational" | "product" | "proof" | "personality" | "community", number> };
    output: { campaignId: string; currentSlotCount: number; proposedSlotCount: number; mixBefore: Array<{ pillar: string; count: number }>; mixAfter: Array<{ pillar: string; count: number }>; unfilledPillars: Array<{ pillar: "educational" | "product" | "proof" | "personality" | "community"; count: number }>; wouldChange: boolean; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "calendar.recommend_slot": {
    input: { campaignId: string; date: string; excludePlaybookIds?: Array<string>; excludeContentItemIds?: Array<string> };
    output: { date: string; create?: { playbookId: string; playbookName: string; description: string; mediaType: string; mode: string; platforms: Array<"instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky">; pillar: string; goal: string; cta?: string; designedTo: Array<string>; readiness: "ready" | "needs_upload" | "needs_capture"; missingRoles: Array<string>; alternativesLeft: number; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } }; move?: { contentItemId: string; playbookName: string; pillar: string; currentlyAt: string; platform?: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; alternativesLeft: number; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } }; note?: string };
  };
  "campaign.create": {
    input: { genomeId: string; name: string; objective: "leads" | "bookings" | "trials" | "sales" | "audience" | "hiring"; windowDays?: number; startAt?: string; targetCount?: number; targetLabel?: string; platforms?: Array<"instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky">; approvalMode?: "autopublish" | "review_first_week" | "review_everything"; campaignType?: "promotion" | "lead_magnet" | "authority" | "launch"; primaryCta?: string; weight?: "dominant" | "balanced" | "light"; engagementRung?: "observe" | "suggest" | "auto_reply" | "sales_assist"; learnFromPerformance?: boolean; adjustMixAutomatically?: boolean };
    output: { campaignId: string; name: string; objective: "leads" | "bookings" | "trials" | "sales" | "audience" | "hiring"; windowDays: number; startAt: string; targetCount?: number; targetLabel?: string; approvalMode?: "autopublish" | "review_first_week" | "review_everything" };
  };
  "campaign.duplicate": {
    input: { genomeId: string; campaignId: string; name?: string; startAt?: string };
    output: { campaignId: string; name: string; objective: string; windowDays: number; startAt: string };
  };
  "campaign.list": {
    input: { genomeId: string; limit?: number };
    output: { campaigns: Array<{ campaignId: string; name: string; objective: string; windowDays: number; startAt: string; status: string }> };
  };
  "campaign.pause": {
    input: { campaignId: string };
    output: { campaignId: string; status: string };
  };
  "campaign.propose_plan": {
    input: { genomeId: string; objective: "leads" | "bookings" | "trials" | "sales" | "audience" | "hiring"; windowDays?: number };
    output: { objective: "leads" | "bookings" | "trials" | "sales" | "audience" | "hiring"; windowDays: number; buildableNow: number; potentialWithCapture: number; mix: Array<{ pillar: "educational" | "product" | "proof" | "personality" | "community"; count: number }>; mixSource: "cold_start" | "learned"; capture: ({ playbookIds: Array<string>; missingRoles: Array<string>; sittings: number; minutesPerSitting: number }) | (null); readyPlaybookIds: Array<string>; answers: ({ missingPaths: Array<string>; missing: Array<{ path: string; label: string; hint: string; fixWith: string }>; unlocksPosts: number; blockedPlaybooks: number }) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "campaign.rename": {
    input: { campaignId: string; name: string };
    output: { campaignId: string; name: string };
  };
  "campaign.report_vs_outcome": {
    input: { campaignId: string };
    output: { campaignId: string; objective: string; windowDays: number; daysElapsed: number; daysRemaining: number; target: ({ count: number; label: string }) | (null); targetStatus: "no_target" | "not_measurable"; volume: { planned: number; published: number; scheduledRemaining: number }; mix: Array<{ pillar: "educational" | "product" | "proof" | "personality" | "community"; planned: number; actual: number; ratio: (number) | (null) }>; engagement: { postsWithMetrics: number; likes: number; comments: number; shares: number; views: number; impressions: number }; reweightSuggestion: ({ overDelivered: (string) | (null); underDelivered: (string) | (null); detail: string }) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "campaign.resume": {
    input: { campaignId: string };
    output: { campaignId: string; status: string };
  };
  "compose.fanout": {
    input: { genomeId: string; contentItemId: string; brandTemplateId: string; data: Record<string, ({ type: "text"; text: string }) | ({ type: "image"; assetId: string })>; formats?: Array<"png" | "jpg" | "pdf"> };
    output: { contentItemId: string; designId: string; editUrl?: string; renders: Array<{ format: string; url: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "compose.render": {
    input: { genomeId: string; contentItemId: string };
    output: { contentItemId: string; mediaType: "video" | "image" | "carousel" | "text"; renders: Array<{ aspect: string; url: string; beatId?: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "compose.static": {
    input: { genomeId: string; contentItemId: string };
    output: { contentItemId: string; mediaType: "image" | "carousel"; renders: Array<{ aspect: string; url: string; beatId?: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.beat.update": {
    input: { contentItemId: string; genomeId: string; beatId: string; text: string };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })> };
  };
  "content.draft": {
    input: { genomeId: string; playbookId: string; contentItemId?: string; intent?: string; fromTrendId?: string; discardSceneEdits?: boolean };
    output: { contentItemId: string; playbookId: string; mode: "synthesize" | "assemble"; mediaType: "video" | "image" | "carousel" | "text"; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.generate_avatar_video": {
    input: { contentItemId: string; genomeId: string; beatId: string; script: string; aspectRatio?: string };
    output: { contentItemId: string; beatId: string; url: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.generate_broll": {
    input: { contentItemId: string; genomeId: string; beatId: string; prompt: string; aspectRatio?: string; durationSec?: number };
    output: { contentItemId: string; beatId: string; url: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.generate_dub": {
    input: { contentItemId: string; genomeId: string; beatId: string; sourceUrl: string; mediaType: "video" | "audio"; targetLanguage: string };
    output: { contentItemId: string; beatId: string; url: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.generate_image": {
    input: { contentItemId: string; genomeId: string; beatId: string; prompt: string; aspectRatio?: string };
    output: { contentItemId: string; beatId: string; url: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.generate_voiceover": {
    input: { contentItemId: string; genomeId: string; beatId: string; script: string; useClonedVoice?: boolean };
    output: { contentItemId: string; beatId: string; url: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.get": {
    input: { contentItemId: string; genomeId: string };
    output: { contentItemId: string; playbookId: string; playbookMissing: boolean; mode: string; mediaType: "video" | "image" | "carousel" | "text"; status: string; campaignId?: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; durationBand?: [number, number]; why?: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> }; platform?: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; externalId?: string; via?: string; url?: string; blockedReason?: string; publishAttempts: number; lastPublishError?: string; variantGroupId?: string; variantLabel?: string };
  };
  "content.list": {
    input: { genomeId: string; status?: string; limit?: number };
    output: { items: Array<{ contentItemId: string; playbookId: string; playbookName: string; mediaType?: "video" | "image" | "carousel" | "text"; platform?: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; status: string; summary: string; scheduledAt?: string; createdAt: string; variantGroupId?: string; variantLabel?: string; blockedReason?: string; publishAttempts?: number }> };
  };
  "content.scene.insert": {
    input: { contentItemId: string; genomeId: string; afterBeatId?: string; description: string; durationSec: number; label?: string };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; totalDurationSec: number; durationBand?: [number, number]; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.scene.lower_third": {
    input: { contentItemId: string; genomeId: string; beatId: string; text: (string) | (null) };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; totalDurationSec: number; durationBand?: [number, number]; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.scene.remove": {
    input: { contentItemId: string; genomeId: string; beatId: string };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; totalDurationSec: number; durationBand?: [number, number]; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.scene.reorder": {
    input: { contentItemId: string; genomeId: string; beatId: string; toIndex: number };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; totalDurationSec: number; durationBand?: [number, number]; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.scene.retime": {
    input: { contentItemId: string; genomeId: string; beatId: string; durationSec: number };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; totalDurationSec: number; durationBand?: [number, number]; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.scene.voice": {
    input: { contentItemId: string; genomeId: string; beatId: string; voice: "brand" | "stock" | "default" };
    output: { contentItemId: string; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; totalDurationSec: number; durationBand?: [number, number]; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.schedule": {
    input: { contentItemId: string; genomeId: string; scheduledAt: string; publishImmediatelyIfPast?: boolean };
    output: { contentItemId: string; status: string; scheduledAt: string };
  };
  "content.variant.result": {
    input: { genomeId: string; variantGroupId: string };
    output: { variantGroupId: string; arms: Array<{ contentItemId: string; label: string; status: string; impressions: number; engagements: number; engagementRate: (number) | (null) }>; winner: (string) | (null); undecidedBecause: ("awaiting_publish" | "awaiting_metrics" | "too_close") | (null); winnerContentItemId: (string) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "content.variant.split": {
    input: { genomeId: string; contentItemId: string; variantBeats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })> };
    output: { variantGroupId: string; arms: Array<{ contentItemId: string; label: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "direct.brief.generate": {
    input: { genomeId: string; playbookId: string };
    output: { brief: { brief_id: string; playbook_id: string; subject: string; framing: string; orientation: "vertical" | "horizontal" | "square"; duration_sec: number; motion: string; audio: string; lighting: string; do_not: Array<string>; estimated_effort_sec: number; expires_at: string }; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "direct.fallback.degrade": {
    input: { genomeId: string; missedPlaybookId: string };
    output: { substitute: ({ playbookId: string; name: string; mode: "synthesize" | "assemble" | "direct_finish"; score: number }) | (null); missedPlaybookId: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "direct.media.ingest": {
    input: { genomeId: string; briefId: string; mediaUrl: string; aspects: Array<"9:16" | "1:1" | "16:9">; captions?: Array<{ text: string; startSec: number; endSec: number }>; hook: { text: string; fontFile: string; colorHex: string; durationSec?: number }; music?: { trackPath: string; volumeDb: number } };
    output: ({ status: "finished"; assetIds: Record<"9:16" | "1:1" | "16:9", string>; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } }) | ({ status: "reshoot_requested"; reasons: Array<string>; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } });
  };
  "direct.session.batch": {
    input: { genomeId: string };
    output: { genomeId: string; briefs: Array<{ brief_id: string; playbook_id: string; subject: string; framing: string; orientation: "vertical" | "horizontal" | "square"; duration_sec: number; motion: string; audio: string; lighting: string; do_not: Array<string>; estimated_effort_sec: number; expires_at: string }>; totalEffortSec: number; deferred: Array<string>; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "direct.session.send": {
    input: { genomeId: string; to: string; briefs: Array<{ brief_id: string; playbook_id: string; subject: string; framing: string; orientation: "vertical" | "horizontal" | "square"; duration_sec: number; motion: string; audio: string; lighting: string; do_not: Array<string>; estimated_effort_sec: number; expires_at: string }>; totalEffortSec: number };
    output: { messageId: string; channel: string; toRedacted: string; briefCount: number };
  };
  "draft.repurpose": {
    input: { genomeId: string; sourceContentItemId: string; targetPlaybookId: string; intent?: string };
    output: { contentItemId: string; sourceContentItemId: string; playbookId: string; mode: "synthesize" | "assemble"; mediaType: "video" | "image" | "carousel" | "text"; beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "draft.variants": {
    input: { genomeId: string; contentItemId: string; count?: number };
    output: { contentItemId: string; variants: Array<{ beats: Array<({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "asset"; assetId: string; role: "talent_likeness" | "product_screen" | "work_artifact" | "physical_capture" | "product_shot" | "social_proof" | "knowledge" | "past_post" | "brand_kit"; caption: (string) | (null) }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "text"; text: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_image"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_video"; url: string; script: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_broll"; url: string; prompt: string }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "dubbed_media"; url: string; targetLanguage: string; mediaType: "video" | "audio" }) | ({ beatId: string; durationSec?: number; label?: string; voice?: "brand" | "stock"; lowerThird?: string; kind: "generated_audio"; url: string; script: string })> }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.audit.query": {
    input: { genomeId: string; since?: string; until?: string; limit?: number };
    output: { items: Array<{ id: string; platform: string; kind: string; authorHandle: string; authorName?: string; text: string; receivedAt: string; status: string; category?: string; intentScore?: number; suggestedReply?: string; why?: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } }> };
  };
  "engage.autohandle": {
    input: { genomeId: string; messageId: string };
    output: { messageId: string; status: string; externalId: string; via: string; sentAt: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.classify": {
    input: { genomeId: string; messageId: string };
    output: { messageId: string; category: "needs_review" | "suggested_reply" | "auto_handled" | "sales_opportunity"; intentScore: number; suggestedReply?: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.eligibility.check": {
    input: { genomeId: string; campaignId: string };
    output: { eligible: boolean; daysSinceStart: number; publishedCount: number; reason: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.escalate": {
    input: { genomeId: string; messageId: string; reason: string };
    output: { messageId: string; status: string; notified: boolean; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.ingest": {
    input: { genomeId: string; platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; externalId: string; kind: "comment" | "dm" | "story_reply"; authorHandle: string; authorName?: string; text: string; contentItemId?: string; receivedAt?: string; threadKey?: string };
    output: { id: string; status: string };
  };
  "engage.list": {
    input: { genomeId: string; status?: string; category?: "needs_review" | "suggested_reply" | "auto_handled" | "sales_opportunity"; limit?: number };
    output: { items: Array<{ id: string; platform: string; kind: string; authorHandle: string; authorName?: string; text: string; receivedAt: string; status: string; category?: string; intentScore?: number; suggestedReply?: string; why?: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } }> };
  };
  "engage.opportunity.create": {
    input: { genomeId: string; messageId: string; temperature: "hot" | "warm" | "cold"; recommendedAction: string };
    output: { opportunityId: string; messageId: string; temperature: "hot" | "warm" | "cold"; recommendedAction: string; routedTo?: string; handoff: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.opportunity.list": {
    input: { genomeId: string; limit?: number; temperature?: "hot" | "warm" | "cold" };
    output: { items: Array<{ opportunityId: string; messageId: string; temperature: "hot" | "warm" | "cold"; recommendedAction: string; routedTo?: string; raisedAt: string; platform?: string; authorHandle?: string; authorName?: string; messageText?: string; intentScore?: number; receivedAt?: string }>; counts: { hot: number; warm: number; cold: number } };
  };
  "engage.opportunity.route": {
    input: { genomeId: string; opportunityId: string; routedTo: string };
    output: { opportunityId: string; routedTo: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.reply.draft": {
    input: { genomeId: string; messageId: string; regenerate?: boolean };
    output: { messageId: string; text: string; source: "suggested" | "generated"; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.reply.send": {
    input: { genomeId: string; messageId: string; text: string };
    output: { messageId: string; status: string; externalId: string; via: string; sentAt: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.takeover": {
    input: { genomeId: string; messageId: string };
    output: { messageId: string; status: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "engage.thread": {
    input: { genomeId: string; messageId: string; limit?: number };
    output: { threadKey: string; platform: string; kind: string; authorHandle: string; authorName?: string; turns: Array<{ direction: "inbound" | "outbound"; at: string; text: string; authorHandle?: string; authorName?: string; messageId: string; category?: string; intentScore?: number; status?: string }>; messageCount: number; truncated: boolean; single: boolean; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "genome.avatar_config.set": {
    input: { genomeId: string; heygenAvatarId?: string; elevenlabsVoiceId?: string };
    output: { genomeId: string; version: number; heygenAvatarId?: string; elevenlabsVoiceId?: string };
  };
  "genome.avatar_override.set": {
    input: { genomeId: string; enabled: boolean; reason?: string };
    output: { genomeId: string; version: number; avatarEnabled: boolean; override: ({ reason: string; setBy: string; setAt: string }) | (null); why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "genome.bootstrap_from_url": {
    input: { url: string; brandId: string; maxPages?: number };
    output: { draftGenomeId: string; identity: { businessName: string; category: string; subCategory?: string; oneLiner: string; geography: { scope: "global" | "national" | "local"; locale: string; radiusKm: (number) | (null) }; languages: Array<string>; priceTier: "budget" | "mid" | "premium" | "enterprise" }; dimensions: { proof_asset?: Array<"person" | "product_ui" | "physical_craft" | "finished_work" | "physical_product" | "data_outcomes">; capture_capability?: Array<"screen" | "space" | "work_artifacts" | "product" | "nothing">; objective?: "leads" | "bookings" | "trials" | "sales" | "audience" | "hiring"; secondary_objectives?: Array<"leads" | "bookings" | "trials" | "sales" | "audience" | "hiring">; talent_availability?: "yes_licensed" | "yes_unlicensed" | "no" }; chips: Array<{ field: string; value: string; confidence: number; editable: boolean }>; unresolved: Array<string>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "genome.compliance.classify": {
    input: { genomeId: string; overrideProfile?: "none" | "health" | "finance" | "legal" | "regulated_other" };
    output: { genomeId: string; version: number; complianceProfile: "none" | "health" | "finance" | "legal" | "regulated_other"; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "genome.consent.grant": {
    input: { kind: string; subject: string; evidenceUrl?: string };
    output: { id: string; genomeId: string; kind: string; subject: string; evidenceUrl?: string; grantedBy: string; grantedAt: string; revokedBy?: string; revokedAt?: string };
  };
  "genome.consent.list": {
    input: Record<string, never>;
    output: { records: Array<{ id: string; genomeId: string; kind: string; subject: string; evidenceUrl?: string; grantedBy: string; grantedAt: string; revokedBy?: string; revokedAt?: string }> };
  };
  "genome.consent.revoke": {
    input: { consentId: string };
    output: { id: string; genomeId: string; kind: string; subject: string; evidenceUrl?: string; grantedBy: string; grantedAt: string; revokedBy?: string; revokedAt?: string };
  };
  "genome.create": {
    input: { brandId: string; businessName: string; category: string; oneLiner?: string; locale?: string };
    output: { draftGenomeId: string; identity: { businessName: string; category: string; oneLiner: string }; unresolved: Array<string>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "genome.dimensions.set": {
    input: { genomeId: string; proof_asset: Array<"person" | "product_ui" | "physical_craft" | "finished_work" | "physical_product" | "data_outcomes">; capture_capability: Array<"screen" | "space" | "work_artifacts" | "product" | "nothing">; objective: "leads" | "bookings" | "trials" | "sales" | "audience" | "hiring"; secondary_objectives?: Array<"leads" | "bookings" | "trials" | "sales" | "audience" | "hiring">; talent_availability: "yes_licensed" | "yes_unlicensed" | "no" };
    output: { genomeId: string; version: number; availableModes: { synthesize: boolean; assemble: boolean; direct_finish: boolean }; avatarEnabled: boolean; blockedModes: Array<{ mode: "synthesize" | "assemble" | "direct_finish"; because: string }>; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "genome.identity.set": {
    input: { genomeId: string; identity: { business_name?: string; category?: string; sub_category?: string; one_liner?: string; geography?: { scope: "global" | "national" | "local"; locale: string; radius_km: (number) | (null) }; languages?: Array<string>; price_tier?: "budget" | "mid" | "premium" | "enterprise" } };
    output: { genomeId: string; version: number };
  };
  "genome.list": {
    input: Record<string, never>;
    output: { genomes: Array<{ genomeId: string; brandId: string; name: string; updatedAt: string }> };
  };
  "genome.offer.set": {
    input: { genomeId: string; offer: { products?: Array<{ name: string; price?: string; cta_url?: string }>; primary_cta?: string } };
    output: { genomeId: string; version: number };
  };
  "genome.voice.set": {
    input: { genomeId: string; voice: { tone_vector?: { formal: number; playful: number; technical: number; bold: number }; pov_statements?: Array<string>; banned_phrases?: Array<string>; required_disclaimers?: Array<string>; reading_level?: number } };
    output: { genomeId: string; version: number };
  };
  "guard.evaluate_draft": {
    input: { genomeId: string; playbookId: string; platform: string; text: string; referencedAssetIds?: Array<string> };
    output: { overall: "pass" | "flag" | "block"; checks: Record<string, { verdict: "pass" | "flag" | "block"; rule?: string; evidence?: unknown; fixAction?: string }>; why: { summary: string; factors: Array<{ label: string; detail?: string }>; evidence: Array<{ kind: "rule"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "human.answer": {
    input: { messageId: string; answer: string };
    output: { messageId: string; answered: boolean; answeredAt: string };
  };
  "human.ask": {
    input: { question: string; options?: Array<string>; urgency?: "low" | "normal" | "high" };
    output: { messageId: string; brandId: string; kind: "ask" | "notify"; body: string; urgency: "low" | "normal" | "high"; topic?: "content_ready" | "published" | "failed" | "queued" | "connection" | "generic"; target?: { type: "content_item"; id: string }; createdAt: string; pendingDelivery: boolean };
  };
  "human.notifications": {
    input: { limit?: number; unreadOnly?: boolean };
    output: { brandId: string; unreadCount: number; notifications: Array<{ messageId: string; message: string; urgency: "low" | "normal" | "high"; at: string; read: boolean; topic?: "content_ready" | "published" | "failed" | "queued" | "connection" | "generic"; target?: { type: "content_item"; id: string }; runId?: string; channel?: string }> };
  };
  "human.notifications.read": {
    input: { messageIds?: Array<string>; all?: boolean };
    output: { brandId: string; marked: number; unreadCount: number };
  };
  "human.notify": {
    input: { message: string; urgency?: "low" | "normal" | "high"; topic?: "content_ready" | "published" | "failed" | "queued" | "connection" | "generic"; target?: { type: "content_item"; id: string } };
    output: { messageId: string; brandId: string; kind: "ask" | "notify"; body: string; urgency: "low" | "normal" | "high"; topic?: "content_ready" | "published" | "failed" | "queued" | "connection" | "generic"; target?: { type: "content_item"; id: string }; createdAt: string; pendingDelivery: boolean };
  };
  "human.pending": {
    input: { limit?: number };
    output: { brandId: string; questions: Array<{ messageId: string; question: string; options?: Array<string>; urgency: "low" | "normal" | "high"; askedAt: string; waitingHours: number; runId?: string }> };
  };
  "integration.connect": {
    input: { genomeId: string; provider: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky" };
    output: { authorizeUrl: string };
  };
  "integration.health": {
    input: Record<string, never>;
    output: { platforms: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; connected: boolean; status: "not_connected" | "ok" | "expiring" | "expired"; accountLabel?: string; expiresAt?: string; hoursUntilExpiry: (number) | (null); supported: boolean; via: (string) | (null) }>; needsAttention: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; status: "not_connected" | "ok" | "expiring" | "expired"; detail: string }> };
  };
  "integration.rate_budget": {
    input: Record<string, never>;
    output: { platforms: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; remainingToday: number; limit: number }> };
  };
  "integration.scopes.verify": {
    input: { genomeId: string; provider: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky" };
    output: { provider: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; requestedScopes: Array<string>; granted: boolean; checkedAt: string };
  };
  "knowledge.ground_claim": {
    input: { genomeId: string; claim: string };
    output: { grounded: boolean; ungroundedClaims: Array<string>; fixAction?: string };
  };
  "knowledge.ingest_docs": {
    input: { genomeId: string; docs: Array<{ docId: string; text: string; citationLabel?: string }> };
    output: { genomeId: string; results: Array<{ docId: string; attached: boolean; error?: string }> };
  };
  "knowledge.ingest_site": {
    input: { genomeId: string; url: string; maxPages?: number };
    output: { genomeId: string; attached: Array<{ docId: string; title: string; chars: number }>; failure?: string };
  };
  "knowledge.list": {
    input: { genomeId: string };
    output: { genomeId: string; docs: Array<{ docId: string; chunks: number; chars: number; citationLabel?: string; attachedAt: string; preview: string }>; totalChunks: number; totalChars: number };
  };
  "lead.convert": {
    input: { leadId: string; brandId: string };
    output: { lead: { id: string; businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number; source: "manual" | "import" | "referral" | "inbound"; status: "new" | "contacted" | "qualified" | "won" | "lost"; convertedBrandId?: string; createdAt: string; updatedAt: string }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "lead.create": {
    input: { businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number; source?: "manual" | "import" | "referral" | "inbound" };
    output: { lead: { id: string; businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number; source: "manual" | "import" | "referral" | "inbound"; status: "new" | "contacted" | "qualified" | "won" | "lost"; convertedBrandId?: string; createdAt: string; updatedAt: string } };
  };
  "lead.import": {
    input: { rows: Array<{ businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number }>; source?: "manual" | "import" | "referral" | "inbound" };
    output: { imported: number; duplicatesSkipped: number; duplicatesWithinUpload: number; leads: Array<{ id: string; businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number; source: "manual" | "import" | "referral" | "inbound"; status: "new" | "contacted" | "qualified" | "won" | "lost"; convertedBrandId?: string; createdAt: string; updatedAt: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "lead.list": {
    input: { status?: Array<"new" | "contacted" | "qualified" | "won" | "lost">; source?: Array<"manual" | "import" | "referral" | "inbound">; search?: string; limit?: number; offset?: number };
    output: { leads: Array<{ id: string; businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number; source: "manual" | "import" | "referral" | "inbound"; status: "new" | "contacted" | "qualified" | "won" | "lost"; convertedBrandId?: string; createdAt: string; updatedAt: string }>; total: number; counts: { new: number; contacted: number; qualified: number; won: number; lost: number } };
  };
  "lead.update": {
    input: { leadId: string; status?: "new" | "contacted" | "qualified" | "won" | "lost"; businessName?: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number };
    output: { lead: { id: string; businessName: string; contactName?: string; email?: string; phone?: string; location?: string; website?: string; interest?: string; notes?: string; rating?: number; source: "manual" | "import" | "referral" | "inbound"; status: "new" | "contacted" | "qualified" | "won" | "lost"; convertedBrandId?: string; createdAt: string; updatedAt: string } };
  };
  "learning.confidence": {
    input: { genomeId: string };
    output: { confidence: number; active: boolean; mixWeightsOverride: (Record<string, number>) | (null); arms: Array<{ pillar: string; alpha: number; beta: number; observations: number; posteriorMean: number; qualifies: boolean }> };
  };
  "learning.explain": {
    input: { genomeId: string };
    output: { why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "learning.freeze": {
    input: { genomeId: string; enabled: boolean };
    output: { genomeId: string; frozen: boolean; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "learning.record_outcome": {
    input: { genomeId: string; contentItemId: string };
    output: { recorded: boolean; pillar: string; reward: number; arm: { pillar: string; alpha: number; beta: number; observations: number; posteriorMean: number; qualifies: boolean }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "learning.reset": {
    input: { genomeId: string };
    output: { genomeId: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "learning.reweight": {
    input: { genomeId: string };
    output: { confidence: number; mixWeightsOverride: (Record<string, number>) | (null); arms: Array<{ pillar: string; alpha: number; beta: number; observations: number; posteriorMean: number; qualifies: boolean }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "link.shorten": {
    input: { genomeId: string; url: string; tags?: Array<string>; contentItemId?: string };
    output: { shortUrl: string; destinationUrl: string };
  };
  "org.audit.query": {
    input: { tool?: string; since?: string; until?: string; limit?: number };
    output: { calls: Array<{ id: string; tool: string; caller: "user" | "agent"; decision: string; status: string; costCents: number; at: string; ruleId?: string; reason?: string }> };
  };
  "org.billing.plan.set": {
    input: { plan: "starter" | "growth" | "agency" };
    output: { plan: "starter" | "growth" | "agency"; defaultApprovalMode: string; ssoRequired: boolean; twoFactorRequired: boolean; dataResidency: string; retentionDays: (number) | (null); monthlyCapCents: number; updatedAt: string };
  };
  "org.budget.set": {
    input: { monthlyCapCents?: number; allocationsCents?: Record<string, number> };
    output: { monthlyCapCents: number; monthlyCapCredits: number; allocations: Array<{ category: string; label: string; capCents: number; capCredits: number }>; unallocatedCents: number };
  };
  "org.create": {
    input: { plan?: "starter" | "growth" | "agency" };
    output: { plan: "starter" | "growth" | "agency"; defaultApprovalMode: string; ssoRequired: boolean; twoFactorRequired: boolean; dataResidency: string; retentionDays: (number) | (null); monthlyCapCents: number; updatedAt: string };
  };
  "org.credits.grant": {
    input: { amountCents: number; reason: string; brandId?: string };
    output: { granted: true; balance: { monthlyCapCents: number; spentCents: number } };
  };
  "org.governance.set": {
    input: { defaultApprovalMode?: "autopublish" | "review_first_week" | "review_everything"; twoFactorRequired?: boolean; dataResidency?: "any" | "eu" | "us" | "uk"; retentionDays?: number };
    output: { plan: "starter" | "growth" | "agency"; defaultApprovalMode: string; ssoRequired: boolean; twoFactorRequired: boolean; dataResidency: string; retentionDays: (number) | (null); monthlyCapCents: number; updatedAt: string };
  };
  "org.security.sso.configure": {
    input: { required: boolean };
    output: { plan: "starter" | "growth" | "agency"; defaultApprovalMode: string; ssoRequired: boolean; twoFactorRequired: boolean; dataResidency: string; retentionDays: (number) | (null); monthlyCapCents: number; updatedAt: string };
  };
  "org.usage.get": {
    input: { topTools?: number };
    output: { monthlyCapCents: number; monthlyCapCredits: number; spentCredits: number; remainingCredits: number; byCategory: Array<{ category: string; label: string; costCents: number; credits: number; calls: number; share: number; unavailable: boolean; allocationCents?: number; allocationCredits?: number; allocationUsedFraction?: number; paused: boolean }>; forecastCents?: number; forecastCredits?: number; forecastOverCap: boolean; spentCents: number; remainingCents: number; usedFraction: number; alert: "ok" | "warning" | "critical" | "exhausted"; byTool: Array<{ tool: string; costCents: number; calls: number; share: number }>; periodStart: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "playbook.explain": {
    input: { genomeId: string; playbookId: string };
    output: { playbookId: string; producible: boolean; unlockable: boolean; missingRoles: Array<string>; score?: number; why: { summary: string; factors: Array<{ label: string; detail?: string; weight?: number }>; evidence: Array<{ kind: "rule" | "asset"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "playbook.get": {
    input: { playbookId: string };
    output: { playbookId: string; name: string; description: string; mode: "synthesize" | "assemble" | "direct_finish"; contentPillar: "educational" | "product" | "proof" | "personality" | "community"; mediaType: "video" | "image" | "carousel" | "text"; platforms: Array<"instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky">; saturationRisk: "low" | "medium" | "high"; isActive: boolean; requiresDisclosure: boolean; complianceFlags: Array<string>; aspectRatios: Array<string>; beatCount: number; preconditions: { captureCapabilityAny?: Array<string>; proofAssetAny?: Array<string>; requiredAssetRoles: Array<string>; minAssets: number; talentRequired: boolean; requiresLikenessLicense: boolean } };
  };
  "playbook.list": {
    input: { activeOnly?: boolean };
    output: { playbooks: Array<{ playbookId: string; name: string; description: string; mode: "synthesize" | "assemble" | "direct_finish"; contentPillar: "educational" | "product" | "proof" | "personality" | "community"; mediaType: "video" | "image" | "carousel" | "text"; platforms: Array<"instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky">; saturationRisk: "low" | "medium" | "high" }>; total: number };
  };
  "playbook.resolve": {
    input: { genomeId: string; assumeAssets?: Record<string, number> };
    output: { genomeId: string; profile: string; ranked: Array<{ playbook_id: string; name: string; mode: "synthesize" | "assemble" | "direct_finish"; content_pillar: "educational" | "product" | "proof" | "personality" | "community"; score: number; unlockable: boolean; missing_roles: Array<string>; unlocked_by?: "upload" | "capture" | "answer"; missing_genome_paths: Array<string> }>; unlockable: Array<{ playbook_id: string; name: string; mode: "synthesize" | "assemble" | "direct_finish"; content_pillar: "educational" | "product" | "proof" | "personality" | "community"; score: number; unlockable: boolean; missing_roles: Array<string>; unlocked_by?: "upload" | "capture" | "answer"; missing_genome_paths: Array<string> }>; mix: { source: "cold_start" | "learned"; weights: Record<string, number> }; why: { summary: string; factors: Array<{ label: string; detail?: string; weight?: number }>; evidence: Array<{ kind: "rule" | "asset"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "proposal.decide": {
    input: { proposalId: string; outcome: "accepted" | "declined" | "withdrawn"; notes?: string };
    output: { proposal: { id: string; leadId: string; title: string; currency: string; status: "draft" | "sent" | "accepted" | "declined" | "withdrawn"; termMonths: number; lineItems: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity: number; recurrence: "monthly" | "one_off" }>; monthlyCents: number; oneOffCents: number; totalContractCents: number; notes?: string; shareExpiresAt?: string; sentAt?: string; decidedAt?: string; createdAt: string; updatedAt: string }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "proposal.draft": {
    input: { leadId: string; title: string; currency?: string; termMonths: number; lineItems: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity?: number; recurrence: "monthly" | "one_off" }>; notes?: string };
    output: { proposal: { id: string; leadId: string; title: string; currency: string; status: "draft" | "sent" | "accepted" | "declined" | "withdrawn"; termMonths: number; lineItems: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity: number; recurrence: "monthly" | "one_off" }>; monthlyCents: number; oneOffCents: number; totalContractCents: number; notes?: string; shareExpiresAt?: string; sentAt?: string; decidedAt?: string; createdAt: string; updatedAt: string }; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "proposal.list": {
    input: { leadId?: string; status?: Array<"draft" | "sent" | "accepted" | "declined" | "withdrawn">; limit?: number; offset?: number };
    output: { proposals: Array<{ id: string; leadId: string; title: string; currency: string; status: "draft" | "sent" | "accepted" | "declined" | "withdrawn"; termMonths: number; lineItems: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity: number; recurrence: "monthly" | "one_off" }>; monthlyCents: number; oneOffCents: number; totalContractCents: number; notes?: string; shareExpiresAt?: string; sentAt?: string; decidedAt?: string; createdAt: string; updatedAt: string }>; total: number; pipeline: { outstandingCents: number; acceptedCents: number; currency?: string } };
  };
  "proposal.share": {
    input: { proposalId: string; expiresInDays?: number; markSent?: boolean };
    output: { token: string; expiresAt: string; proposal: { id: string; leadId: string; title: string; currency: string; status: "draft" | "sent" | "accepted" | "declined" | "withdrawn"; termMonths: number; lineItems: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity: number; recurrence: "monthly" | "one_off" }>; monthlyCents: number; oneOffCents: number; totalContractCents: number; notes?: string; shareExpiresAt?: string; sentAt?: string; decidedAt?: string; createdAt: string; updatedAt: string } };
  };
  "proposal.update": {
    input: { proposalId: string; title?: string; currency?: string; termMonths?: number; lineItems?: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity?: number; recurrence: "monthly" | "one_off" }>; notes?: string };
    output: { proposal: { id: string; leadId: string; title: string; currency: string; status: "draft" | "sent" | "accepted" | "declined" | "withdrawn"; termMonths: number; lineItems: Array<{ service: "content_creation" | "social_media_management" | "paid_ads" | "strategy_consulting" | "community_management" | "other"; description?: string; unitCents: number; quantity: number; recurrence: "monthly" | "one_off" }>; monthlyCents: number; oneOffCents: number; totalContractCents: number; notes?: string; shareExpiresAt?: string; sentAt?: string; decidedAt?: string; createdAt: string; updatedAt: string } };
  };
  "publish.now": {
    input: { contentItemId: string; genomeId: string; playbookId: string; platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; text: string; referencedAssetIds?: Array<string>; mediaUrls?: Array<string> };
    output: { platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; externalId: string; url?: string; via: string; publishedAt: string; attempts: number };
  };
  "publish.rollback": {
    input: { contentItemId: string; genomeId: string; reason?: string };
    output: { contentItemId: string; platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; rolledBackAt: string };
  };
  "publish.status": {
    input: Record<string, never>;
    output: { platforms: Array<{ platform: "instagram" | "instagram_story" | "tiktok" | "linkedin" | "x" | "youtube_shorts" | "youtube_long" | "facebook" | "facebook_group" | "threads" | "pinterest" | "google_business" | "reddit" | "bluesky"; supported: boolean; via: (string) | (null); remainingToday: number }> };
  };
  "queue.review.list": {
    input: { limit?: number };
    output: { items: Array<{ callId: string; tool: string; ruleId?: string; reason?: string; requestedAt: string; requestedBy?: string; genomeId?: string; input: unknown }> };
  };
  "recipe.create": {
    input: { genomeId: string; kind: "auto_trend" | "bulk_connector" | "rss"; name: string; config: unknown; intervalMinutes?: number };
    output: { id: string; genomeId: string; kind: "auto_trend" | "bulk_connector" | "rss"; name: string; config: unknown; status: "active" | "paused" | "completed"; intervalMinutes?: number; lastRunAt?: string; createdAt: string; notApplied?: Array<{ field: string; because: string }> };
  };
  "recipe.delete": {
    input: { id: string; genomeId: string };
    output: { deleted: true };
  };
  "recipe.get": {
    input: { id: string; genomeId: string };
    output: { id: string; genomeId: string; kind: "auto_trend" | "bulk_connector" | "rss"; name: string; config: unknown; status: "active" | "paused" | "completed"; intervalMinutes?: number; lastRunAt?: string; createdAt: string; notApplied?: Array<{ field: string; because: string }> };
  };
  "recipe.list": {
    input: { genomeId: string };
    output: { recipes: Array<{ id: string; genomeId: string; kind: "auto_trend" | "bulk_connector" | "rss"; name: string; config: unknown; status: "active" | "paused" | "completed"; intervalMinutes?: number; lastRunAt?: string; createdAt: string; notApplied?: Array<{ field: string; because: string }> }> };
  };
  "recipe.output.decide": {
    input: { id: string; genomeId: string; status: "approved" | "rejected"; contentItemId?: string };
    output: { id: string; recipeId: string; runId: string; status: "pending_review" | "approved" | "rejected"; preview: unknown; contentItemId?: string; createdAt: string; decidedAt?: string };
  };
  "recipe.output.list": {
    input: { genomeId: string; status?: "pending_review" | "approved" | "rejected"; limit?: number };
    output: { outputs: Array<{ id: string; recipeId: string; runId: string; status: "pending_review" | "approved" | "rejected"; preview: unknown; contentItemId?: string; createdAt: string; decidedAt?: string }> };
  };
  "recipe.run": {
    input: { id: string; genomeId: string };
    output: { runId: string; outputCount: number; error?: string; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "recipe.schedule": {
    input: { id: string; genomeId: string; status: "active" | "paused" };
    output: { id: string; genomeId: string; kind: "auto_trend" | "bulk_connector" | "rss"; name: string; config: unknown; status: "active" | "paused" | "completed"; intervalMinutes?: number; lastRunAt?: string; createdAt: string; notApplied?: Array<{ field: string; because: string }> };
  };
  "recipe.update": {
    input: { id: string; genomeId: string; name?: string; config?: unknown; intervalMinutes?: number };
    output: { id: string; genomeId: string; kind: "auto_trend" | "bulk_connector" | "rss"; name: string; config: unknown; status: "active" | "paused" | "completed"; intervalMinutes?: number; lastRunAt?: string; createdAt: string; notApplied?: Array<{ field: string; because: string }> };
  };
  "recipe.validate": {
    input: { kind: "auto_trend" | "bulk_connector" | "rss"; config: unknown };
    output: { valid: boolean; error?: string; notApplied: Array<{ field: string; because: string }> };
  };
  "team.group.create": {
    input: { name: string; capabilities?: Array<"publish" | "spend_credits" | "manage_brand" | "approve">; members?: Array<string> };
    output: { id: string; name: string; capabilities: Array<string>; memberCount: number; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "team.group.delete": {
    input: { groupId: string };
    output: { groupId: string; deleted: boolean };
  };
  "team.group.list": {
    input: Record<string, never>;
    output: { groups: Array<{ id: string; name: string; capabilities: Array<string>; memberCount: number; members: Array<string> }> };
  };
  "team.group.member.set": {
    input: { groupId: string; userId: string; member?: boolean };
    output: { groupId: string; userId: string; member: boolean; memberCount: number };
  };
  "team.group.update": {
    input: { groupId: string; name?: string; capabilities?: Array<"publish" | "spend_credits" | "manage_brand" | "approve"> };
    output: { id: string; name: string; capabilities: Array<string>; memberCount: number; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "team.invite": {
    input: { email: string; role: string };
    output: { invitationId: string; status: string };
  };
  "team.list": {
    input: { limit?: number };
    output: { members: Array<{ userId: string; email?: string; name?: string; orgRole: string; joinedAt: string; brands: Array<{ brandId: string; role: string }>; allBrands: boolean }>; partial?: string };
  };
  "team.permission.set": {
    input: { userId: string; brandId: string; role?: "owner" | "admin" | "editor" | "approver" | "viewer" | "client"; revoke?: boolean };
    output: { userId: string; brandId: string; role?: string; revoked: boolean };
  };
  "team.role.set": {
    input: { userId: string; role: string };
    output: { userId: string; role: string };
  };
  "trend.detail": {
    input: { genomeId: string; trendId: string; seriesDays?: number };
    output: { trend: { id: string; source: "tiktok" | "x" | "youtube" | "reddit" | "google" | "hackernews" | "producthunt" | "pinterest" | "manual"; topic: string; tags: Array<string>; metrics: { volume: number; velocity: number; saturation: number; growth: number }; samples: Array<{ url: string; caption?: string }>; media?: { url: string; kind: "image" | "video" }; regions: Array<{ code: string; volume?: number }>; language: string; region?: string }; score: number; relevance: number; opportunity: number; safety: { safe: boolean; reasons: Array<string>; detail?: string }; factors: Array<{ label: string; detail: string; weight?: number }>; series: Array<{ at: string; volume: number; velocity: number; saturation: number; growth: number }>; trajectory: ({ direction: "climbing" | "flat" | "cooling"; saturationChange: number; volumeChange: (number) | (null); observations: number; spanHours: number }) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.explain": {
    input: { genomeId: string; trendId: string };
    output: { why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.fetch": {
    input: { limit?: number; region?: string; language?: string };
    output: { trends: Array<{ id: string; source: "tiktok" | "x" | "youtube" | "reddit" | "google" | "hackernews" | "producthunt" | "pinterest" | "manual"; topic: string; tags: Array<string>; metrics: { volume: number; velocity: number; saturation: number; growth: number }; samples: Array<{ url: string; caption?: string }>; media?: { url: string; kind: "image" | "video" }; regions: Array<{ code: string; volume?: number }>; language: string; region?: string }>; source: string };
  };
  "trend.hooks": {
    input: { genomeId: string; trendId: string; count?: number };
    output: { trendId: string; topic: string; hooks: Array<string>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.influencer.review": {
    input: { genomeId: string; postsPerAccount?: number; limit?: number };
    output: { posts: Array<{ platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; handle: string; trendId: string; topic: string; source: "tiktok" | "x" | "youtube" | "reddit" | "google" | "hackernews" | "producthunt" | "pinterest" | "manual"; score: number; relevance: number; opportunity: number; safe: boolean; unsafeBecause?: string; metrics: { volume: number; velocity: number; saturation: number; growth: number } }>; quiet: Array<{ platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; handle: string; because: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.influencer.watch": {
    input: { genomeId: string; action: "add" | "remove" | "list"; platform?: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; handle?: string; note?: string };
    output: { watchlist: Array<{ platform: "instagram" | "tiktok" | "linkedin" | "x" | "youtube_shorts"; handle: string; displayName?: string; note?: string; createdAt: string }> };
  };
  "trend.observe": {
    input: { limit?: number; region?: string; language?: string };
    output: { observed: number; source: string; at: string };
  };
  "trend.rank": {
    input: { genomeId: string; limit?: number; region?: string; language?: string };
    output: { trends: Array<{ trendId: string; source: "tiktok" | "x" | "youtube" | "reddit" | "google" | "hackernews" | "producthunt" | "pinterest" | "manual"; topic: string; score: number; relevance: number; opportunity: number; metrics: { volume: number; velocity: number; saturation: number; growth: number }; factors: Array<{ label: string; detail: string; weight?: number }>; media?: { url: string; kind: "image" | "video" }; samples: Array<{ url: string; caption?: string }>; tags: Array<string>; regions: Array<{ code: string; volume?: number }> }>; excluded: Array<{ trendId: string; source: "tiktok" | "x" | "youtube" | "reddit" | "google" | "hackernews" | "producthunt" | "pinterest" | "manual"; topic: string; score: number; relevance: number; opportunity: number; metrics: { volume: number; velocity: number; saturation: number; growth: number }; factors: Array<{ label: string; detail: string; weight?: number }>; media?: { url: string; kind: "image" | "video" }; samples: Array<{ url: string; caption?: string }>; tags: Array<string>; regions: Array<{ code: string; volume?: number }>; because: string }>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.repurpose": {
    input: { genomeId: string; trendId: string };
    output: { suggestion: ({ playbookId: string; playbookName: string; pillar: string; mode: string; intent: string; unlockable: boolean; missingRoles: Array<string>; matchedOn: Array<string> }) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.reshare": {
    input: { genomeId: string; trendId: string; contentItemId: string };
    output: { suggestion: ({ playbookId: string; referencedAssetIds: Array<string>; intent: string }) | (null); why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.safety_filter": {
    input: { genomeId: string; trends: Array<{ trendId?: string; topic?: string; tags?: Array<string>; language?: string }> };
    output: { results: Array<{ trendId?: string; topic: string; safe: boolean; reasons: Array<string>; detail?: string }> };
  };
  "trend.source.mute": {
    input: { genomeId: string; source: string; muted: boolean };
    output: { source: string; muted: boolean; mutedSources: Array<string>; why: { summary: string; factors: Array<{ label: string; weight?: number; detail?: string }>; evidence: Array<{ kind: "asset" | "knowledge_chunk" | "past_post" | "metric" | "rule" | "trend"; id: string; note?: string }>; alternatives: Array<{ option: string; rejectedBecause: string }> } };
  };
  "trend.sources": {
    input: { genomeId?: string };
    output: { sources: Array<{ name: string; keywordSupport: "server" | "filter"; muted: boolean; configured: boolean; enabled: boolean; requires: Array<string>; note?: string }>; anyKeywordSearch: boolean; keywordNote: string };
  };
  "trend.watchlist": {
    input: { genomeId: string; action: "add" | "remove" | "list"; trendId?: string; topic?: string; note?: string };
    output: { watchlist: Array<{ trendId: string; source: string; topic: string; note?: string; createdAt: string }> };
  };
  "whatsapp.receive": {
    input: { from: string; body: string; channelMessageId: string; inReplyTo?: string };
    output: { outcome: "answered_question" | "already_answered" | "no_open_question"; messageId?: string; authorised: false };
  };
  "whatsapp.send": {
    input: { to: string; body: string; options?: Array<string>; humanMessageId?: string };
    output: { messageId: string; channel: string; to: string };
  };
  "whitelabel.link.create": {
    input: { brandId: string; scope: "calendar" | "content_item"; targetId?: string; expiresInDays?: number };
    output: { id: string; token: string; expiresAt: string };
  };
}

/** Every tool the registry knows. `invoke` accepts nothing else. */
export type ToolName = keyof ToolIO;

export type ToolInput<N extends ToolName> = ToolIO[N]['input'];
export type ToolOutput<N extends ToolName> = ToolIO[N]['output'];
