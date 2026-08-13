import { register } from '@sparksocial/tools';
import { makeGenomeBootstrap } from '@sparksocial/genome/bootstrap';
import { genomeDimensionsSet } from '@sparksocial/genome/dimensions';
import { genomeCreate } from '@sparksocial/genome/create';
import { genomeList } from '@sparksocial/genome/list';
import { playbookResolve } from '@sparksocial/playbooks/tools';
import { makeAssetRetrieve, assetGaps, makeAssetIngestUrl, makeAssetUploadUrl } from '@sparksocial/assetgraph';
import { createAzureBlobStore, createMemoryBlobStore, type BlobStore } from '@sparksocial/storage';
import {
  makeBriefGenerate,
  makeSessionBatch,
  makeSessionSend,
  fallbackDegrade,
  createStubTransport,
  makeWhatsappSend,
  makeWhatsappReceive,
} from '@sparksocial/capture';
import { makeEvaluateDraft } from '@sparksocial/guardrails';
import { makeMediaIngest } from '@sparksocial/finish';
import { makeAssemblePlan } from '@sparksocial/assemble';
import {
  campaignProposePlan,
  campaignCreate,
  calendarGenerate,
  calendarGet,
  approvalGet,
  approvalSet,
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
import { makeApprovalDecide, queueReviewList, type InvokeResult } from '@sparksocial/tools';
import { createStubAdapter, makePublishNow, makePublishStatus } from '@sparksocial/publish';
import { createStubTrendSource, makeTrendRank } from '@sparksocial/trends';
import { devBriefWriter, devMediaIngestDeps, devInferenceClient } from './dev-vendors.js';
import { anthropicInferenceClient } from './inference-client.js';
import { buildRateLimiter } from './rate-limiter.js';
import { embedClient } from './embed-client.js';
import { captionClient } from './caption-client.js';
import { briefWriter } from './brief-writer.js';
import { createFfmpegRunner } from './ffmpeg-runner.js';
import { envSet, envStr } from './env.js';

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
  if (envSet('ANTHROPIC_API_KEY')) return anthropicInferenceClient();
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
   * the messages that were sent.
   */
  const transport = createStubTransport();

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
  // Reads before a genome is selected — the brand switcher's source.
  register(genomeList);

  // Campaign (§6.8): outcome in, a plan and an honest gap report out.
  register(campaignProposePlan);
  register(campaignCreate);

  // Calendar (§6.8 Step 4, CAL-01→CAL-06): reviewed at mix level, not post by post.
  register(calendarGenerate);
  register(calendarGet);

  // Approval ladder (§6.8 Step 5, PRD §7.1): the policy engine has always
  // implemented all three rungs; these are what let a brand be on one.
  register(approvalGet);
  register(approvalSet);

  // Content engine: rank what this brand can actually make.
  register(playbookResolve);

  // Asset Graph (§4): grow it, query it, know what it's missing.
  register(makeAssetUploadUrl(blobStore()));
  register(makeAssetIngestUrl({ ...captionClient(), ...embed }));
  register(makeAssetRetrieve(embed));
  register(assetGaps);

  // Assemble (§6.5): build a post from what the brand already owns. The
  // highest-value path for SaaS, agency, freelancer and e-commerce.
  register(makeAssemblePlan(embed));

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
   * real now is the *render*: `createFfmpegRunner` executes the filtergraphs
   * that `pipeline.ts` has been building and discarding since P2.
   */
  register(makeMediaIngest({ ...devMediaIngestDeps(), ...createFfmpegRunner() }));

  // Publishing (§8, P4): one PlatformAdapter, aggregator-first. Native
  // adapters are prepended as approvals clear — LinkedIn will not clear by
  // Aug 29, which is exactly why the aggregator ships first.
  const adapters = [createStubAdapter({ name: 'aggregator:stub' })];
  // One limiter, shared by both tools. Two would let `publish.status` report a
  // budget that `publish.now` does not enforce — a health panel that disagrees
  // with reality is worse than no health panel.
  const limiter = buildRateLimiter();
  register(makePublishNow({ adapters, limiter }));
  register(makePublishStatus({ adapters, limiter }));

  // Trend discovery (§8.9, DISC-01). Ranked on what is LEFT of a trend, not
  // its size — the source behind this is a credential-gated seam.
  register(makeTrendRank(createStubTrendSource()));

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
 * Azure Blob when the account is configured, in-memory otherwise. The sandbox
 * cannot reach Azure (CLAUDE.md), so the memory store is what local development
 * and the test suite exercise; the SAS signing path needs a real account and is
 * smoke-tested from a developer machine after `infra/azure/bootstrap.sh`.
 */
function blobStore(): BlobStore {
  if (!envSet('AZURE_STORAGE_ACCOUNT')) return createMemoryBlobStore();
  const account = envStr('AZURE_STORAGE_ACCOUNT', '');
  return createAzureBlobStore({ account, container: envStr('AZURE_STORAGE_CONTAINER', 'assets') });
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
