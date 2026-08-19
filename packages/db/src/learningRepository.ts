import type { LearningStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/** `learning_arms` / `learning_outcomes` backed by Postgres — the learning loop's storage (plan §6.7). Genome-scoped: which pillars are winning for a specific client is competitive detail. */
export function createLearningRepository(db: Database): LearningStore {
  return {
    async list(genomeId, orgId) {
      const rows = await scoped.listLearningArms(db, { orgId, brandId: orgId, genomeId });
      return rows.map(toArm);
    },

    async recordOutcome({ genomeId, orgId, contentItemId, pillar, reward }) {
      const { recorded, arm } = await scoped.recordLearningOutcome(
        db,
        { orgId, brandId: orgId, genomeId },
        { contentItemId, pillar, reward },
      );
      return { recorded, arm: toArm(arm) };
    },

    async reset(genomeId, orgId) {
      await scoped.resetLearning(db, { orgId, brandId: orgId, genomeId });
    },
  };
}

function toArm(row: scoped.LearningArmRow) {
  return { pillar: row.pillar, alpha: row.alpha, beta: row.beta, observations: row.observations, updatedAt: row.updatedAt };
}
