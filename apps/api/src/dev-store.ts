import type { ScopedDb } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import type { Genome } from '@sparksocial/shared';

/**
 * DEVELOPMENT STORE — in-memory, seeded with the golden set.
 *
 * Stands in for `@sparksocial/db` until Postgres is wired. Seeding it with the
 * §13 golden cases is deliberate: it means the running API can be driven through
 * the same three businesses the acceptance eval asserts on, so a manual poke at
 * `/v1/tools/playbook.resolve` and the CI suite are looking at the same fixtures.
 *
 * Every accessor takes `orgId` and filters on it, mirroring the scoped layer's
 * shape — a dev store that ignored tenancy would train the wrong habits into
 * every handler written against it.
 */

interface Row {
  genome: Genome;
  orgId: string;
  assets: Record<string, number>;
}

export function createDevStore(orgId = 'org_dev'): ScopedDb & { seedCount: number } {
  const rows = new Map<string, Row>();

  for (const c of GOLDEN_SET) {
    rows.set(c.genome.genome_id, {
      genome: c.genome,
      orgId,
      assets: { ...c.assets } as Record<string, number>,
    });
  }

  let nextDraft = 1;

  return {
    seedCount: rows.size,

    genomes: {
      async createDraft({ orgId: org }) {
        const id = `gen_draft_${nextDraft++}`;
        // A draft carries no dimensions yet — onboarding fills them in via
        // genome.dimensions.set, which is exactly the ONB-02 → ONB-03 handoff.
        const seed = GOLDEN_SET[0]!.genome;
        rows.set(id, { genome: { ...seed, genome_id: id, version: 1 }, orgId: org, assets: {} });
        return { id };
      },

      async patchDimensions({ genomeId, orgId: org, dimensions, avatarEnabled }) {
        const row = rows.get(genomeId);
        if (!row || row.orgId !== org) return { id: genomeId, version: 1 };
        row.genome = {
          ...row.genome,
          version: row.genome.version + 1,
          dimensions: dimensions as Genome['dimensions'],
          constraints: { ...row.genome.constraints, avatar_enabled: avatarEnabled },
        };
        return { id: genomeId, version: row.genome.version };
      },

      async get(genomeId, org) {
        const row = rows.get(genomeId);
        // Scope mismatch reads as "not found", never as someone else's genome.
        return row && row.orgId === org ? row.genome : undefined;
      },
    },

    assets: {
      async inventory(genomeId, org) {
        const row = rows.get(genomeId);
        return row && row.orgId === org ? { ...row.assets } : {};
      },
    },
  };
}
