import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, register, __resetRegistry, type ScopedDb } from '@sparksocial/tools';
import { runOnce } from '../src/connection-watcher.js';
import { memoryInvokeDeps } from '../src/app.js';

/**
 * THE CONNECTION WATCHER — PRD §10's *"alerts"*.
 *
 * Same interception trick as `scheduler.test.ts` and `trend-observer.test.ts`:
 * `notifyOne` hardcodes `tool: 'human.notify'`, so a fake registered under that
 * exact name proves the alert goes through `invokeTool`'s real middleware chain
 * rather than writing to `humanLoop` behind the registry's back — which is what
 * would make it a second inbox nobody knows to check.
 *
 * The behaviour worth pinning is the *latch*. An alert channel that repeats the
 * same warning every tick for a week is worse than no alert channel: the owner
 * learns to skip the one message that mattered.
 */

const NOW = new Date('2026-08-20T12:00:00Z');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function fakeNotify(opts: { throws?: boolean } = {}) {
  const sent: string[] = [];
  const tool = defineTool({
    name: 'human.notify',
    version: 1,
    summary: 'fake human.notify for connection-watcher tests',
    input: z.object({ message: z.string(), urgency: z.string() }),
    output: z.object({ id: z.string() }),
    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    async handler(input) {
      if (opts.throws) throw new Error('notification channel down');
      sent.push(input.message);
      return { id: `msg_${sent.length}` };
    },
  });
  return { tool, sent };
}

interface FakeConn {
  id: string;
  orgId: string;
  genomeId: string;
  provider: string;
  accessToken: string;
  connectedBy: string;
  createdAt: Date;
  updatedAt: Date;
  accountLabel?: string;
  expiresAt?: Date;
  expiryNotifiedAt?: Date;
}

function fakeDb(connections: FakeConn[], opts: { genomeMissing?: boolean } = {}) {
  return {
    genomes: {
      async get(genomeId: string, orgId: string) {
        if (opts.genomeMissing) return undefined;
        return { id: genomeId, org_id: orgId, workspace_id: 'brand_1' };
      },
    },
    brands: {
      async get() {
        return { createdAt: new Date(0), approvalMode: 'autopublish', agentPaused: false };
      },
    },
    oauthConnections: {
      async findExpiring({ before, limit }: { before: Date; limit: number }) {
        return connections
          .filter((c) => c.expiresAt !== undefined && c.expiresAt <= before && c.expiryNotifiedAt === undefined)
          .slice(0, limit);
      },
      async markExpiryNotified({ id, at }: { id: string; orgId: string; at: Date }) {
        const row = connections.find((c) => c.id === id);
        if (row) row.expiryNotifiedAt = at;
      },
    },
  } as unknown as ScopedDb;
}

const conn = (over: Partial<FakeConn> = {}): FakeConn => ({
  id: 'oauth_1',
  orgId: 'org_1',
  genomeId: 'gen_1',
  provider: 'instagram',
  accessToken: 'tok',
  connectedBy: 'user_1',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  accountLabel: '@brand',
  expiresAt: hoursFromNow(48),
  ...over,
});

const deps = (db: ScopedDb, invoke: ReturnType<typeof memoryInvokeDeps>) => ({
  db,
  invoke,
  loadBrandGovernance: async () => ({ createdAt: new Date(0), approvalMode: 'autopublish' as const, agentPaused: false }),
  now: () => NOW,
});

describe('connection watcher', () => {
  beforeEach(() => __resetRegistry());

  it('warns about a connection inside the expiry window, through the registry', async () => {
    const { tool, sent } = fakeNotify();
    register(tool);
    const invoke = memoryInvokeDeps();
    const rows = [conn()];

    await runOnce(deps(fakeDb(rows), invoke));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('@brand');
    expect(invoke.rows[0]!.tool).toBe('human.notify');
    // The tenant's own org, not a system identity: the alert belongs in that
    // brand's Command Center, and it is that brand's governance that applies.
    expect(invoke.rows[0]!.orgId).toBe('org_1');
  });

  it('tells the owner what to do, not what a row says', async () => {
    // "Instagram token expiring" is a status. "Reconnect it so scheduled posts
    // keep going out" is a reason to open the app.
    const { tool, sent } = fakeNotify();
    register(tool);
    await runOnce(deps(fakeDb([conn()]), memoryInvokeDeps()));
    expect(sent[0]).toMatch(/reconnect/i);
    expect(sent[0]).toMatch(/2 days/);
  });

  it('says it differently once the token has already expired', async () => {
    const { tool, sent } = fakeNotify();
    register(tool);
    await runOnce(deps(fakeDb([conn({ expiresAt: hoursFromNow(-24) })]), memoryInvokeDeps()));
    expect(sent[0]).toMatch(/has expired/i);
  });

  it('warns once, not on every tick', async () => {
    // The whole point of the latch. Six-hourly for a seven-day window would
    // otherwise be twenty-eight identical messages per connection.
    const { tool, sent } = fakeNotify();
    register(tool);
    const invoke = memoryInvokeDeps();
    const rows = [conn()];
    const d = deps(fakeDb(rows), invoke);

    await runOnce(d);
    await runOnce(d);
    await runOnce(d);

    expect(sent).toHaveLength(1);
  });

  it('does not latch when the notification never reached anybody', async () => {
    // A failed send is not "already sent". Leaving it latched would swallow the
    // one warning this feature exists to deliver.
    const { tool } = fakeNotify({ throws: true });
    register(tool);
    const rows = [conn()];

    await runOnce(deps(fakeDb(rows), memoryInvokeDeps()));

    expect(rows[0]!.expiryNotifiedAt).toBeUndefined();
  });

  it('ignores a connection with no stated expiry', async () => {
    // Several providers issue tokens without one. Warning about a connection
    // that works fine is how an alert channel becomes noise.
    const { tool, sent } = fakeNotify();
    register(tool);
    await runOnce(deps(fakeDb([conn({ expiresAt: undefined })]), memoryInvokeDeps()));
    expect(sent).toHaveLength(0);
  });

  it('ignores a connection expiring beyond the window', async () => {
    const { tool, sent } = fakeNotify();
    register(tool);
    await runOnce(deps(fakeDb([conn({ expiresAt: hoursFromNow(24 * 30) })]), memoryInvokeDeps()));
    expect(sent).toHaveLength(0);
  });

  it('latches a connection whose brand is gone rather than re-reading it forever', async () => {
    const { tool, sent } = fakeNotify();
    register(tool);
    const rows = [conn()];

    await runOnce(deps(fakeDb(rows, { genomeMissing: true }), memoryInvokeDeps()));

    expect(sent).toHaveLength(0);
    expect(rows[0]!.expiryNotifiedAt).toEqual(NOW);
  });

  it('keeps going when one tenant fails', async () => {
    // One broken genome must not cost the other alerts in the batch.
    const { tool, sent } = fakeNotify();
    register(tool);
    const rows = [conn(), conn({ id: 'oauth_2', genomeId: 'gen_2', provider: 'x', accountLabel: '@second' })];
    const db = fakeDb(rows);
    let first = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).genomes.get = async (genomeId: string, orgId: string) => {
      if (first) {
        first = false;
        throw new Error('genome read failed');
      }
      return { id: genomeId, org_id: orgId, workspace_id: 'brand_1' };
    };

    await runOnce(deps(db, memoryInvokeDeps()));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('@second');
    // The one that threw is not latched, so the next tick retries it.
    expect(rows[0]!.expiryNotifiedAt).toBeUndefined();
  });
});
