import { register } from '@sparksocial/tools';
import { makeGenomeBootstrap } from '@sparksocial/genome/bootstrap';
import { genomeDimensionsSet } from '@sparksocial/genome/dimensions';
import { genomeIdentitySet } from '@sparksocial/genome/identity';
import { genomeOfferSet } from '@sparksocial/genome/offer';
import { genomeVoiceSet } from '@sparksocial/genome/voice';
import { genomeCreate } from '@sparksocial/genome/create';
import { genomeList } from '@sparksocial/genome/list';
import { consentGrant, consentRevoke, consentList } from '@sparksocial/genome/consent';
import { avatarConfigSet } from '@sparksocial/genome/avatarConfig';
import { genomeComplianceClassify } from '@sparksocial/genome/compliance';
import { genomeAvatarOverrideSet } from '@sparksocial/genome/avatarOverride';
import { makeKnowledgeIngestSite, makeKnowledgeIngestDocs, knowledgeGroundClaim, knowledgeList } from '@sparksocial/genome/knowledge';
import { playbookResolve } from '@sparksocial/playbooks/tools';
import { playbookList, playbookGet, playbookExplain } from '@sparksocial/playbooks/browse';
import {
  makeAssetRetrieve,
  assetGaps,
  makeAssetIngestUrl,
  makeAssetUploadUrl,
  assetRightsSet,
  assetReuse,
  assetCooldownCheck,
  assetFolderCreate,
  assetFolderMove,
  assetFolderList,
} from '@sparksocial/assetgraph';
import {
  createAzureBlobStore,
  createLocalDiskBlobStore,
  LOCAL_STORAGE_ROUTE_PREFIX,
  type BlobStore,
  type LocalDiskBlobStore,
} from '@sparksocial/storage';
import {
  makeBriefGenerate,
  makeSessionBatch,
  makeSessionSend,
  fallbackDegrade,
  makeWhatsappSend,
  makeWhatsappReceive,
} from '@sparksocial/capture';
import { createDraftGuard, createReplyGuard, makeEvaluateDraft } from '@sparksocial/guardrails';
import { makeMediaIngest } from '@sparksocial/finish';
import { makeAssemblePlan } from '@sparksocial/assemble';
import { makeComposeRender, makeComposeStatic, makeComposeFanout } from '@sparksocial/compose';
import {
  makeContentDraft,
  makeDraftVariants,
  contentVariantSplit,
  contentVariantResult,
  makeDraftRepurpose,
  makeContentGenerateImage,
  makeContentGenerateBroll,
  makeContentGenerateDub,
  makeContentGenerateAvatarVideo,
  makeContentGenerateVoiceover,
  contentGet,
  contentList,
  contentSchedule,
  contentBeatUpdate,
} from '@sparksocial/generate';
import {
  campaignProposePlan,
  campaignCreate,
  campaignList,
  campaignReportVsOutcome,
  campaignDuplicate,
  campaignPause,
  campaignResume,
  calendarGenerate,
  calendarImpactPreview,
  calendarGet,
  approvalGet,
  approvalSet,
  approvalPolicyGet,
  approvalPolicySet,
  agentStatus,
  agentPause,
  agentResume,
  agentFrequencySet,
  agentExplain,
  humanAsk,
  humanNotify,
  humanPending,
  humanAnswer,
} from '@sparksocial/campaign';
import { agentRunGet, agentRunList } from '@sparksocial/spark';
import { makeApprovalDecide, queueReviewList, type InvokeResult, type CreditStore } from '@sparksocial/tools';
import type { ClerkClient } from '@clerk/backend';
import {
  orgCreate,
  orgGovernanceSet,
  orgBillingPlanSet,
  orgSecuritySsoConfigure,
  orgAuditQuery,
  makeOrgCreditsGrant,
  makeOrgUsageGet,
  brandCreate,
  brandSettingsPatch,
  brandGovernanceGet,
  brandGovernanceSet,
  makeBrandKnowledgeAttach,
  brandExport,
  brandImport,
  makeTeamInvite,
  makeTeamRoleSet,
  makeTeamList,
  teamPermissionSet,
  whitelabelLinkCreate,
  makeBrandOAuthConnect,
  brandOAuthStatus,
  brandOAuthDisconnect,
} from '@sparksocial/agency';
import {
  createStubAdapter,
  makePublishNow,
  makePublishStatus,
  makePublishRollback,
  makeLinkShorten,
  makeIntegrationConnect,
  makeIntegrationHealth,
  makeIntegrationRateBudget,
  integrationScopesVerify,
  type Platform,
} from '@sparksocial/publish';
import { socialAdapterClients } from './social-adapter-clients.js';
import {
  makeTrendRank,
  makeTrendFetch,
  makeTrendDetail,
  makeTrendSafetyFilter,
  makeTrendRepurpose,
  makeTrendReshare,
  makeTrendWatchlist,
  makeTrendExplain,
  makeTrendObserve,
  trendInfluencerWatch,
  makeTrendInfluencerReview,
} from '@sparksocial/trends';
import {
  recipeValidate,
  recipeCreate,
  recipeGet,
  recipeList,
  recipeSchedule,
  recipeDelete,
  makeRecipeRun,
  recipeOutputList,
  recipeOutputDecide,
} from '@sparksocial/recipes';
import { fetchTextForRecipes, fetchWithAuthForRecipes } from './recipe-fetch.js';
import { buildTrendSource } from './trend-sources.js';
import { learningRecordOutcome, learningReweight, learningConfidence, learningExplain, learningFreeze, learningReset } from '@sparksocial/learning';
import {
  makeAnalyticsSync,
  analyticsPostMetrics,
  analyticsCampaignReport,
  analyticsSuccessMetrics,
  makeAnalyticsCtaTraffic,
} from '@sparksocial/analytics';
import {
  engageIngest,
  makeEngageClassify,
  engageEligibilityCheck,
  engageList,
  makeEngageReplyDraft,
  makeEngageReplySend,
  makeEngageAutohandle,
  engageEscalate,
  engageTakeover,
  engageOpportunityCreate,
  engageOpportunityRoute,
  engageAuditQuery,
  engageThread,
  createStubReplySender,
} from '@sparksocial/engage';
import { devBriefWriter, devMediaIngestDeps, devInferenceClient, devTextWriter, devEngageClassifier, devReplyWriter } from './dev-vendors.js';
import { anthropicInferenceClient } from './inference-client.js';
import { languageModelAvailable } from './model-client.js';
import { buildRateLimiter } from './rate-limiter.js';
import { embedClient } from './embed-client.js';
import { captionClient } from './caption-client.js';
import { briefWriter } from './brief-writer.js';
import { textWriter } from './text-writer.js';
import { imageClient } from './image-client.js';
import { videoClient } from './video-client.js';
import { avatarClient } from './avatar-client.js';
import { voiceClient } from './voice-client.js';
import { dubbingClient } from './dubbing-client.js';
import { dubClient } from './dub-client.js';
import { analyticsClient } from './analytics-client.js';
import { ayrshareAdapterClient } from './ayrshare-adapter-client.js';
import { engageClassifier } from './engage-classifier.js';
import { replyWriter } from './reply-writer.js';
import { whatsappTransportClient } from './whatsapp-transport-client.js';
import { createFfmpegRunner } from './ffmpeg-runner.js';
import { createRemotionRunner } from './remotion-runner.js';
import { createSatoriRunner } from './satori-runner.js';
import { envSet, envStr, envNum } from './env.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * The real inference pass when a key is present, the deterministic fake when it
 * is not.
 *
 * Keyed on the credential rather than `NODE_ENV`, matching how the Clerk and
 * telemetry resolvers choose in `index.ts`: a developer who has set
 * `ANTHROPIC_API_KEY` wants the real thing, and CI, which has no key, must not
 * need one to run the suite.
 *
 * The fallback is loud on purpose. `devInferenceClient` reads the *hostname*,
 * not the crawled pages, so a silent downgrade means onboarding produces a
 * confident profile of a business nobody looked at.
 */
function inferenceClient() {
  if (languageModelAvailable()) return anthropicInferenceClient();
  console.warn(
    '[warn] ANTHROPIC_API_KEY unset — genome.bootstrap_from_url will return a fixed development ' +
      'profile derived from the hostname, ignoring the crawled site.',
  );
  return devInferenceClient();
}

/**
 * Explicit registration of the tools in the Aug 29 alpha scope.
 *
 * Deliberately a hand-written list rather than a filesystem scan: the set of
 * capabilities SPARK has should be reviewable in one diff, because adding a tool
 * is adding something the agent can do unattended.
 *
 * Grows toward the ~135 in master plan §3.2 as phases land. Alpha needs roughly
 * 30 of them — see the scope note in CLAUDE.md.
 */
export function registerAlphaTools(): void {
  /**
   * One transport for the whole app. `direct.session.send` and `whatsapp.send`
   * reaching the owner through different instances would be invisible with the
   * stub and wrong the moment the real client lands — two clients means two
   * rate limits, two connection pools, and a test that can only observe half
   * the messages that were sent. Real WhatsApp Cloud API when both
   * `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_TOKEN` are set, the in-memory stub
   * otherwise — same fallback rule as every other vendor client here.
   */
  const transport = whatsappTransportClient();

  /**
   * One embed client for the whole registry. Ingest and retrieve MUST use the
   * same one: an asset embedded by provider A and queried with provider B is
   * compared in two unrelated vector spaces, and the ranking that comes back is
   * noise that looks like a result.
   */
  const embed = embedClient();

  // ONB-01 → ONB-06: the five-question onboarding.
  register(makeGenomeBootstrap({ infer: inferenceClient() }));
  // The no-website path. `bootstrap_from_url` was the only way to make a
  // genome, so a site behind Cloudflare — or no site at all — blocked
  // onboarding entirely.
  register(genomeCreate);
  register(genomeDimensionsSet);
  // ONB-02: the chip-review correction path `genome.bootstrap_from_url`'s own
  // output was missing a way to save.
  register(genomeIdentitySet);
  register(genomeOfferSet);
  register(genomeVoiceSet);
  // Reads before a genome is selected — the brand switcher's source.
  register(genomeList);
  // §10 likeness consent — what backs `rights()`'s `avatarEnabled` input.
  register(consentGrant);
  register(consentRevoke);
  register(consentList);
  // Which trained HeyGen avatar / ElevenLabs voice this genome generates
  // from — set once, manually, after training completes out of band.
  register(avatarConfigSet);
  register(genomeComplianceClassify);
  register(genomeAvatarOverrideSet);
  // The automated counterpart to brand.knowledge.attach's one-doc-at-a-time
  // manual path — see packages/genome/src/knowledge.ts's own comment.
  register(makeKnowledgeIngestSite({ embed }));
  register(makeKnowledgeIngestDocs({ embed }));
  register(knowledgeGroundClaim);
  register(knowledgeList);

  // Campaign (§6.8): outcome in, a plan and an honest gap report out.
  register(campaignProposePlan);
  register(campaignCreate);
  register(campaignList);
  register(campaignReportVsOutcome);
  register(campaignDuplicate);
  register(campaignPause);
  register(campaignResume);

  // Calendar (§6.8 Step 4, CAL-01→CAL-06): reviewed at mix level, not post by post.
  register(calendarGenerate);
  register(calendarImpactPreview);
  register(calendarGet);

  // Approval ladder (§6.8 Step 5, PRD §7.1): the policy engine has always
  // implemented all three rungs; these are what let a brand be on one.
  register(approvalGet);
  register(approvalSet);
  register(approvalPolicyGet);
  register(approvalPolicySet);

  // Content engine: rank what this brand can actually make.
  register(playbookResolve);
  register(playbookList);
  register(playbookGet);
  register(playbookExplain);

  // Asset Graph (§4): grow it, query it, know what it's missing.
  register(makeAssetUploadUrl(blobStore()));
  register(
    makeAssetIngestUrl(
      envSet('AZURE_STORAGE_ACCOUNT')
        ? { ...captionClient(), ...embed }
        : {
            ...captionClient({ source: localBlobStore(), urlPrefix: localUrlPrefix() }),
            ...embed,
            trustedLocalUrlPrefix: localUrlPrefix(),
          },
    ),
  );
  register(makeAssetRetrieve(embed));
  register(assetGaps);
  register(assetRightsSet);
  register(assetReuse);
  register(assetCooldownCheck);
  register(assetFolderCreate);
  register(assetFolderMove);
  register(assetFolderList);

  // Assemble (§6.5): build a post from what the brand already owns. The
  // highest-value path for SaaS, agency, freelancer and e-commerce.
  register(makeAssemblePlan(embed));

  // Content generation (§6.5, §6.8's Draft Panel): assemble.plan's other
  // half — turns a resolved plan into an actual draft with real, brand-voiced
  // copy. Always registered: the text half never needs a vendor key beyond
  // ANTHROPIC_API_KEY, which the boot guard already requires for genome
  // inference. The image half is genuinely optional — see image-client.ts on
  // why there is no fake fallback for pixels, only "not registered".
  // PRD §8.6's draft-time governance verdict. Guardrails ran only at
  // `publish.now` — the strongest place to enforce them, and the worst place to
  // learn about them: a month of drafts looked fine on the calendar and then
  // failed one at a time on the way out. `createDraftGuard` runs the same eight
  // checks `publish.now` declares, so an earlier pass means something.
  register(makeContentDraft({ text: textWriter(devTextWriter()), embed, guard: createDraftGuard(embed) }));
  // Both reuse content.draft's own plan-then-write pipeline — see
  // packages/generate/src/variants.ts's own comment.
  register(makeDraftVariants({ text: textWriter(devTextWriter()), embed }));
  /**
   * §8.9's A/B test, the half `draft.variants` did not cover: two posts that
   * both go out and are measured separately. `.split` is `human_only` — running
   * a test means deliberately publishing something you think is worse.
   */
  register(contentVariantSplit);
  register(contentVariantResult);
  register(makeDraftRepurpose({ text: textWriter(devTextWriter()), embed }));
  register(contentGet);
  register(contentBeatUpdate);
  register(contentList);
  register(contentSchedule);
  const images = imageClient();
  if (images) register(makeContentGenerateImage(images));
  const videos = videoClient();
  if (videos) register(makeContentGenerateBroll(videos));
  // Same "unset → not registered" rule as the image tool, and for the same
  // reason: cloning a face or a voice has no honest fake stand-in.
  const avatars = avatarClient();
  if (avatars) register(makeContentGenerateAvatarVideo(avatars));
  const voices = voiceClient(blobStore());
  if (voices) register(makeContentGenerateVoiceover(voices));
  const dubbing = dubbingClient(blobStore());
  if (dubbing) register(makeContentGenerateDub(dubbing));

  // Compose (§6.5): the render step both Assemble and Synthesize converge on.
  // `content.draft` resolves what to render and stops — this turns that into
  // actual pixels via Remotion. Always registered: it needs no vendor key,
  // only Chrome Headless Shell, which `ensureBrowser()` fetches on first use.
  register(makeComposeRender({ runner: remotionRunner() }));

  // The fast, browser-free path for image/carousel formats — see
  // compose/src/static.ts's own comment on why this exists alongside
  // compose.render rather than replacing its image/carousel branches.
  // Always registered: Satori needs no vendor key, only the bundled font.
  register(makeComposeStatic({ runner: satoriRunner() }));

  // Gated per-genome (Canva OAuth), not per-deployment — always registered,
  // same reasoning brandOAuthStatus/brandOAuthDisconnect already establish.
  register(makeComposeFanout());

  // Capture loop (§6.2, §6.3): the moat.
  // One writer for both: a session is a batch of briefs, and two writers would
  // let a single brief and the weekly batch disagree about the same playbook.
  const writer = briefWriter(devBriefWriter());
  register(makeBriefGenerate(writer));
  register(makeSessionBatch(writer));
  // The last hop. Stubbed until Meta business verification clears (plan §8) —
  // the seam is real, only the WhatsApp client behind it is not.
  register(makeSessionSend(transport));
  // "Fallbacks are mandatory" (§6.5): a missed week must not empty the calendar.
  register(fallbackDegrade);

  // Guardrails (§10): report every check on a draft before it can be scheduled.
  register(makeEvaluateDraft(embed));

  // Finish pipeline (§6.3): raw phone footage in, publishable clips out.
  /**
   * Quality metrics and dead-space detection still come from the dev stubs —
   * they need real signal processing (`blurdetect`, `signalstats`,
   * `vidstabdetect`) and a machine with ffmpeg to calibrate against. What is
   * real now is the *render* and the *embedding*: `createFfmpegRunner`
   * executes the filtergraphs `pipeline.ts` has been building and discarding
   * since P2, and `embed` is the same client `asset.ingest_url` uses.
   *
   * That last part was a real gap, not a hypothetical one: `devMediaIngestDeps`
   * bundles its own deterministic-stub `embed`, and spreading it last would
   * have silently overridden the real one. So the object below spreads `embed`
   * *after* the stub, deliberately — every asset that comes through the actual
   * capture loop was landing in Postgres with a real caption but a fake
   * embedding, unfindable by `asset.retrieve` even with `EMBEDDINGS_API_KEY`
   * fully configured. `asset.ingest_url` never had this bug; only the WhatsApp
   * path did, which is the one the "runs a full month on capture briefs alone"
   * exit criterion is actually about.
   */
  register(
    makeMediaIngest({
      ...devMediaIngestDeps(),
      ...createFfmpegRunner(),
      // `embed` here is the shared `EmbedClient` object (`{ embed(text) }`),
      // while `MediaIngestDeps.embed` wants the bare function — a naming
      // collision worth a comment so the next person doesn't wire the whole
      // object back in and reintroduce this bug silently.
      embed: embed.embed,
    }),
  );

  // Publishing (§8, P4, corrected 18 Aug 2026): native-first per the PRD's
  // actual strategy — "go native on the core five... use an aggregator for
  // the long tail" — not aggregator-first. Each platform's native adapter
  // registers once this operator has configured that platform's own
  // developer app (`socialAdapterClients`'s own comment); an unconfigured
  // platform falls through to the stub, so the whole calendar → guardrails →
  // policy → publish path still runs end to end without any vendor account.
  // The Ayrshare aggregator adapter is deliberately NOT included here even
  // when `AYRSHARE_API_KEY` is set — its code is kept intact
  // (`ayrshareAdapter.ts`, `ayrshare-adapter-client.ts`) for the long-tail
  // platforms (Pinterest, GBP, Reddit, Bluesky, Threads) post-GA, but is not
  // wired into routing until `PUBLISH_USE_AGGREGATOR=true` opts back in.
  const nativeAdapters = socialAdapterClients();
  const useAggregator = envSet('PUBLISH_USE_AGGREGATOR') && envStr('PUBLISH_USE_AGGREGATOR', '').toLowerCase() === 'true';
  const ayrshareAdapter = useAggregator ? ayrshareAdapterClient() : undefined;
  const adapters = [
    ...nativeAdapters,
    ...(ayrshareAdapter ? [ayrshareAdapter] : []),
    // Last-resort fallback: whatever platform nothing above claims still
    // round-trips end to end in dev — `routeAdapters` picks the first
    // adapter whose `supports()` returns true, so this only ever serves a
    // platform none of the above configured for.
    createStubAdapter({ name: 'aggregator:stub' }),
  ];
  // One limiter, shared by every tool that reads or spends from it — two
  // would let a health panel report a budget `publish.now` does not
  // actually enforce, worse than no health panel at all.
  const limiter = buildRateLimiter();
  register(makePublishNow({ adapters, limiter, embed }));
  register(makePublishStatus({ adapters, limiter, embed }));
  register(makePublishRollback({ adapters, limiter, embed }));
  register(makeIntegrationHealth({ adapters }));
  register(makeIntegrationRateBudget({ limiter }));
  register(integrationScopesVerify);

  // Link attribution (§8, P4). Same "unset → not registered" rule as the
  // image/avatar/voice generation tools.
  const dub = dubClient();
  if (dub) {
    register(makeLinkShorten(dub));
    // cta_traffic reads click counts off Dub links `link.shorten` creates —
    // no Dub client, nothing to read.
    register(makeAnalyticsCtaTraffic(dub));
  }

  // Performance sync (§3.2, `CC-04`, P4). Same "unset → not registered" rule
  // — no analytics vendor configured means nothing to poll for metrics.
  const analyticsSource = analyticsClient();
  if (analyticsSource) register(makeAnalyticsSync({ source: analyticsSource }));

  // Reads over what analytics.sync writes — need no vendor of their own.
  register(analyticsPostMetrics);
  register(analyticsCampaignReport);
  // PRD §5, all fourteen metrics. `tool_calls`, `content_items`,
  // `engagement_messages`, `opportunities` and `recipe_outputs` held the raw
  // material for nearly all of them and nothing aggregated any of it — which is
  // the gap that made every other gap hard to prioritise.
  register(analyticsSuccessMetrics);

  // Trend discovery (§8.9, DISC-01/DISC-02, §12 P5). Ranked on what is LEFT
  // of a trend, not its size. `buildTrendSource` merges every configured
  // real source (Reddit, YouTube — see trend-sources.ts) behind one
  // fault-isolated composite: a disabled or failing source degrades to
  // "everyone else," never an error for the caller. Falls back to the
  // deterministic stub, alone, only when nothing real is configured — the
  // same "unset → stub, not fabricated" rule as `publish`'s aggregator
  // adapter.
  const trendSource = buildTrendSource();
  register(makeTrendRank(trendSource));
  register(makeTrendFetch(trendSource));
  register(makeTrendDetail(trendSource));
  register(makeTrendSafetyFilter(trendSource));
  register(makeTrendRepurpose(trendSource));
  register(makeTrendReshare(trendSource));
  register(makeTrendWatchlist(trendSource));
  register(makeTrendExplain(trendSource));
  register(makeTrendObserve(trendSource));

  /**
   * §8.9's influencer watchlist. The watch tool is unconditional — a watchlist is
   * storage and needs no vendor. The review tool is registered with `undefined`
   * because reading a named account's posts needs platform listening access
   * nobody has cleared in this build; it refuses by name rather than returning a
   * fabricated feed, the same rule every other unconfigured seam here follows.
   */
  register(trendInfluencerWatch);
  register(makeTrendInfluencerReview(undefined));

  // Automation Recipes (§12 P5, `AUTO-01`→`AUTO-04.4`). `auto_trend` reuses
  // the same trend source as the `trend.*` family above; `rss` and the csv
  // sub-kind of `bulk_connector` fetch real public URLs (SSRF-checked —
  // `checkPublicHttpUrl`, same guard as `asset.ingest_url`). The drive
  // sub-kind reads a public Drive folder through one shared, restricted API
  // key (same "unset → not registered" shape as YOUTUBE_API_KEY); the canva
  // sub-kind reads through each brand's own OAuth connection (see
  // /oauth/canva/* routes), unconnected brands get "not connected" rather
  // than a fabricated response. `folder` has no meaning in a hosted app and
  // says so.
  register(recipeValidate);
  register(recipeCreate);
  register(recipeGet);
  register(recipeList);
  register(recipeSchedule);
  register(recipeDelete);
  register(
    makeRecipeRun({
      trendSource,
      fetchText: fetchTextForRecipes,
      fetchWithAuth: fetchWithAuthForRecipes,
      ...(envSet('GOOGLE_DRIVE_API_KEY') ? { driveApiKey: envStr('GOOGLE_DRIVE_API_KEY', '') } : {}),
    }),
  );
  register(recipeOutputList);
  register(recipeOutputDecide);

  // The learning loop (§6.7, §12 P6). The mix engine's read side
  // (`deriveMix` in packages/playbooks/src/mix.ts) has consumed
  // `genome.learned.*` since P2/P3; these four are the only writer/reader
  // pair for it — see `learning/src/tool.ts`'s module comment.
  register(learningRecordOutcome);
  register(learningReweight);
  register(learningConfidence);
  register(learningExplain);
  register(learningFreeze);
  register(learningReset);

  // Engagement Intelligence foundation (§8.8, `ENG-01`→`ENG-02.4`, P4):
  // ingest + classify + list + the eligibility gate, plus the "approve &
  // send" loop — `reply.draft` (read, free) and `reply.send` (publish,
  // gated by `policy.ts` rule 6 on eligibility + autonomy configuration).
  // Always registered — unlike the media-generation tools, there is an
  // honest fallback (fixed templates/keyword rules) for drafting and
  // classification without a model key, the same way `content.draft` falls
  // back to templates rather than disappearing. `reply.send` ships with
  // `createStubReplySender` — no per-platform "reply to a comment/DM" API is
  // wired up yet (see `packages/engage/src/replySender.ts`), same approvals
  // blocker as native publish adapters. `.autohandle` reuses the same stub
  // sender; `.escalate`/`.takeover`/`.opportunity.*`/`.audit.query` need no
  // vendor at all — see each tool's own file for why.
  const replySender = createStubReplySender();
  /**
   * Guardrails on an outbound reply — the second half of the prompt-injection
   * fix (`packages/engage/src/replyGuard.ts`). Fencing the classifier and
   * reply-writer prompts stops most injected text from being obeyed; this stops
   * whatever gets through from reaching someone's inbox. `engage.autohandle`
   * previously sent model-written text unattended with no check of any kind.
   */
  const replyGuardImpl = createReplyGuard();
  register(engageIngest);
  register(makeEngageClassify({ classifier: engageClassifier(devEngageClassifier()) }));
  register(engageEligibilityCheck);
  register(engageList);
  register(makeEngageReplyDraft({ writer: replyWriter(devReplyWriter()) }));
  register(makeEngageReplySend({ sender: replySender, guard: replyGuardImpl }));
  register(makeEngageAutohandle({ sender: replySender, guard: replyGuardImpl }));
  register(engageEscalate);
  register(engageTakeover);
  register(engageOpportunityCreate);
  register(engageOpportunityRoute);
  register(engageAuditQuery);
  register(engageThread);

  // Agent Timeline (§4.5): read-only. What SPARK did, and why — the surface
  // that makes autopublish something a user can reasonably agree to.
  // The kill switch (plan §4.4). `policy.ts` has denied paused agents since
  // P1; until these landed nothing could set the flag.
  register(agentStatus);
  register(agentPause);
  register(agentResume);
  // How loud the account is, as distinct from whether it runs at all.
  register(agentFrequencySet);
  // Reads the `why` back out of `tool_calls`. Until this, an explanation lived
  // exactly as long as the browser tab that received it.
  register(agentExplain);

  // The other half of the Command Center: what SPARK says to the owner
  // (plan §3.2 `human.*`). `human.ask` parks a run on a person; `human.notify`
  // does not. Conflating them is how an inbox becomes unread.
  register(humanAsk);
  register(humanNotify);
  register(humanPending);
  register(humanAnswer);

  // The channel those messages travel on. `whatsapp.receive` is the alpha's
  // one untrusted-input boundary — see the header of `capture/src/whatsapp.ts`.
  register(makeWhatsappSend({ transport }));
  register(makeWhatsappReceive());

  register(agentRunList);
  register(agentRunGet);
}

/**
 * Azure Blob when the account is configured, real local-disk storage
 * otherwise — see `@sparksocial/storage`'s `local.ts`. The sandbox cannot
 * reach Azure (CLAUDE.md), so the local store is what local development and
 * the test suite exercise; the SAS signing path needs a real account and is
 * smoke-tested from a developer machine after `infra/azure/bootstrap.sh`.
 *
 * Memoized rather than constructed fresh per call: every call site shares one
 * `dir`/`publicBaseUrl`, and `index.ts` needs this exact instance too, to
 * mount the routes its URLs point at (`registerLocalStorageRoutes` — a local
 * disk store's URLs are dead without them, unlike the old in-memory stub's
 * fake-but-harmless ones).
 */
let localStore: LocalDiskBlobStore | undefined;

function localPublicBaseUrl(): string {
  return envStr('LOCAL_STORAGE_PUBLIC_URL', `http://localhost:${envNum('PORT', 8080)}`);
}

function localBlobStore(): LocalDiskBlobStore {
  if (!localStore) {
    localStore = createLocalDiskBlobStore({
      dir: envStr('LOCAL_STORAGE_DIR', join(process.cwd(), '.local-storage')),
      publicBaseUrl: localPublicBaseUrl(),
    });
  }
  return localStore;
}

/**
 * Every `readUrl` local-disk storage hands out starts with this — the one
 * value `asset.ingest_url` (`trustedLocalUrlPrefix`) and the caption client
 * (`localUrlPrefix`) both need to recognise "this is our own local storage,
 * read it off disk" rather than treating it as a public URL to fetch.
 */
function localUrlPrefix(): string {
  return `${localPublicBaseUrl()}${LOCAL_STORAGE_ROUTE_PREFIX}/`;
}

function blobStore(): BlobStore {
  if (!envSet('AZURE_STORAGE_ACCOUNT')) return localBlobStore();
  const account = envStr('AZURE_STORAGE_ACCOUNT', '');
  return createAzureBlobStore({ account, container: envStr('AZURE_STORAGE_CONTAINER', 'assets') });
}

/**
 * Exposed so `index.ts` can mount the PUT/GET routes a local-disk store's
 * URLs point at. `undefined` when Azure is configured — those URLs are real
 * Blob Storage SAS links and need no local route.
 */
export function localBlobStoreForRoutes(): LocalDiskBlobStore | undefined {
  return envSet('AZURE_STORAGE_ACCOUNT') ? undefined : localBlobStore();
}

/**
 * One runner for the process lifetime, not one per call — `createRemotionRunner`
 * memoizes the Remotion bundle internally, and that cache is only worth having
 * if the same instance survives across renders. `register()` runs once at
 * startup, so closing over a single call here is enough.
 */
function remotionRunner() {
  const store = blobStore();
  return createRemotionRunner({
    async publish(localPath, kind) {
      const bytes = await readFile(localPath);
      const contentType = kind === 'video' ? 'video/mp4' : 'image/png';
      const ext = kind === 'video' ? 'mp4' : 'png';
      // Flat `renders/` key, same reasoning as `voice-client.ts`'s generated
      // audio: this is a produced artifact referenced from a `renders` row,
      // not a brand asset needing the Asset Graph's rights/reuse key layout.
      const { url } = await store.put({ key: `renders/${randomUUID()}.${ext}`, contentType, bytes });
      return url;
    },
  });
}

/** Same shape as `remotionRunner()` above, one instance for the process lifetime so the loaded font is cached, not re-read per render. */
function satoriRunner() {
  const store = blobStore();
  return createSatoriRunner({
    async publish(buffer, _kind) {
      const { url } = await store.put({ key: `renders/${randomUUID()}.png`, contentType: 'image/png', bytes: buffer });
      return url;
    },
  });
}

/**
 * The Review queue (PRD §7.5). Registered separately because `approval.decide`
 * needs an executor that only `index.ts` can build — it replays a held call
 * through the same `invokeDeps` the rest of the API uses, and those are
 * assembled after the registry.
 */
export function registerApprovalTools(
  execute: (args: { callId: string; grantedBy: string; ctx: unknown }) => Promise<InvokeResult>,
): void {
  register(queueReviewList);
  register(makeApprovalDecide({ execute }));
}

/**
 * `org.*`/`brand.*`/`team.*`/`whitelabel.*` (plan §6.9, §12 P6). Registered
 * separately, after `registerAlphaTools()`, because these need `credits`
 * (kept off `ScopedDb` on purpose — see `CreditStore.grant`'s own comment)
 * and, for `team.invite`/`team.role.set`, a real Clerk client — both are only
 * available once `index.ts` has finished its own setup, the same reason
 * `registerApprovalTools` is separate.
 *
 * `clerk` is optional: without it, `team.invite`/`team.role.set` are not
 * registered at all — the same "unset vendor key → not registered" rule as
 * `makeAnalyticsSync`/`makeLinkShorten`, since both are real calls against
 * Clerk's org-membership API, not something with an honest local fallback.
 */
export function registerAgencyTools(deps: {
  credits: CreditStore;
  clerk?: ClerkClient;
  canvaOAuth?: { clientId: string; redirectUri: string; stateSecret: string };
  socialOAuth?: { clientIds: Partial<Record<Platform, string>>; redirectUri: string; stateSecret: string };
}): void {
  register(orgCreate);
  register(orgGovernanceSet);
  register(orgBillingPlanSet);
  register(orgSecuritySsoConfigure);
  register(orgAuditQuery);
  register(makeOrgCreditsGrant(deps.credits));
  // PRD §8.12's "usage slice and alerts", and §12's "what consumes credits"
  // open question. The ledger has been real since P1 and had no reader: a
  // balance only ever came back from `org.credits.grant`, so rendering a usage
  // panel meant granting credits to display a number.
  register(makeOrgUsageGet({ credits: deps.credits }));

  register(brandCreate);
  register(brandSettingsPatch);
  // PRD §8.2 ONB-03 / §8.12 SET-WS-01 / §9 — restricted topics, claims to
  // avoid, strict mode, voice sliders, brand kit, timezone, posting windows.
  // None of this existed in any layer before now, which left §9's whole
  // guardrail-enforcement section with nothing to enforce and every post
  // firing at the instant its campaign happened to be created.
  register(brandGovernanceGet);
  register(brandGovernanceSet);
  register(makeBrandKnowledgeAttach(embedClient()));
  register(brandExport);
  register(brandImport);

  if (deps.clerk) {
    register(makeTeamInvite({ clerk: deps.clerk }));
    register(makeTeamRoleSet({ clerk: deps.clerk }));
    // The read, gated on the same client as the writes: without Clerk there is
    // no membership list to join brand assignments against, and a team screen
    // showing only `brand_members` rows would omit every member who has none.
    register(makeTeamList({ clerk: deps.clerk }));
  }
  register(teamPermissionSet);

  register(whitelabelLinkCreate);

  // Canva OAuth (bulk_connector's canva source). `brand.oauth.connect` needs
  // an app registration to mint an authorize URL against — unset →
  // not registered, same "unset vendor key → not registered" rule as
  // `team.invite` above. `.status`/`.disconnect` need no vendor config (they
  // only read/clear what was already saved), so they're always registered.
  register(brandOAuthStatus);
  register(brandOAuthDisconnect);
  if (deps.canvaOAuth) register(makeBrandOAuthConnect(deps.canvaOAuth));

  // Social OAuth (the five native publishing platforms). Same gating as
  // Canva's: `integration.connect` needs a signing secret and at least the
  // *possibility* of a configured platform to mint anything meaningful —
  // unset → not registered. Individual platforms within it degrade
  // per-call (`makeIntegrationConnect`'s own handler refuses a specific
  // provider with no client id), so this only gates on the shared secret
  // being present at all.
  if (deps.socialOAuth) register(makeIntegrationConnect(deps.socialOAuth));
}
