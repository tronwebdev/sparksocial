import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, assetRoleWordList } from '@sparksocial/shared';
import { PLAYBOOKS, byId } from './records.js';
import { resolve } from './resolver.js';
import type { AssetInventory } from './golden.js';

/**
 * `playbook.list` / `.get` / `.explain` — direct browsing of the library
 * `playbook.resolve` has always read from but never exposed. `PLAYBOOKS` is
 * a static, in-process array (CLAUDE.md invariant 5: playbooks are data, not
 * code — adding one is a row in `records.ts`, never a deploy that touches
 * these tools), so `.list`/`.get` need no genome and cost nothing.
 * `.explain` is the one genome-specific tool here: it runs the exact same
 * `resolve()` the calendar and campaign planner do, for one playbook instead
 * of ranking all of them, so "why can't I use this format" has a direct
 * answer instead of hunting for it in `playbook.resolve`'s full ranked list.
 */

const PlaybookSummary = z.object({
  playbookId: z.string(),
  name: z.string(),
  description: z.string(),
  mode: z.enum(['synthesize', 'assemble', 'direct_finish']),
  contentPillar: z.enum(['educational', 'product', 'proof', 'personality', 'community']),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']),
  platforms: z.array(z.string()),
  saturationRisk: z.enum(['low', 'medium', 'high']),
});

function toSummary(p: (typeof PLAYBOOKS)[number]): z.infer<typeof PlaybookSummary> {
  return {
    playbookId: p.playbook_id,
    name: p.name,
    description: p.description,
    mode: p.mode,
    contentPillar: p.content_pillar,
    mediaType: p.output.media_type,
    platforms: p.output.platforms,
    saturationRisk: p.saturation_risk,
  };
}

/* ── playbook.list ───────────────────────────────────────────────────── */

export const PlaybookListInput = z.object({
  activeOnly: z.boolean().default(true),
});

export const playbookList = defineTool({
  name: 'playbook.list',
  version: 1,

  summary:
    'Browse the full playbook library — every format available in the product, independent of any one ' +
    'genome. Use playbook.resolve to see which ones a specific brand can actually run right now.',

  input: PlaybookListInput,
  output: z.object({ playbooks: z.array(PlaybookSummary), total: z.number() }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input) {
    const filtered = input.activeOnly ? PLAYBOOKS.filter((p) => p.is_active) : PLAYBOOKS;
    return { playbooks: filtered.map(toSummary), total: filtered.length };
  },
});

/* ── playbook.get ────────────────────────────────────────────────────── */

export const PlaybookGetInput = z.object({ playbookId: z.string().min(1) });

const PlaybookDetail = PlaybookSummary.extend({
  isActive: z.boolean(),
  requiresDisclosure: z.boolean(),
  complianceFlags: z.array(z.string()),
  aspectRatios: z.array(z.string()),
  beatCount: z.number().int(),
  preconditions: z.object({
    captureCapabilityAny: z.array(z.string()).optional(),
    proofAssetAny: z.array(z.string()).optional(),
    requiredAssetRoles: z.array(z.string()),
    minAssets: z.number().int(),
    talentRequired: z.boolean(),
    requiresLikenessLicense: z.boolean(),
  }),
});

export const playbookGet = defineTool({
  name: 'playbook.get',
  version: 1,

  summary: 'Read one playbook’s full record — preconditions, beat structure, output format — for inspecting a specific format directly.',

  input: PlaybookGetInput,
  output: PlaybookDetail,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input) {
    const playbook = byId(input.playbookId);
    if (!playbook) {
      throw new ToolError('NOT_FOUND', `No playbook "${input.playbookId}".`, { playbookId: input.playbookId });
    }
    return {
      ...toSummary(playbook),
      isActive: playbook.is_active,
      requiresDisclosure: playbook.requires_disclosure,
      complianceFlags: playbook.compliance_flags,
      aspectRatios: playbook.output.aspect_ratios,
      beatCount: playbook.structure.beats.length,
      preconditions: {
        ...(playbook.preconditions.capture_capability_any ? { captureCapabilityAny: playbook.preconditions.capture_capability_any } : {}),
        ...(playbook.preconditions.proof_asset_any ? { proofAssetAny: playbook.preconditions.proof_asset_any } : {}),
        requiredAssetRoles: playbook.preconditions.required_asset_roles,
        minAssets: playbook.preconditions.min_assets,
        talentRequired: playbook.preconditions.talent_required,
        requiresLikenessLicense: playbook.preconditions.requires_likeness_license,
      },
    };
  },
});

/* ── playbook.explain ────────────────────────────────────────────────── */

export const PlaybookExplainInput = z.object({
  genomeId: z.string().min(1),
  playbookId: z.string().min(1),
});

export const PlaybookExplainOutput = z.object({
  playbookId: z.string(),
  /** Producible right now, from assets already on hand. */
  producible: z.boolean(),
  /** Blocked only on missing assets — a capture brief would unlock it. */
  unlockable: z.boolean(),
  missingRoles: z.array(z.string()),
  score: z.number().optional(),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional(), weight: z.number().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule', 'asset']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export const playbookExplain = defineTool({
  name: 'playbook.explain',
  version: 1,

  summary:
    'Explain why one specific playbook is or isn’t producible for this genome right now — the same ' +
    'resolve() logic playbook.resolve runs for every format, scoped to the one you’re asking about.',

  input: PlaybookExplainInput,
  output: PlaybookExplainOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const playbook = byId(input.playbookId);
    if (!playbook) {
      throw new ToolError('NOT_FOUND', `No playbook "${input.playbookId}".`, { playbookId: input.playbookId });
    }

    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', `No genome ${input.genomeId}.`, { genomeId: input.genomeId });
    }

    const assets = (await ctx.db.assets.inventory(input.genomeId, ctx.orgId)) as AssetInventory;
    const { ranked, rejected } = resolve(genome, assets);

    const found = ranked.find((r) => r.playbook.playbook_id === input.playbookId);
    if (found) {
      return {
        playbookId: input.playbookId,
        producible: !found.unlockable,
        unlockable: found.unlockable,
        missingRoles: found.missingRoles,
        score: Number(found.score.toFixed(4)),
        why: {
          summary: found.unlockable
            ? found.unlockedBy === 'capture'
              ? `${playbook.name} would work, but needs ${assetRoleWordList(found.missingRoles)} — film a capture brief to unlock it.`
              : `${playbook.name} would work, but needs ${assetRoleWordList(found.missingRoles)} — upload one and it is ready, no filming.`
            : `${playbook.name} is producible now from assets already on hand.`,
          factors: found.factors,
          evidence: [{ kind: 'rule' as const, id: 'engine_spec.§5.2', note: 'Preconditions over genome dimensions.' }],
          alternatives: [],
        },
      };
    }

    const rejection = rejected.find((r) => r.playbook_id === input.playbookId);
    return {
      playbookId: input.playbookId,
      producible: false,
      unlockable: false,
      missingRoles: [],
      why: {
        summary: rejection
          ? `${playbook.name} doesn’t fit this brand: ${rejection.because}.`
          : `${playbook.name} isn’t applicable to this genome.`,
        factors: rejection ? [{ label: 'ruled out', detail: rejection.because }] : [],
        evidence: [],
        alternatives: [],
      },
    };
  },
});
