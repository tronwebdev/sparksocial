import { describe, expect, it } from 'vitest';
import { parse } from '../src/components/command-center/ChatText';

/**
 * The chat drawer's reply formatting. Replies arrive as Markdown and were
 * printed as one paragraph of literal asterisks; these are real shapes the
 * agent produced on production.
 */
describe('a SPARK reply is parsed into blocks', () => {
  it('keeps paragraphs, headings and both list kinds apart', () => {
    const blocks = parse(
      "Here's where it stands:\n\n## Status\n- **Running** — not paused.\n- Cadence: 3 per week.\n\n**Two things:**\n1. Nothing has a platform.\n2. The clock matters.",
    );
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'h', 'ul', 'p', 'ol']);
    expect(blocks[2]).toEqual({ kind: 'ul', items: ['**Running** — not paused.', 'Cadence: 3 per week.'] });
    expect(blocks[4]).toMatchObject({ kind: 'ol', start: 1, items: ['Nothing has a platform.', 'The clock matters.'] });
  });

  it('turns a table into rows and drops its header rule', () => {
    const blocks = parse('| Field | Value |\n|---|---|\n| Objective | **sales** |\n| Window | 30 days |');
    expect(blocks).toEqual([
      { kind: 'table', rows: [['Field', 'Value'], ['Objective', '**sales**'], ['Window', '30 days']] },
    ]);
  });

  it('keeps consecutive plain lines in one paragraph', () => {
    expect(parse('line one\nline two')).toEqual([{ kind: 'p', lines: ['line one', 'line two'] }]);
  });

  it('folds an indented continuation into the list item above it', () => {
    expect(parse('- first item\n  continues here\n- second')).toEqual([
      { kind: 'ul', items: ['first item continues here', 'second'] },
    ]);
  });

  it('treats text with no Markdown as a paragraph, not as nothing', () => {
    expect(parse('Done, nothing further to report.')).toEqual([
      { kind: 'p', lines: ['Done, nothing further to report.'] },
    ]);
  });
});
