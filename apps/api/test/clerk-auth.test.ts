import { describe, it, expect, vi } from 'vitest';
import type { ClerkClient } from '@clerk/backend';
import { ToolError } from '@sparksocial/shared/types';
import type { ScopedDb } from '@sparksocial/tools';
import { makeClerkResolveCtx } from '../src/clerk-auth.js';

/**
 * These tests guard the tenancy boundary. Every one of them describes a way a
 * caller could try to obtain data belonging to another organisation, and asserts
 * that the resolver refuses.
 *
 * The Clerk client is faked rather than mocked at the network level: what is
 * under test is what the resolver *does with verified claims*, not Clerk's own
 * JWT verification, which is their code and already tested.
 */

const GENOME_IN_ORG_A = 'gen_a';
const GENOME_IN_ORG_B = 'gen_b';

function fakeDb(): ScopedDb {
  const genomes: Record<string, { orgId: string; workspace_id: string }> = {
    [GENOME_IN_ORG_A]: { orgId: 'org_A', workspace_id: 'brand_A' },
    [GENOME_IN_ORG_B]: { orgId: 'org_B', workspace_id: 'brand_B' },
  };
  return {
    genomes: {
      createDraft: async () => ({ id: 'x' }),
      patchDimensions: async () => ({ id: 'x', version: 1 }),
      // Mirrors the real repository: a scope mismatch is indistinguishable from
      // a missing row.
      get: async (genomeId: string, orgId: string) => {
        const g = genomes[genomeId];
        if (!g || g.orgId !== orgId) return undefined;
        return { workspace_id: g.workspace_id } as never;
      },
      listForOrg: async () => [],
    },
    assets: {
      inventory: async () => ({}),
      retrieve: async () => [],
      create: async () => ({ id: 'a' }),
      captionsByRole: async () => [],
      info: async () => ({}),
    },
    content: { recent: async () => [] },
  } as unknown as ScopedDb;
}

function fakeClerk(claims: Record<string, unknown> | null): ClerkClient {
  return {
    authenticateRequest: async () =>
      claims
        ? { isSignedIn: true, toAuth: () => ({ sessionClaims: claims }) }
        : { isSignedIn: false, reason: 'no-session' },
  } as unknown as ClerkClient;
}

const resolver = (claims: Record<string, unknown> | null) =>
  makeClerkResolveCtx({ db: fakeDb(), clerk: fakeClerk(claims), authorizedParties: ['http://localhost:3000'] });

const req = (headers: Record<string, string> = {}) => new Request('http://api.test/v1/tools/x', { headers });

describe('clerk resolveCtx — the tenancy boundary', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(resolver(null)(req())).rejects.toThrow(ToolError);
  });

  it('rejects a session with no active organization', async () => {
    await expect(resolver({ sub: 'user_1' })(req())).rejects.toThrow(/organization/i);
  });

  it('takes orgId and userId from verified claims, never from headers', async () => {
    const ctx = await resolver({ sub: 'user_1', org_id: 'org_A', org_role: 'org:admin' })(
      req({ 'x-org-id': 'org_EVIL', 'x-user-id': 'user_EVIL' }),
    );
    expect(ctx.orgId).toBe('org_A');
    expect(ctx.userId).toBe('user_1');
  });

  /* ── The core isolation assertion ───────────────────────────────────── */

  it('refuses a genome belonging to another org', async () => {
    const resolve = resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:owner' });
    await expect(resolve(req({ 'x-genome-id': GENOME_IN_ORG_B }))).rejects.toMatchObject({
      code: 'ISOLATION_VIOLATION',
    });
  });

  it('refuses a genome that does not exist, with the same error as one out of scope', async () => {
    const resolve = resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:owner' });
    await expect(resolve(req({ 'x-genome-id': 'gen_nope' }))).rejects.toMatchObject({
      code: 'ISOLATION_VIOLATION',
    });
  });

  it('accepts a genome inside the org and derives brandId from the row, ignoring x-brand-id', async () => {
    const ctx = await resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:owner' })(
      req({ 'x-genome-id': GENOME_IN_ORG_A, 'x-brand-id': 'brand_EVIL' }),
    );
    expect(ctx.genomeId).toBe(GENOME_IN_ORG_A);
    expect(ctx.brandId).toBe('brand_A');
  });

  it('leaves genomeId unset when no genome is claimed, so org-scoped reads still work', async () => {
    const ctx = await resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:viewer' })(req());
    expect(ctx.genomeId).toBeUndefined();
    expect(ctx.orgId).toBe('org_A');
  });

  /* ── Role mapping ───────────────────────────────────────────────────── */

  it.each([
    ['org:owner', 'owner'],
    ['org:admin', 'admin'],
    ['org:editor', 'editor'],
    ['org:approver', 'approver'],
    ['org:viewer', 'viewer'],
    ['org:client', 'client'],
  ])('maps %s to %s', async (orgRole, expected) => {
    const ctx = await resolver({ sub: 'u', org_id: 'org_A', org_role: orgRole })(req());
    expect(ctx.role).toBe(expected);
  });

  it('degrades an unknown role to viewer rather than owner or an error', async () => {
    const ctx = await resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:something_new' })(req());
    expect(ctx.role).toBe('viewer');
  });

  it('degrades a missing role to viewer', async () => {
    const ctx = await resolver({ sub: 'u', org_id: 'org_A' })(req());
    expect(ctx.role).toBe('viewer');
  });

  it('never lets a header escalate the role', async () => {
    const ctx = await resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:viewer' })(req({ 'x-role': 'owner' }));
    expect(ctx.role).toBe('viewer');
  });

  /* ── Caller identity ────────────────────────────────────────────────── */

  it("reports caller 'user' even when the request claims to be an agent", async () => {
    // The P1 exit criterion says `caller` is the only field distinguishing a UI
    // action from a SPARK action. If a browser could set it, that distinction —
    // and every autonomy rule keyed on it — becomes meaningless.
    const ctx = await resolver({ sub: 'u', org_id: 'org_A', org_role: 'org:owner' })(req({ 'x-caller': 'agent' }));
    expect(ctx.caller).toBe('user');
  });

  /* ── Configuration safety ───────────────────────────────────────────── */

  it('refuses to construct without authorizedParties', () => {
    expect(() => makeClerkResolveCtx({ db: fakeDb(), clerk: fakeClerk(null), authorizedParties: [] })).toThrow(
      /authorizedParties/,
    );
  });

  it('passes authorizedParties through to Clerk so the audience is actually checked', async () => {
    const authenticateRequest = vi
      .fn()
      .mockResolvedValue({ isSignedIn: true, toAuth: () => ({ sessionClaims: { sub: 'u', org_id: 'org_A' } }) });
    const clerk = { authenticateRequest } as unknown as ClerkClient;
    await makeClerkResolveCtx({ db: fakeDb(), clerk, authorizedParties: ['https://app.example'] })(req());
    expect(authenticateRequest).toHaveBeenCalledWith(expect.anything(), {
      authorizedParties: ['https://app.example'],
    });
  });
});
