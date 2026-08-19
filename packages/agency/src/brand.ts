import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `brand.*` — the agency multi-tenancy entry points (plan §6.9, §12 P6).
 *
 * `brands`/`genomes` have carried `orgId` + a per-brand row since P0/P1 — an
 * org has never been limited to one brand at the schema level. What was
 * missing is `brand.create` itself: the single-brand onboarding flow
 * (`genome.bootstrap_from_url`/`genome.create`) conflates "set up my
 * business" with "set up my first brand," which is right for a direct
 * customer and wrong for an agency adding client #4. This file is the
 * agency's own entry point, separate from that flow.
 */

export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

/* ── brand.create ────────────────────────────────────────────────────── */

export const brandCreate = defineTool({
  name: 'brand.create',
  version: 1,

  summary:
    'Create a new brand (and its paired, empty genome) under this org — the agency path for adding a ' +
    "new client without leaving the workspace. Onboarding (the five-question flow) still fills in the " +
    'genome afterward; this only provisions the shell.',

  // Same required-field set as `genome.create` (packages/genome/src/create.ts)
  // — `GenomeIdentity` is validated in full on write, so a partial identity
  // throws a ZodError there rather than creating a half-formed genome. This
  // is the agency's version of that same "no website" entry point, so it
  // asks for the same minimum and defers everything else to onboarding the
  // same honest way `genome.create`'s own comment explains.
  input: z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(80),
    oneLiner: z.string().max(280).optional(),
    locale: z.string().min(2).max(12).default('en-US'),
  }),
  output: z.object({ brandId: z.string(), genomeId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  // Each call makes a new brand — a repeated call is a second client shell,
  // not a safe replay.
  idempotent: false,
  surfaces: ['ONB-01'],

  async handler(input, ctx) {
    const brandId = `brand_${randomUUID()}`;
    // Provisions the `brands` governance row (upsert-on-read, same as every
    // other first touch of a brand id).
    await ctx.db.brands.get(brandId, ctx.orgId, input.name);
    const genome = await ctx.db.genomes.createDraft({
      brandId,
      orgId: ctx.orgId,
      identity: {
        business_name: input.name,
        category: input.category,
        one_liner: input.oneLiner ?? '',
        geography: { scope: 'local', locale: input.locale, radius_km: null },
        languages: [input.locale.split('-')[0] ?? 'en'],
        // The schema requires a tier and nothing evidences one yet — same
        // "least consequential, onboarding corrects it" choice as
        // `genome.create`.
        price_tier: 'mid',
      },
      // Empty, not guessed — every routing dimension stays unresolved until
      // onboarding answers it, same as `genome.create`.
      dimensions: {},
      voice: {},
      source: 'user',
    });
    ctx.logger.info('brand created', { orgId: ctx.orgId, brandId, genomeId: genome.id });
    return { brandId, genomeId: genome.id, name: input.name };
  },
});

/* ── brand.settings.patch ────────────────────────────────────────────── */

export const brandSettingsPatch = defineTool({
  name: 'brand.settings.patch',
  version: 1,

  summary:
    'Rename a brand. Approval mode, pause state, and posting frequency have their own dedicated tools ' +
    '(approval.set, agent.pause, agent.frequency.set) — this is deliberately narrow rather than a second, ' +
    'overlapping way to set the same fields.',

  input: z.object({ brandId: z.string().min(1), name: z.string().min(1).max(120) }),
  output: z.object({ brandId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    // `brands.get` upserts on first read; a rename after that is a second
    // `get` call with the new name, matching `brandRepository.ts`'s own
    // upsert-then-reread shape for every governance field.
    const gov = await ctx.db.brands.get(input.brandId, ctx.orgId, input.name);
    return { brandId: gov.brandId, name: input.name };
  },
});

/* ── brand.knowledge.attach ──────────────────────────────────────────── */

export function makeBrandKnowledgeAttach(embed: EmbedClient) {
  return defineTool({
    name: 'brand.knowledge.attach',
    version: 1,

    summary:
      'Attach a piece of source text (a policy, a spec sheet, an FAQ) to a brand for claim-grounding. The ' +
      'one write the wider knowledge.* ingestion pipeline (site/doc crawling) would eventually feed — ' +
      'until that exists, this is the manual path in.',

    input: z.object({
      genomeId: z.string().min(1),
      docId: z.string().min(1).max(120),
      text: z.string().min(1).max(20_000),
      citationLabel: z.string().max(200).optional(),
    }),
    output: z.object({ id: z.string(), docId: z.string() }),

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,

    async handler(input, ctx) {
      const embedding = await embed.embed(input.text);
      const chunk = await ctx.db.knowledge.attach({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        docId: input.docId,
        text: input.text,
        embedding,
        ...(input.citationLabel ? { citation: { label: input.citationLabel } } : {}),
      });
      ctx.logger.info('knowledge attached', { genomeId: input.genomeId, docId: input.docId });
      return { id: chunk.id, docId: chunk.docId };
    },
  });
}

/* ── brand.export / brand.import ────────────────────────────────────── */

/**
 * What travels. Deliberately excludes `learned` (this account's own
 * performance history has no meaning for a different brand) and every id —
 * import always mints a fresh brand/genome rather than overwriting one.
 */
const BrandExportPayload = z.object({
  name: z.string(),
  identity: z.record(z.string(), z.unknown()),
  dimensions: z.record(z.string(), z.unknown()),
  voice: z.record(z.string(), z.unknown()),
  offer: z.record(z.string(), z.unknown()),
  constraints: z.record(z.string(), z.unknown()),
});
type BrandExportPayload = z.infer<typeof BrandExportPayload>;

export const brandExport = defineTool({
  name: 'brand.export',
  version: 1,
  summary: 'Export a brand\'s genome (identity, dimensions, voice, offer, constraints — not its learned performance history) as portable JSON.',
  input: z.object({ genomeId: z.string().min(1) }),
  output: z.object({ data: BrandExportPayload }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,
  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });
    return {
      data: {
        name: genome.identity.business_name,
        identity: genome.identity,
        dimensions: genome.dimensions,
        voice: genome.voice,
        offer: genome.offer,
        constraints: genome.constraints,
      },
    };
  },
});

export const brandImport = defineTool({
  name: 'brand.import',
  version: 1,

  summary:
    'Create a new brand from a previously exported one — the fast path for an agency onboarding a client ' +
    "similar to one it already runs. Audience segments are not carried over (no write path for that field " +
    "exists anywhere in the registry yet); everything else transfers.",

  input: z.object({ name: z.string().min(1).max(120).optional(), data: BrandExportPayload }),
  output: z.object({ brandId: z.string(), genomeId: z.string(), name: z.string() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: false,

  async handler(input, ctx) {
    const name = input.name ?? input.data.name;
    const brandId = `brand_${randomUUID()}`;
    await ctx.db.brands.get(brandId, ctx.orgId, name);

    const genome = await ctx.db.genomes.createDraft({
      brandId,
      orgId: ctx.orgId,
      identity: { ...input.data.identity, business_name: name },
      dimensions: input.data.dimensions,
      voice: input.data.voice,
      source: 'user',
    });

    await ctx.db.genomes.patchOffer({ genomeId: genome.id, orgId: ctx.orgId, offer: input.data.offer });
    await ctx.db.genomes.patchConstraints({
      genomeId: genome.id,
      orgId: ctx.orgId,
      patch: {
        heygenAvatarId: (input.data.constraints as { heygen_avatar_id?: string }).heygen_avatar_id,
        elevenlabsVoiceId: (input.data.constraints as { elevenlabs_voice_id?: string }).elevenlabs_voice_id,
      },
    });

    ctx.logger.info('brand imported', { orgId: ctx.orgId, brandId, genomeId: genome.id, sourceName: input.data.name });
    return { brandId, genomeId: genome.id, name };
  },
});
