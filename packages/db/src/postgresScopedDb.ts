import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { createGenomeRepository } from './genomeRepository.js';
import { createAssetRepository } from './assetRepository.js';
import { createContentRepository } from './contentRepository.js';
import { createRunReadRepository } from './runRecorderRepository.js';
import { createCampaignRepository } from './campaignRepository.js';
import { createBrandRepository } from './brandRepository.js';

/** The real `ScopedDb`, assembled from the Postgres-backed repositories. */
export function createPostgresScopedDb(db: Database): ScopedDb {
  return {
    genomes: createGenomeRepository(db),
    assets: createAssetRepository(db),
    content: createContentRepository(db),
    campaigns: createCampaignRepository(db),
    brands: createBrandRepository(db),
    runs: createRunReadRepository(db),
  };
}
