import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { createGenomeRepository } from './genomeRepository.js';
import { createAssetRepository } from './assetRepository.js';
import { createContentRepository } from './contentRepository.js';

/** The real `ScopedDb`, assembled from the three Postgres-backed repositories. */
export function createPostgresScopedDb(db: Database): ScopedDb {
  return {
    genomes: createGenomeRepository(db),
    assets: createAssetRepository(db),
    content: createContentRepository(db),
  };
}
