/**
 * The validate step's row table, read from the CSV the person just picked.
 *
 * A deliberately small re-implementation of what the engine does, kept to the
 * two rules that decide what a row becomes:
 *
 *   - `csvToRecords` maps the header row onto each line, so a row is an object
 *     keyed by column name;
 *   - `runBulkConnectorCsv` takes `row.title || row.topic || <first column>` as
 *     the post's title, and a row with none of those is the one that produces
 *     "Untitled row".
 *
 * That last case is what the design marks with a warning triangle, so it is
 * what `ok: false` means here — not a guess at validity, but the same test the
 * runner applies.
 *
 * The reader itself lives in `@/lib/csv` — `apps/web` may not import
 * `@sparksocial/recipes` (CLAUDE.md § Frontend rules) and no tool parses a CSV
 * on the caller's behalf, so the app has its own, shared with the lead import
 * rather than copied per screen. This file is only the mapping onto a post.
 *
 * It is a preview only: the run reads the same text again server-side, and its
 * answer is the one that counts.
 */

import { csvColumn, parseCsvRows } from '@/lib/csv';

export interface CsvPreviewRow {
  title: string;
  media: string;
  link: string;
  /** False when the runner would fall back to "Untitled row". */
  ok: boolean;
}

export interface CsvPreview {
  headers: string[];
  rows: CsvPreviewRow[];
  valid: number;
}

export function parseCsvPreview(text: string): CsvPreview | null {
  if (!text.trim()) return null;

  const table = parseCsvRows(text);
  const [head, ...body] = table;
  if (!head) return { headers: [], rows: [], valid: 0 };

  const headers = head.map((h) => h.trim());
  const rows = body.map((line) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = line[i] ?? '';
    });

    const title = csvColumn(record, ['title', 'topic']) || (line[0] ?? '').trim();
    return {
      title,
      media: csvColumn(record, ['media', 'image', 'video', 'asset', 'media_url']),
      link: csvColumn(record, ['link', 'url', 'cta', 'cta_url']),
      /* The runner's own fallback: no title, no topic, no first column. */
      ok: title !== '',
    };
  });

  return { headers, rows, valid: rows.filter((r) => r.ok).length };
}
