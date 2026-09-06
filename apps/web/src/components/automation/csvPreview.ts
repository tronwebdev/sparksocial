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
 * `apps/web` may not import `@sparksocial/recipes` (CLAUDE.md § Frontend
 * rules), and no tool parses a CSV on the caller's behalf, so this is a copy.
 * It is a preview only: the run reads the same text again server-side, and its
 * answer is the one that counts.
 */

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

/** RFC 4180 quoting only — quoted fields, escaped `""`, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Pick the first column whose header looks like one of `names`. */
function column(record: Record<string, string>, names: readonly string[]): string {
  for (const [key, value] of Object.entries(record)) {
    if (names.includes(key.trim().toLowerCase())) return value.trim();
  }
  return '';
}

export function parseCsvPreview(text: string): CsvPreview | null {
  if (!text.trim()) return null;

  const table = parseCsv(text);
  const [head, ...body] = table;
  if (!head) return { headers: [], rows: [], valid: 0 };

  const headers = head.map((h) => h.trim());
  const rows = body.map((line) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = line[i] ?? '';
    });

    const title = column(record, ['title', 'topic']) || (line[0] ?? '').trim();
    return {
      title,
      media: column(record, ['media', 'image', 'video', 'asset', 'media_url']),
      link: column(record, ['link', 'url', 'cta', 'cta_url']),
      /* The runner's own fallback: no title, no topic, no first column. */
      ok: title !== '',
    };
  });

  return { headers, rows, valid: rows.filter((r) => r.ok).length };
}
