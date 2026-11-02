import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The queue said "3 have no copy yet" after all three had been drafted.
 *
 * The Draft Panel writes posts; the lists beside it read `content.list` once.
 * `contentEvents` joins them — the panel announces, the lists re-read. These
 * pin both ends, because either one going missing is silent: the screen just
 * shows yesterday's numbers until somebody reloads.
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

describe('the Draft Panel announces post changes', () => {
  const panel = src('components/command-center/draft-panel/DraftPanel.tsx');

  it('when a draft or generation lands', () => {
    expect(panel).toMatch(/function finishJob[\s\S]{0,200}announceContentChanged\(\)/);
  });

  it('when the panel closes, for every edit made behind the drawer', () => {
    expect(panel).toMatch(/if \(wasOpen\.current && !open\) announceContentChanged\(\)/);
  });
});

describe('every list of posts beside it re-reads', () => {
  for (const rel of [
    'components/command-center/PlanQueue.tsx',
    'components/command-center/CalendarMonthGrid.tsx',
    'components/command-center/DraftList.tsx',
    'components/calendar/useCalendarSlots.ts',
  ]) {
    it(rel.split('/').pop()!, () => {
      const code = src(rel);
      expect(code).toContain('const contentRev = useContentRevision();');
      expect(code).toMatch(/\}, \[[^\]]*contentRev\]\);/);
    });
  }
});
