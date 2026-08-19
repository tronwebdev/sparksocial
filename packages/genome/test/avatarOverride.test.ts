import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools';
import { genomeAvatarOverrideSet } from '../src/avatarOverride.js';

/**
 * `genome.avatar_override.set` — the explicit escape hatch from
 * `avatarDefault()`'s hard-derived false, for founder-POV SaaS/agency
 * genomes. What matters here: enabling is refused without a licensed person
 * AND active consent (the same gates `content.generate_avatar_video` checks
 * at spend time), disabling reverts to the plain derived default rather than
 * forcing avatar off, and this never branches on `identity.category`.
 */

function genome(over: Partial<Genome['dimensions']> = {}): Genome {
  return {
    genome_id: 'gen_1',
    workspace_id: 'brand_1',
    version: 1,
    identity: {
      business_name: 'Test SaaS',
      category: 'saas',
      one_liner: 'project management for agencies',
      geography: { scope: 'global', locale: 'en-US', radius_km: null },
      languages: ['en'],
      price_tier: 'mid',
    },
    dimensions: {
      proof_asset: ['product_ui'],
      capture_capability: ['screen'],
      objective: 'trials',
      secondary_objectives: [],
      talent_availability: 'yes_licensed',
      ...over,
    },
    voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
    audience: { segments: [] },
    offer: { products: [], primary_cta: '' },
    constraints: { compliance_profile: 'none', avatar_enabled: false, max_posts_per_week: 12, approval_mode: 'review_first_week', avatar_override: null },
    learned: { top_formats: [], best_post_times: [], mix_weights_override: null, confidence: 0 },
  } as unknown as Genome;
}

function ctx(over: {
  get?: ScopedDb['genomes']['get'];
  patchConstraints?: ScopedDb['genomes']['patchConstraints'];
  hasActive?: ScopedDb['consent']['hasActive'];
  userId?: string;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    userId: 'userId' in over ? over.userId : 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        get: over.get ?? (async () => genome()),
        patchConstraints: over.patchConstraints ?? (async ({ genomeId }) => ({ id: genomeId, version: 2 })),
      },
      consent: {
        hasActive: over.hasActive ?? (async () => true),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('the registry contract', () => {
  it('is human_only — a likeness-risk decision, never SPARK’s to make unattended', () => {
    expect(genomeAvatarOverrideSet.autonomy).toBe('human_only');
  });

  it('scopes to owner/admin only', () => {
    expect(genomeAvatarOverrideSet.scopes).toEqual(['owner', 'admin']);
  });
});

describe('genome.avatar_override.set — input', () => {
  it('rejects enabling without a reason', () => {
    expect(genomeAvatarOverrideSet.input.safeParse({ genomeId: 'gen_1', enabled: true }).success).toBe(false);
  });

  it('allows disabling without a reason', () => {
    expect(genomeAvatarOverrideSet.input.safeParse({ genomeId: 'gen_1', enabled: false }).success).toBe(true);
  });
});

describe('genome.avatar_override.set — enabling', () => {
  it('turns avatar on and records who/why, given a licensed person and active consent', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({ id: genomeId, version: 2 }));

    const out = await genomeAvatarOverrideSet.handler(
      { genomeId: 'gen_1', enabled: true, reason: 'Founder wants to appear on camera for LinkedIn thought leadership.' },
      ctx({ patchConstraints }),
    );

    expect(out.avatarEnabled).toBe(true);
    expect(out.override).toEqual({ reason: expect.stringContaining('Founder'), setBy: 'user_owner', setAt: expect.any(String) });
    expect(patchConstraints).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      patch: { avatarEnabled: true, avatarOverride: { reason: expect.stringContaining('Founder'), setBy: 'user_owner', setAt: expect.any(String) } },
    });
    expect(out.why.summary).toContain('user_owner');
  });

  it('refuses when nobody licensed is available to film or clone', async () => {
    const get = async () => genome({ talent_availability: 'no' });
    await expect(
      genomeAvatarOverrideSet.handler({ genomeId: 'gen_1', enabled: true, reason: 'because I said so' }, ctx({ get })),
    ).rejects.toThrow(ToolError);
  });

  it('refuses when there is no active avatar_clone consent record, even with a licensed person', async () => {
    await expect(
      genomeAvatarOverrideSet.handler(
        { genomeId: 'gen_1', enabled: true, reason: 'because I said so' },
        ctx({ hasActive: async () => false }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('requires the caller to be an attributable person', async () => {
    await expect(
      genomeAvatarOverrideSet.handler(
        { genomeId: 'gen_1', enabled: true, reason: 'because I said so' },
        ctx({ userId: undefined }),
      ),
    ).rejects.toThrow(ToolError);
  });
});

describe('genome.avatar_override.set — disabling', () => {
  it('clears the override and reverts to the derived default (false for a product_ui proof asset)', async () => {
    const patchConstraints = vi.fn<ScopedDb['genomes']['patchConstraints']>(async ({ genomeId }) => ({ id: genomeId, version: 3 }));

    const out = await genomeAvatarOverrideSet.handler({ genomeId: 'gen_1', enabled: false }, ctx({ patchConstraints }));

    expect(out.avatarEnabled).toBe(false);
    expect(out.override).toBeNull();
    expect(patchConstraints).toHaveBeenCalledWith({
      genomeId: 'gen_1',
      orgId: 'org_1',
      patch: { avatarEnabled: false, avatarOverride: null },
    });
  });

  it('reverts to true, not forced false, when the genome’s own proof asset is a licensed person', async () => {
    const get = async () => genome({ proof_asset: ['person'], talent_availability: 'yes_licensed' });
    const out = await genomeAvatarOverrideSet.handler({ genomeId: 'gen_1', enabled: false }, ctx({ get }));
    expect(out.avatarEnabled).toBe(true);
  });

  it('does not require consent or licensed talent to disable', async () => {
    const get = async () => genome({ talent_availability: 'no' });
    const out = await genomeAvatarOverrideSet.handler(
      { genomeId: 'gen_1', enabled: false },
      ctx({ get, hasActive: async () => false }),
    );
    expect(out.avatarEnabled).toBe(false);
  });
});

describe('genome.avatar_override.set — errors', () => {
  it('throws NOT_FOUND for an unknown or out-of-scope genome', async () => {
    await expect(
      genomeAvatarOverrideSet.handler({ genomeId: 'gen_missing', enabled: false }, ctx({ get: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });
});
