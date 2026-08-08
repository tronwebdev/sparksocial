import { register } from '@sparksocial/tools';
import { genomeBootstrapFromUrl } from '@sparksocial/genome/bootstrap';
import { genomeDimensionsSet } from '@sparksocial/genome/dimensions';
import { genomeList } from '@sparksocial/genome/list';
import { playbookResolve } from '@sparksocial/playbooks/tools';
import { makeAssetRetrieve, assetGaps, makeAssetIngestUrl, makeAssetUploadUrl } from '@sparksocial/assetgraph';
import { createAzureBlobStore, createMemoryBlobStore, type BlobStore } from '@sparksocial/storage';
import { makeBriefGenerate, makeSessionBatch } from '@sparksocial/capture';
import { makeEvaluateDraft } from '@sparksocial/guardrails';
import { makeMediaIngest } from '@sparksocial/finish';
import { devCaptionClient, devEmbedClient, devBriefWriter, devMediaIngestDeps } from './dev-vendors.js';

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
  register(genomeBootstrapFromUrl);
  register(genomeDimensionsSet);
  // Reads before a genome is selected — the brand switcher's source.
  register(genomeList);

  // Content engine: rank what this brand can actually make.
  register(playbookResolve);

  // Asset Graph (§4): grow it, query it, know what it's missing.
  register(makeAssetUploadUrl(blobStore()));
  register(makeAssetIngestUrl({ ...devCaptionClient(), ...devEmbedClient() }));
  register(makeAssetRetrieve(devEmbedClient()));
  register(assetGaps);

  // Capture loop (§6.2, §6.3): the moat.
  register(makeBriefGenerate(devBriefWriter()));
  register(makeSessionBatch(devBriefWriter()));

  // Guardrails (§10): report every check on a draft before it can be scheduled.
  register(makeEvaluateDraft(devEmbedClient()));

  // Finish pipeline (§6.3): raw phone footage in, publishable clips out.
  register(makeMediaIngest(devMediaIngestDeps()));
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
