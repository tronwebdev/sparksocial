import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import {
  DEFAULT_AGENCY_PROFILE,
  agencyProfileGet,
  agencyProfileSet,
  makeAgencyIdentityGenerate,
  type AgencyIdentityWriter,
} from '../src/agencyProfile.js';

/**
 * `agency.profile.*` — the launch wizard, saved on the org.
 *
 * What these guard: the answers survive (the wizard used to keep them in one
 * browser's localStorage), launching is stamped once and never moves, and a
 * stored profile from an older shape still reads.
 */

function ctx(store = new Map<string, unknown>(), over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      agencyProfiles: {
        get: async (orgId: string) =>
          store.has(orgId) ? { profile: store.get(orgId), updatedAt: new Date() } : undefined,
        set: async (orgId: string, profile: unknown) => {
          store.set(orgId, profile);
          return { profile, updatedAt: new Date() };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

function decide(tool: { name: string; effect: string; autonomy: string; scopes: readonly string[] }, over: { caller?: string; role?: string }) {
  return evaluate({
    caller: over.caller ?? 'user',
    role: over.role ?? 'owner',
    tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
    brand: { approvalMode: 'autopublish', agentPaused: false },
    budget: { estimatedCents: 0, remainingCents: 10_000 },
  } as unknown as Parameters<typeof evaluate>[0]);
}

const answers = { ...DEFAULT_AGENCY_PROFILE, name: 'Northside Social', email: 'hi@northside.example', colors: ['#3157D6'] };

describe('agency.profile', () => {
  it('reads as not launched when nothing was ever saved', async () => {
    expect(await agencyProfileGet.handler({}, ctx())).toEqual({ profile: null, launched: false });
  });

  it('saves the wizard’s answers and reads them back', async () => {
    const store = new Map<string, unknown>();
    await agencyProfileSet.handler(agencyProfileSet.input.parse({ profile: answers }), ctx(store));
    const out = await agencyProfileGet.handler({}, ctx(store));
    expect(out.profile).toMatchObject({ name: 'Northside Social', email: 'hi@northside.example', colors: ['#3157D6'] });
    expect(out.launched).toBe(false);
  });

  it('stamps the launch once, and a later edit does not move it', async () => {
    const store = new Map<string, unknown>();
    const first = await agencyProfileSet.handler(agencyProfileSet.input.parse({ profile: answers, launch: true }), ctx(store));
    expect(first.launched).toBe(true);
    const stamped = first.profile!.launchedAt;

    const edited = await agencyProfileSet.handler(
      agencyProfileSet.input.parse({ profile: { ...answers, tagline: 'New line' } }),
      ctx(store),
    );
    expect(edited.profile!.launchedAt).toBe(stamped);
    expect(edited.profile!.tagline).toBe('New line');
  });

  it('reads an older stored shape field by field instead of failing the whole record', async () => {
    // A tone the list no longer has, and a field that never existed.
    const store = new Map<string, unknown>([['org_1', { name: 'Kept', tone: 'Whimsical', stray: 1 }]]);
    const out = await agencyProfileGet.handler({}, ctx(store));
    expect(out.profile).toMatchObject({ name: 'Kept', tone: 'Professional' });
    expect(out.profile).not.toHaveProperty('stray');
  });

  it('refuses a colour that is not hex', () => {
    const bad = agencyProfileSet.input.safeParse({ profile: { ...answers, colors: ['blue'] } });
    expect(bad.success).toBe(false);
  });

  it('is a person’s decision: refused to SPARK, and to an editor', () => {
    expect(decide(agencyProfileSet, { caller: 'agent' }).kind).toBe('deny');
    expect(decide(agencyProfileSet, { role: 'editor' }).kind).toBe('deny');
    expect(decide(agencyProfileSet, {}).kind).toBe('allow');
    expect(decide(agencyProfileGet, { role: 'editor' }).kind).toBe('deny');
  });
});

describe('agency.identity.generate', () => {
  const writer = (out: Awaited<ReturnType<AgencyIdentityWriter['write']>>, seen: string[] = []): AgencyIdentityWriter => ({
    write: async ({ prompt }) => {
      seen.push(prompt);
      return out;
    },
  });

  it('keeps a name the agency already has and only writes a tagline', async () => {
    const seen: string[] = [];
    const tool = makeAgencyIdentityGenerate(writer({ name: 'Other Name', tagline: '  Local posts, done.  ' }, seen));
    const out = await tool.handler(tool.input.parse({ part: 'identity', model: 'local_business', name: 'Northside' }), ctx());
    expect(out.name).toBeUndefined();
    expect(out.tagline).toBe('Local posts, done.');
    expect(out.why.summary).toMatch(/Northside/);
    expect(seen[0]).toMatch(/Its name is: Northside/);
  });

  it('suggests a name when there is none', async () => {
    const tool = makeAgencyIdentityGenerate(writer({ name: 'Brightside', tagline: 'Hello' }));
    const out = await tool.handler(tool.input.parse({ part: 'identity', model: 'personal_brand' }), ctx());
    expect(out.name).toBe('Brightside');
  });

  it('keeps only a tone from the list and colours that are hex', async () => {
    const tool = makeAgencyIdentityGenerate(writer({ tone: 'bold', colors: ['#112233', 'teal', '#ABCDEF'] }));
    const out = await tool.handler(tool.input.parse({ part: 'theme', model: 'local_business' }), ctx());
    expect(out).toMatchObject({ tone: 'Bold', colors: ['#112233', '#ABCDEF'] });
  });

  it('fails plainly when the writer returns nothing usable', async () => {
    const tool = makeAgencyIdentityGenerate(writer({ tone: 'Whimsical', colors: ['teal'] }));
    await expect(tool.handler(tool.input.parse({ part: 'theme', model: 'local_business' }), ctx())).rejects.toThrow(
      /no usable tone/,
    );
  });

  it('is refused to an editor', () => {
    expect(decide(makeAgencyIdentityGenerate(writer({})), { role: 'editor' }).kind).toBe('deny');
  });
});
