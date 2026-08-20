import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { createGenomeRepository } from './genomeRepository.js';
import { createAssetRepository } from './assetRepository.js';
import { createAssetFolderRepository } from './assetFolderRepository.js';
import { createContentRepository } from './contentRepository.js';
import { createAnalyticsRepository } from './analyticsRepository.js';
import { createMetricsRepository } from './metricsRepository.js';
import { createEngagementRepository } from './engagementRepository.js';
import { createOpportunityRepository } from './opportunityRepository.js';
import { createRunReadRepository } from './runRecorderRepository.js';
import { createCampaignRepository } from './campaignRepository.js';
import { createApprovalRepository } from './approvalRepository.js';
import { createBrandRepository } from './brandRepository.js';
import { createHumanLoopRepository } from './humanLoopRepository.js';
import { createConsentRepository } from './consentRepository.js';
import { createToolCallReadRepository } from './toolCallReadRepository.js';
import { createTrendRepository } from './trendRepository.js';
import { createLearningRepository } from './learningRepository.js';
import { createRecipeRepository } from './recipeRepository.js';
import { createOAuthConnectionRepository } from './oauthConnectionRepository.js';
import { createOrgSettingsRepository } from './orgSettingsRepository.js';
import { createBrandMemberRepository, createReviewLinkRepository } from './agencyRepository.js';
import { createKnowledgeRepository } from './knowledgeRepository.js';
import { createCtaLinkRepository } from './ctaLinkRepository.js';

/** The real `ScopedDb`, assembled from the Postgres-backed repositories. */
export function createPostgresScopedDb(db: Database): ScopedDb {
  return {
    genomes: createGenomeRepository(db),
    assets: createAssetRepository(db),
    assetFolders: createAssetFolderRepository(db),
    content: createContentRepository(db),
    analytics: createAnalyticsRepository(db),
    metrics: createMetricsRepository(db),
    ctaLinks: createCtaLinkRepository(db),
    engagement: createEngagementRepository(db),
    opportunities: createOpportunityRepository(db),
    campaigns: createCampaignRepository(db),
    trends: createTrendRepository(db),
    learning: createLearningRepository(db),
    recipes: createRecipeRepository(db),
    oauthConnections: createOAuthConnectionRepository(db),
    knowledge: createKnowledgeRepository(db),
    orgSettings: createOrgSettingsRepository(db),
    brandMembers: createBrandMemberRepository(db),
    reviewLinks: createReviewLinkRepository(db),
    approvals: createApprovalRepository(db),
    brands: createBrandRepository(db),
    humanLoop: createHumanLoopRepository(db),
    consent: createConsentRepository(db),
    toolCalls: createToolCallReadRepository(db),
    runs: createRunReadRepository(db),
  };
}
