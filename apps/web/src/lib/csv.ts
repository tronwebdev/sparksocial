/**
 * CSV parsing and serialising for the browser.
 *
 * ── Why this exists in `apps/web` at all ──────────────────────────────────
 *
 * `packages/recipes` has a parser, and `apps/web` may not import it (CLAUDE.md
 * § Frontend rules — the app reaches `packages/` only through
 * `@sparksocial/shared`). No tool parses a CSV on the caller's behalf either:
 * `recipe.run` reads the text server-side for its own run, and `lead.import`
 * deliberately takes typed rows rather than text, so that a malformed sheet
 * fails field by field instead of halfway through a 2,000-row insert.
 *
 * So the app needs its own reader for the two places it shows a person what
 * their file contains before they commit it. This module is that reader, in one
 * place rather than copied per screen — it was already copied once, into
 * `components/automation/csvPreview.ts`, and a second copy for leads is what
 * this avoids.
 */

/**
 * RFC 4180 quoting only — quoted fields, escaped `""`, and commas or newlines
 * inside quotes.
 *
 * Not a general CSV library: no delimiter sniffing, no encoding detection, no
 * comment lines. Those belong to whatever eventually ingests a sheet for real,
 * and guessing at them in a *preview* is worse than not — a preview that
 * silently reinterprets the file disagrees with the import that follows it.
 */
export function parseCsvRows(text: string): string[][] {
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

  /* A trailing newline, or a row of empty cells Excel left behind, is not a row. */
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** First row as headers, the rest as `{header: value}` records. */
export function parseCsvRecords(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const table = parseCsvRows(text);
  const [head, ...body] = table;
  if (!head) return { headers: [], records: [] };

  const headers = head.map((h) => h.trim());
  const records = body.map((line) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (line[i] ?? '').trim();
    });
    return record;
  });

  return { headers, records };
}

/**
 * The first cell whose header matches one of `names`, case-insensitively.
 *
 * Header matching rather than column position, because a sheet exported from
 * one CRM does not put the columns where another does, and asking somebody to
 * reorder their export before importing it is how an import feature goes
 * unused.
 */
export function csvColumn(record: Record<string, string>, names: readonly string[]): string {
  for (const [key, value] of Object.entries(record)) {
    if (names.includes(key.trim().toLowerCase())) return value.trim();
  }
  return '';
}

/**
 * Serialise rows to CSV text, quoting only what needs it.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with a tab, because a spreadsheet
 * treats such a cell as a **formula**. Exporting a lead whose business name
 * somebody typed as `=cmd|...` and handing the file to Excel is CSV injection,
 * and the export is precisely where untrusted third-party text leaves this
 * product for a program that will execute it.
 */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const cell = (raw: string): string => {
    const v = /^[=+\-@]/.test(raw) ? `\t${raw}` : raw;
    return /[",\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };

  return [headers, ...rows].map((r) => r.map((c) => cell(c ?? '')).join(',')).join('\r\n');
}
