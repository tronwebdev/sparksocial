import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ContentDraft, ScopedDb, ToolCtx } from '@sparksocial/tools';
import { contentSchedule } from '../src/schedule.js';

function ctx(over: { schedule?: ScopedDb['content']['schedule'] } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('not used'); },
        get: async () => undefined,
        updateDraft: async () => undefined,
        list: async () => [],
        schedule:
          over.schedule ??
          (async (args): Promise<ContentDraft> => ({
            id: args.id, genomeId: args.genomeId, playbookId: 'pb_text_update', mode: 'synthesize',
            status: 'scheduled', scheduledAt: args.scheduledAt, createdAt: new Date(),
          })),
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('content.schedule', () => {
  it('places a draft on the date, marking it scheduled', async () => {
    const out = await contentSchedule.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1', scheduledAt: '2026-09-01T09:00:00.000Z', publishImmediatelyIfPast: false },
      ctx(),
    );
    expect(out.status).toBe('scheduled');
    expect(out.scheduledAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('passes the parsed date and org through to the store, never trusting a client-supplied org', async () => {
    const schedule = vi.fn<ScopedDb['content']['schedule']>(async (args) => ({
      id: args.id, genomeId: args.genomeId, playbookId: 'pb_text_update', mode: 'synthesize',
      status: 'scheduled', scheduledAt: args.scheduledAt, createdAt: new Date(),
    }));
    await contentSchedule.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1', scheduledAt: '2026-09-01T09:00:00.000Z', publishImmediatelyIfPast: false },
      ctx({ schedule }),
    );
    expect(schedule).toHaveBeenCalledWith({
      id: 'ci_1', genomeId: 'gen_1', orgId: 'org_1', scheduledAt: new Date('2026-09-01T09:00:00.000Z'),
    });
  });

  it('404s when the item is not open — gone, out of scope, or already published', async () => {
    await expect(
      contentSchedule.handler(
        { contentItemId: 'ci_x', genomeId: 'gen_1', scheduledAt: '2026-09-01T09:00:00.000Z', publishImmediatelyIfPast: false },
        ctx({ schedule: async () => undefined }),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('is idempotent — moving the same post to the same date twice is one fact', () => {
    expect(contentSchedule.idempotent).toBe(true);
  });
});

describe('content.schedule — a date already in the past', () => {
  const PAST = '2020-01-01T09:00:00.000Z';

  it('refuses it by default, because the scheduler would publish it within a minute', async () => {
    // `CalendarBoard`'s drop handler blocked only the unscheduled column and
    // published slots, and there was no lower bound here — so dragging a post
    // onto an earlier day was an unlabelled "publish now" button.
    await expect(
      contentSchedule.handler(
        { contentItemId: 'ci_1', genomeId: 'gen_1', scheduledAt: PAST, publishImmediatelyIfPast: false },
        ctx(),
      ),
    ).rejects.toThrow(/already passed/);
  });

  it('allows it when the caller says so — backfilling a date is a real thing to want', async () => {
    const out = await contentSchedule.handler(
      { contentItemId: 'ci_1', genomeId: 'gen_1', scheduledAt: PAST, publishImmediatelyIfPast: true },
      ctx(),
    );
    expect(out.scheduledAt).toBe(PAST);
  });
});
