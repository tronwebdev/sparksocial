import { register } from '@sparksocial/tools';
import { makeGenomeBootstrap } from '@sparksocial/genome/bootstrap';
import { genomeDimensionsSet } from '@sparksocial/genome/dimensions';
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
} from '@sparksocial/campaign';
import { agentRunGet, agentRunList } from '@sparksocial/spark';
import { makeApprovalDecide, queueReviewList, type InvokeResult } from '@sparksocial/tools';
import { createStubAdapter, makePublishNow, makePublishStatus } from '@sparksocial/publish';
import { createStubTrendSource, makeTrendRank } from '@sparksocial/trends';
import { devCaptionClient, devEmbedClient, devBriefWriter, devMediaIngestDeps, devInferenceClient } from './dev-vendors.js';

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
  // ONB-01 → ONB-06: the five-question onboarding.
  register(makeGenomeBootstrap({ infer: devInferenceClient() }));
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
  register(makeAssetIngestUrl({ ...devCaptionClient(), ...devEmbedClient() }));
  register(makeAssetRetrieve(devEmbedClient()));
  register(assetGaps);

  // Assemble (§6.5): build a post from what the brand already owns. The
  // highest-value path for SaaS, agency, freelancer and e-commerce.
  register(makeAssemblePlan(devEmbedClient()));

  // Capture loop (§6.2, §6.3): the moat.
  register(makeBriefGenerate(devBriefWriter()));
  register(makeSessionBatch(devBriefWriter()));
  // The last hop. Stubbed until Meta business verification clears (plan §8) —
  // the seam is real, only the WhatsApp client behind it is not.
  register(makeSessionSend(createStubTransport()));
  // "Fallbacks are mandatory" (§6.5): a missed week must not empty the calendar.
  register(fallbackDegrade);

  // Guardrails (§10): report every check on a draft before it can be scheduled.
  register(makeEvaluateDraft(devEmbedClient()));

  // Finish pipeline (§6.3): raw phone footage in, publishable clips out.
  register(makeMediaIngest(devMediaIngestDeps()));

  // Publishing (§8, P4): one PlatformAdapter, aggregator-first. Native
  // adapters are prepended as approvals clear — LinkedIn will not clear by
  // Aug 29, which is exactly why the aggregator ships first.
  const adapters = [createStubAdapter({ name: 'aggregator:stub' })];
  register(makePublishNow({ adapters }));
  register(makePublishStatus({ adapters }));

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
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) return createMemoryBlobStore();
  return createAzureBlobStore({ account, container: process.env.AZURE_STORAGE_CONTAINER ?? 'assets' });
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
