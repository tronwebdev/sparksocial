import { register } from '@sparksocial/tools';
import { genomeBootstrapFromUrl } from '@sparksocial/genome/bootstrap';
import { genomeDimensionsSet } from '@sparksocial/genome/dimensions';
import { playbookResolve } from '@sparksocial/playbooks/tools';
import { makeAssetRetrieve, assetGaps, makeAssetIngestUrl } from '@sparksocial/assetgraph';
import { makeBriefGenerate, makeSessionBatch } from '@sparksocial/capture';
import { devCaptionClient, devEmbedClient, devBriefWriter } from './dev-vendors.js';

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

  // Content engine: rank what this brand can actually make.
  register(playbookResolve);

  // Asset Graph (§4): grow it, query it, know what it's missing.
  register(makeAssetIngestUrl({ ...devCaptionClient(), ...devEmbedClient() }));
  register(makeAssetRetrieve(devEmbedClient()));
  register(assetGaps);

  // Capture loop (§6.2, §6.3): the moat.
  register(makeBriefGenerate(devBriefWriter()));
  register(makeSessionBatch(devBriefWriter()));
}
