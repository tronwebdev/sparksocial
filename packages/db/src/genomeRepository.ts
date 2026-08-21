import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared/types';
import {
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
 * `GenomeVoice.tone_vector` is required with no `.default()` — unlike
 * `dimensions`, there is no `patchVoice` in `ScopedDb['genomes']` to complete
 * it later, so an absent tone_vector at `createDraft` time has nowhere else
 * to come from. Neutral (all axes at 0.5) rather than borrowed from anywhere
 * else, and merged under whatever the caller did supply.
 */
const NEUTRAL_TONE_VECTOR = { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 };

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
        // A draft's dimensions are legitimately incomplete at this point —
        // `genome.create` sends `{}` on purpose (see its own comment: "empty,
        // not guessed") because onboarding hasn't asked the four routing
        // questions yet. The strict, all-required `GenomeDimensions` is what
        // `genome.dimensions.set`/`patchDimensions` writes once onboarding
        // finishes; validating a brand-new draft against it here rejected the
        // exact input `genome.create` and `genome.bootstrap_from_url` are
        // designed to send.
        dimensions: GenomeDimensions.partial().parse(dimensions) as GenomeT['dimensions'],
        voice: GenomeVoice.parse({
          ...(voice as Record<string, unknown> | undefined),
          tone_vector: { ...NEUTRAL_TONE_VECTOR, ...(voice as { tone_vector?: object } | undefined)?.tone_vector },
        }),
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

    async patchConstraints({ genomeId, orgId, patch }) {
      // Same single-UPDATE merge as patchDimensions, for the same reason:
      // reading-then-writing constraints would race a concurrent patch (this
      // field and, say, `approval_mode` landing together) and drop one.
      // Chained rather than one jsonb_set per call, since either field may be
      // absent and an empty patch would otherwise reduce to a no-op UPDATE.
      let constraints = sql`${genomes.constraints}`;
      if (patch.heygenAvatarId !== undefined) {
        constraints = sql`jsonb_set(${constraints}, '{heygen_avatar_id}', ${JSON.stringify(patch.heygenAvatarId)}::jsonb)`;
      }
      if (patch.elevenlabsVoiceId !== undefined) {
        constraints = sql`jsonb_set(${constraints}, '{elevenlabs_voice_id}', ${JSON.stringify(patch.elevenlabsVoiceId)}::jsonb)`;
      }
      if (patch.complianceProfile !== undefined) {
        constraints = sql`jsonb_set(${constraints}, '{compliance_profile}', ${JSON.stringify(patch.complianceProfile)}::jsonb)`;
      }
      if (patch.avatarEnabled !== undefined) {
        constraints = sql`jsonb_set(${constraints}, '{avatar_enabled}', ${JSON.stringify(patch.avatarEnabled)}::jsonb)`;
      }
      if (patch.avatarOverride !== undefined) {
        const value = patch.avatarOverride
          ? { reason: patch.avatarOverride.reason, set_by: patch.avatarOverride.setBy, set_at: patch.avatarOverride.setAt }
          : null;
        constraints = sql`jsonb_set(${constraints}, '{avatar_override}', ${JSON.stringify(value)}::jsonb)`;
      }

      const [updated] = await db
        .update(genomes)
        .set({ version: sql`${genomes.version} + 1`, constraints, updatedAt: new Date() })
        .where(and(eq(genomes.id, genomeId), eq(genomes.orgId, orgId)))
        .returning({ id: genomes.id, version: genomes.version });

      if (!updated) {
        throw new ToolError('NOT_FOUND', `No genome ${genomeId} in org ${orgId}.`, { genomeId, orgId });
      }
      return updated;
    },

    async patchIdentity({ genomeId, orgId, identity }) {
      // Same single-UPDATE per-field jsonb_set merge as patchConstraints, for
      // the same reason: reading-then-writing identity would race a
      // concurrent patch (a second corrected chip landing while this one is
      // in flight) and silently drop one of them. Chained per supplied key
      // rather than replacing the whole column, since `identity` here is a
      // partial — only the fields a person actually corrected.
      let column = sql`${genomes.identity}`;
      for (const [key, value] of Object.entries(identity)) {
        if (value === undefined) continue;
        // The path argument to `jsonb_set` must be a real `text[]` array
        // literal, not a bound parameter — Postgres will not cast a plain
        // bound string to it. `key` is safe to splice into raw SQL because it
        // only ever reaches here already validated against `GenomeIdentity`'s
        // fixed key set by the tool's Zod schema (`.partial()` strips
        // anything else); the regex is a second, cheap backstop in case a
        // future caller reaches this method some other way.
        if (!/^[a-z_]+$/.test(key)) {
          throw new ToolError('INVALID_INPUT', `Unexpected identity field "${key}".`, { key });
        }
        column = sql`jsonb_set(${column}, ${sql.raw(`'{${key}}'`)}, ${JSON.stringify(value)}::jsonb)`;
      }

      const [updated] = await db
        .update(genomes)
        .set({ version: sql`${genomes.version} + 1`, identity: column, updatedAt: new Date() })
        .where(and(eq(genomes.id, genomeId), eq(genomes.orgId, orgId)))
        .returning({ id: genomes.id, version: genomes.version });

      if (!updated) {
        throw new ToolError('NOT_FOUND', `No genome ${genomeId} in org ${orgId}.`, { genomeId, orgId });
      }
      return updated;
    },

    async patchOffer({ genomeId, orgId, offer }) {
      // Same single-UPDATE per-field jsonb_set merge as patchIdentity, for
      // the same race-avoidance reason.
      let column = sql`${genomes.offer}`;
      for (const [key, value] of Object.entries(offer)) {
        if (value === undefined) continue;
        if (!/^[a-z_]+$/.test(key)) {
          throw new ToolError('INVALID_INPUT', `Unexpected offer field "${key}".`, { key });
        }
        column = sql`jsonb_set(${column}, ${sql.raw(`'{${key}}'`)}, ${JSON.stringify(value)}::jsonb)`;
      }

      const [updated] = await db
        .update(genomes)
        .set({ version: sql`${genomes.version} + 1`, offer: column, updatedAt: new Date() })
        .where(and(eq(genomes.id, genomeId), eq(genomes.orgId, orgId)))
        .returning({ id: genomes.id, version: genomes.version });

      if (!updated) {
        throw new ToolError('NOT_FOUND', `No genome ${genomeId} in org ${orgId}.`, { genomeId, orgId });
      }
      return updated;
    },

    async patchVoice({ genomeId, orgId, voice }) {
      // Same single-UPDATE per-field jsonb_set merge as patchOffer, for the same
      // race-avoidance reason: setting a point of view must not clobber a
      // tone_vector written a moment earlier by a different screen.
      let column = sql`${genomes.voice}`;
      for (const [key, value] of Object.entries(voice)) {
        if (value === undefined) continue;
        if (!/^[a-z_]+$/.test(key)) {
          throw new ToolError('INVALID_INPUT', `Unexpected voice field "${key}".`, { key });
        }
        column = sql`jsonb_set(${column}, ${sql.raw(`'{${key}}'`)}, ${JSON.stringify(value)}::jsonb)`;
      }

      const [updated] = await db
        .update(genomes)
        .set({ version: sql`${genomes.version} + 1`, voice: column, updatedAt: new Date() })
        .where(and(eq(genomes.id, genomeId), eq(genomes.orgId, orgId)))
        .returning({ id: genomes.id, version: genomes.version });

      if (!updated) {
        throw new ToolError('NOT_FOUND', `No genome ${genomeId} in org ${orgId}.`, { genomeId, orgId });
      }
      return updated;
    },

    async patchLearned({ genomeId, orgId, patch }) {
      // Same single-UPDATE per-field jsonb_set merge as patchOffer, for the
      // same race-avoidance reason — a confidence write from `learning.reweight`
      // landing at the same moment as some other genome edit must not clobber
      // either.
      let column = sql`${genomes.learned}`;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (!/^[a-z_]+$/.test(key)) {
          throw new ToolError('INVALID_INPUT', `Unexpected learned field "${key}".`, { key });
        }
        column = sql`jsonb_set(${column}, ${sql.raw(`'{${key}}'`)}, ${JSON.stringify(value)}::jsonb)`;
      }

      const [updated] = await db
        .update(genomes)
        .set({ version: sql`${genomes.version} + 1`, learned: column, updatedAt: new Date() })
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

      // Re-parse each field through its own schema on read too: it's what
      // applies the Zod `.default()`s to any JSONB shape that predates a
      // field being added, so a schema change doesn't require a backfill
      // migration to keep old rows readable. Field-by-field rather than one
      // whole-object `Genome.parse()`, because `dimensions` specifically must
      // stay tolerant of the same "unresolved until onboarding finishes"
      // shape `createDraft` is allowed to write — the strict `GenomeDimensions`
      // Genome.parse() used here would otherwise fail to read back a draft
      // genome nobody has answered the routing questions for yet.
      return {
        genome_id: row.id,
        workspace_id: row.brandId,
        version: row.version,
        identity: GenomeIdentity.parse(row.identity),
        dimensions: GenomeDimensions.partial().parse(row.dimensions) as GenomeT['dimensions'],
        voice: GenomeVoice.parse(row.voice),
        audience: GenomeAudience.parse(row.audience),
        offer: GenomeOffer.parse(row.offer),
        constraints: GenomeConstraints.parse(row.constraints),
        learned: GenomeLearned.parse(row.learned),
      };
    },

    async listForOrg(orgId) {
      const rows = await db
        .select({
          id: genomes.id,
          brandId: genomes.brandId,
          identity: genomes.identity,
          updatedAt: genomes.updatedAt,
        })
        .from(genomes)
        .where(eq(genomes.orgId, orgId))
        .orderBy(desc(genomes.updatedAt))
        .limit(100);

      // Only the display name is projected, not the whole genome: this feeds a
      // switcher, and shipping every org genome's full identity/voice/learned
      // payload to the client would leak far more than the list needs.
      return rows.map((r) => ({
        id: r.id,
        brandId: r.brandId,
        name: (r.identity as { business_name?: string } | null)?.business_name ?? 'Untitled brand',
        updatedAt: r.updatedAt,
      }));
    },
  };
}
