import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared/types';
import {
  Genome,
  GenomeAudience,
  GenomeConstraints,
  GenomeIdentity,
  GenomeLearned,
  GenomeOffer,
  GenomeVoice,
  type Genome as GenomeT,
} from '@sparksocial/shared/genome';
import { GenomeDimensions } from '@sparksocial/shared/types';
import type { ScopedDb } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { genomes } from './schema.js';

/**
 * `ScopedDb['genomes']` backed by Postgres — engine spec §3.2.
 *
 * A genome is looked up by its own id, which already pins it to one org — there
 * is no cross-genome genome query, so this table is deliberately **not** in
 * `SCOPED_TABLES` (`scoped.ts`); the isolation predicate exists to stop a query
 * over *many* rows from leaking across tenants, and a single-row lookup by
 * primary key plus an equality check on `orgId` needs no separate mechanism.
 *
 * `identity`/`dimensions`/`voice` arrive as `unknown` from the tool layer
 * (`ScopedDb`'s contract) and are validated here with the same Zod schemas that
 * define the type — a malformed inference result fails loudly on write rather
 * than being stored and discovered later by whatever reads it back.
 */
export function createGenomeRepository(db: Database): ScopedDb['genomes'] {
  return {
    async createDraft({ brandId, orgId, identity, dimensions, voice }) {
      const id = randomUUID();
      const row = {
        id,
        orgId,
        brandId,
        version: 1,
        identity: GenomeIdentity.parse(identity),
        dimensions: GenomeDimensions.parse(dimensions),
        voice: GenomeVoice.parse(voice),
        audience: GenomeAudience.parse({}),
        offer: GenomeOffer.parse({}),
        constraints: GenomeConstraints.parse({}),
        learned: GenomeLearned.parse({}),
      };
      await db.insert(genomes).values(row);
      return { id };
    },

    async patchDimensions({ genomeId, orgId, dimensions, avatarEnabled }) {
      // A single UPDATE that both bumps the version and merges the constraints
      // patch in SQL — reading the row first and writing it back would race a
      // concurrent patch (e.g. onboarding step 3 and step 4 landing together)
      // and silently drop whichever wrote second.
      const [updated] = await db
        .update(genomes)
        .set({
          version: sql`${genomes.version} + 1`,
          dimensions: GenomeDimensions.parse(dimensions),
          constraints: sql`jsonb_set(${genomes.constraints}, '{avatar_enabled}', ${JSON.stringify(avatarEnabled)}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(and(eq(genomes.id, genomeId), eq(genomes.orgId, orgId)))
        .returning({ id: genomes.id, version: genomes.version });

      if (!updated) {
        throw new ToolError('NOT_FOUND', `No genome ${genomeId} in org ${orgId}.`, { genomeId, orgId });
      }
      return updated;
    },

    async get(genomeId, orgId) {
      const [row] = await db
        .select()
        .from(genomes)
        .where(and(eq(genomes.id, genomeId), eq(genomes.orgId, orgId)))
        .limit(1);
      if (!row) return undefined;

      // Re-parse through the Genome schema on read too: it's what applies the
      // Zod `.default()`s to any JSONB shape that predates a field being added,
      // so a schema change doesn't require a backfill migration to keep old rows
      // readable.
      const candidate: GenomeT = {
        genome_id: row.id,
        workspace_id: row.brandId,
        version: row.version,
        identity: row.identity as GenomeT['identity'],
        dimensions: row.dimensions as GenomeT['dimensions'],
        voice: row.voice as GenomeT['voice'],
        audience: row.audience as GenomeT['audience'],
        offer: row.offer as GenomeT['offer'],
        constraints: row.constraints as GenomeT['constraints'],
        learned: row.learned as GenomeT['learned'],
      };
      return Genome.parse(candidate);
    },
  };
}
