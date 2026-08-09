import { randomUUID } from 'node:crypto';
import type { ScopedDb } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import type { AssetRole, Genome } from '@sparksocial/shared';
import { createDevRunStore, seedDevRuns, type DevRunStore } from './dev-runs.js';
import { createDevCampaignStore } from './dev-campaigns.js';
import { createDevBrandStore } from './dev-brands.js';
import type { BrandGovernanceStore, CampaignStore } from '@sparksocial/tools/defineTool';

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
 *
 * Assets are real rows, not static counts: `inventory()` is *computed* from
 * whatever `create()` has added, so `asset.ingest_url` followed by
 * `playbook.resolve` shows the new asset immediately, the same way Postgres
 * would. Retrieval mirrors `packages/db/src/scoped.ts::buildRetrieveQuery`'s
 * scoring in plain JS (cosine similarity minus a recency penalty minus a usage
 * penalty) — same formula, no SQL, because there is no database here to run it
 * against.
 */

interface GenomeRow {
  genome: Genome;
  orgId: string;
}

interface AssetRow {
  id: string;
  genomeId: string;
  orgId: string;
  role: AssetRole;
  mediaType: 'image' | 'video' | 'audio';
  rightsStatus: 'cleared' | 'pending' | 'restricted';
  caption: string;
  embedding: number[];
  usageCount: number;
  lastUsedAt: Date | null;
  source: string;
}

interface ContentRow {
  genomeId: string;
  orgId: string;
  isAvatarFormat: boolean;
  embedding: number[] | null;
  publishedAt: Date;
}

/** Exported so dev-vendors.ts's fake embed client produces compatible vectors. */
export const EMBED_DIM = 8;

/** Deterministic pseudo-embedding so seeded rows retrieve consistently across runs. */
export function deterministicEmbedding(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < EMBED_DIM; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push((h % 2000) / 1000 - 1); // [-1, 1]
  }
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mirrors buildRetrieveQuery's SQL — same shape, computed in JS against the Map. */
function score(a: AssetRow, queryEmbedding: number[], now: Date, cooldownDays = 21): number {
  const similarity = cosineSimilarity(a.embedding, queryEmbedding);
  const recencyPenalty = a.lastUsedAt
    ? Math.max(0, 1 - (now.getTime() - a.lastUsedAt.getTime()) / (86_400_000 * cooldownDays)) * 0.5
    : 0;
  const diversityPenalty = Math.min(a.usageCount * 0.03, 0.3);
  return similarity - recencyPenalty - diversityPenalty;
}

export function createDevStore(
  orgId = 'org_dev',
  /**
   * The run store is injected rather than created here because the *recorder*
   * half of it belongs to the agent endpoint, and both halves must be the same
   * arrays — a timeline reading a different store than the loop writes to would
   * always render empty. Defaulting keeps existing callers unchanged.
   */
  runStore: DevRunStore = createDevRunStore(),
  campaignStore: CampaignStore = createDevCampaignStore(),
  brandStore: BrandGovernanceStore = createDevBrandStore(),
): ScopedDb & { seedCount: number; runs: ScopedDb['runs'] } {
  const genomes = new Map<string, GenomeRow>();
  const assets = new Map<string, AssetRow>();
  const content: ContentRow[] = [];

  for (const c of GOLDEN_SET) {
    genomes.set(c.genome.genome_id, { genome: c.genome, orgId });

    // Synthesize one row per unit of the golden case's role counts, so
    // inventory() reflects real rows from the start rather than a shortcut map.
    for (const [role, count] of Object.entries(c.assets)) {
      for (let i = 0; i < (count as number); i++) {
        const id = `${c.genome.genome_id}_${role}_${i}`;
        assets.set(id, {
          id,
          genomeId: c.genome.genome_id,
          orgId,
          role: role as AssetRole,
          mediaType: 'image',
          rightsStatus: 'cleared',
          caption: `${role.replace(/_/g, ' ')} for ${c.genome.identity.business_name}`,
          embedding: deterministicEmbedding(id),
          usageCount: 0,
          lastUsedAt: null,
          source: 'golden_seed',
        });
      }
    }
  }

  // Seed a little publishing history so avatar_saturation and duplicate have
  // something real to evaluate against, rather than always trivially passing
  // on an empty window.
  const freelancer = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_freelancer');
  if (freelancer) {
    const now = Date.now();
    // 3 avatar-format posts already in the trailing 30 days — one more avatar
    // post would put this genome at 4-of-5 (80%), well over the 30% cap.
    for (let i = 0; i < 3; i++) {
      content.push({
        genomeId: freelancer.genome.genome_id,
        orgId,
        isAvatarFormat: true,
        embedding: deterministicEmbedding(`freelancer_avatar_${i}`),
        publishedAt: new Date(now - i * 86_400_000),
      });
    }
  }
  const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber');
  if (barber) {
    // A published post whose embedding the demo can deliberately restate, to
    // show the duplicate guardrail actually firing rather than always passing.
    content.push({
      genomeId: barber.genome.genome_id,
      orgId,
      isAvatarFormat: false,
      embedding: deterministicEmbedding('the fade finishing, up close, no talking'),
      publishedAt: new Date(),
    });
  }

  // A little run history, for the same reason the golden set is seeded above:
  // the Agent Timeline is a P1 deliverable and needs to be reviewable without
  // an ANTHROPIC_API_KEY. These are obviously synthetic — one succeeded, one
  // failed, one still running — so the three states the UI must handle are all
  // reachable locally. Postgres seeds nothing; there, runs only exist if the
  // agent made them.
  seedDevRuns(runStore, GOLDEN_SET.map((c) => c.genome.workspace_id));

  let nextDraft = 1;

  return {
    seedCount: genomes.size,

    genomes: {
      async createDraft({ orgId: org }) {
        const id = `gen_draft_${nextDraft++}`;
        // A draft carries no dimensions yet — onboarding fills them in via
        // genome.dimensions.set, which is exactly the ONB-02 → ONB-03 handoff.
        const seed = GOLDEN_SET[0]!.genome;
        genomes.set(id, { genome: { ...seed, genome_id: id, version: 1 }, orgId: org });
        return { id };
      },

      async patchDimensions({ genomeId, orgId: org, dimensions, avatarEnabled }) {
        const row = genomes.get(genomeId);
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
        const row = genomes.get(genomeId);
        // Scope mismatch reads as "not found", never as someone else's genome.
        return row && row.orgId === org ? row.genome : undefined;
      },

      async listForOrg(org) {
        return [...genomes.entries()]
          .filter(([, row]) => row.orgId === org)
          .map(([id, row]) => ({
            id,
            brandId: row.genome.workspace_id,
            name: row.genome.identity.business_name,
            updatedAt: new Date(),
          }));
      },
    },

    assets: {
      async inventory(genomeId, org) {
        const counts: Partial<Record<AssetRole, number>> = {};
        for (const a of assets.values()) {
          if (a.genomeId !== genomeId || a.orgId !== org || a.rightsStatus !== 'cleared') continue;
          counts[a.role] = (counts[a.role] ?? 0) + 1;
        }
        return counts;
      },

      async retrieve({ genomeId, orgId: org, embedding, requiredRoles, k }) {
        const now = new Date();
        const pool = [...assets.values()].filter(
          (a) =>
            a.genomeId === genomeId &&
            a.orgId === org &&
            a.rightsStatus === 'cleared' &&
            (!requiredRoles?.length || requiredRoles.includes(a.role)),
        );
        return pool
          .map((a) => ({
            assetId: a.id,
            role: a.role,
            caption: a.caption,
            score: score(a, embedding, now),
            usageCount: a.usageCount,
            lastUsedAt: a.lastUsedAt,
            rightsStatus: a.rightsStatus,
          }))
          .sort((x, y) => y.score - x.score)
          .slice(0, k);
      },

      async create({ genomeId, orgId: org, assetRole, mediaType, rightsStatus, caption, embedding, source }) {
        const id = randomUUID();
        assets.set(id, {
          id,
          genomeId,
          orgId: org,
          role: assetRole,
          mediaType,
          rightsStatus,
          caption,
          embedding,
          usageCount: 0,
          lastUsedAt: null,
          source,
        });
        return { id };
      },

      async captionsByRole(genomeId, org, roles) {
        return [...assets.values()]
          .filter((a) => a.genomeId === genomeId && a.orgId === org && roles.includes(a.role))
          .map((a) => a.caption);
      },

      async info(ids, genomeId, org) {
        const now = Date.now();
        const out: Record<string, { rightsStatus: string; lastUsedDaysAgo?: number }> = {};
        for (const id of ids) {
          const a = assets.get(id);
          if (!a || a.genomeId !== genomeId || a.orgId !== org) continue;
          out[id] = {
            rightsStatus: a.rightsStatus,
            lastUsedDaysAgo: a.lastUsedAt ? (now - a.lastUsedAt.getTime()) / 86_400_000 : undefined,
          };
        }
        return out;
      },
    },

    content: {
      async recent(genomeId, org, windowDays) {
        const cutoff = Date.now() - windowDays * 86_400_000;
        return content
          .filter((c) => c.genomeId === genomeId && c.orgId === org && c.publishedAt.getTime() >= cutoff)
          .map((c) => ({ isAvatarFormat: c.isAvatarFormat, embedding: c.embedding }));
      },
    },

    campaigns: campaignStore,
    brands: brandStore,
    runs: runStore.reader,
  };
}
