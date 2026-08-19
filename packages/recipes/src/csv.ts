/**
 * CSV parsing for the Bulk Connector's `csv` sub-kind (plan §12 P5,
 * `AUTO-01`→`AUTO-04.4`).
 *
 * RFC 4180 quoting only — quoted fields, escaped `""`, embedded commas and
 * newlines inside quotes. No dialect sniffing (delimiter is always `,`),
 * which covers every export a spreadsheet tool actually produces and keeps
 * this a few dozen lines instead of a dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

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
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow — \r\n handled by the following \n
    } else {
      field += c;
    }
  }
  // Trailing field/row when the input doesn't end in a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** First row as headers, rest as `{header: value}` records — the shape a Bulk Connector preview needs. */
export function csvToRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
