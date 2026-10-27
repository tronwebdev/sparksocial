import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { humaniseGoal } from '../src/lib/runGoal';

const NONE = new Map<string, string>();

describe('a run’s goal, as something a person reads', () => {
  it('keeps what the user typed and names the post instead of its id', () => {
    const titles = new Map([['e7c14d12-6755-44c6-ac1a-fbddbcaacfa4', 'Our new menu']]);
    expect(
      humaniseGoal(
        'Edit content item e7c14d12-6755-44c6-ac1a-fbddbcaacfa4 in genome 9bcf18fc-a707-4dc2-a49c-37699c624776. Now: make this less pushy Use the content.* tools. Change only what I asked for, and say what you changed',
        titles,
      ),
    ).toBe('Edit “Our new menu” — make this less pushy');
  });

  /* The brief SPARK writes for a subagent, as it reached the dashboard. */
  it('never shows a brand id from a delegation brief', () => {
    const out = humaniseGoal(
      'Retrieve the current content calendar and any active campaign for this brand (genomeId 2488468f-f3a4-4d25-bf1f-1551538c0793). I need the substance, not the config.',
      NONE,
    );
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(out).not.toContain('genomeId');
    expect(out).not.toContain('()');
    expect(out).toContain('Retrieve the current content calendar');
  });

  it('leaves a plain question exactly as it was typed', () => {
    expect(humaniseGoal('what is my agent waiting on?', NONE)).toBe('what is my agent waiting on?');
  });
});

describe('the lists of things you asked list only what you asked', () => {
  const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('drops subagent runs from the dashboard’s Agent Activity', () => {
    expect(src('src/components/dashboard/AgentActivityFeed.tsx')).toContain('all.filter((r) => !r.parentRunId)');
  });

  it('drops them from My conversations too', () => {
    expect(src('src/components/command-center/ChatDrawer.tsx')).toContain('.filter((r) => !r.parentRunId)');
  });
});
