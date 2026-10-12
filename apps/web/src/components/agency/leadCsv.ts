import { leadDedupeKey } from '@sparksocial/shared/agencyPipeline';
import { csvColumn, parseCsvRecords, toCsv } from '@/lib/csv';

/**
 * A CSV of businesses, mapped onto what `lead.import` accepts.
 *
 * ── Why the mapping is here and not in the tool ───────────────────────────
 *
 * `lead.import` takes typed rows on purpose: Zod then rejects a bad cell by
 * name instead of the handler discovering it partway through a bulk insert. So
 * something has to turn a spreadsheet into those rows, and it belongs on the
 * side that can *show* the person the result before they commit — which is
 * this side.
 *
 * ── What it does with a row it cannot use ─────────────────────────────────
 *
 * Marks it, and imports the rest. A sheet where four rows out of two hundred
 * have no business name is the normal case, and refusing the whole file over
 * them means the person edits their export and tries again with no idea which
 * four. The preview names them so the choice is theirs.
 *
 * The dedupe key is computed here as well as server-side. Not for correctness —
 * the unique index is the guarantee — but so the preview can say "3 of these
 * are the same business" *before* the import runs, which is the difference
 * between an import that reports a surprise and one that was predicted.
 */

/** Every spelling of each column this has met in a real CRM export. */
const COLUMNS = {
  businessName: ['business name', 'business', 'company', 'company name', 'name', 'organisation', 'organization', 'account'],
  contactName: ['contact name', 'contact', 'person', 'full name', 'first name', 'owner'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'phone number', 'number'],
  location: ['location', 'city', 'address', 'town', 'area', 'region'],
  website: ['website', 'url', 'site', 'web', 'domain'],
  interest: ['interest', 'service', 'services', 'enquiry', 'inquiry', 'looking for'],
  notes: ['notes', 'note', 'comment', 'comments', 'description'],
  rating: ['rating', 'ranking', 'score', 'stars'],
} as const;

/** The shape `lead.import` takes, with every optional field omitted when blank. */
export interface LeadImportRow {
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  interest?: string;
  notes?: string;
  rating?: number;
}

export interface LeadCsvRow {
  /** 1-based, counting the header as row 1 — what the person sees in Excel. */
  line: number;
  row: LeadImportRow;
  /** Unusable: no business name, so there is nothing to key or display on. */
  problem?: string;
  /** Another row earlier in this same file is the same business. */
  duplicateOfLine?: number;
}

export interface LeadCsvPreview {
  headers: string[];
  rows: LeadCsvRow[];
  /** Rows that would actually be sent. */
  importable: LeadImportRow[];
  counts: { total: number; importable: number; unusable: number; duplicatesInFile: number };
  /** Headers this recognised, so the person can see their sheet was understood. */
  mapped: string[];
  /** True when no column looked like a business name at all — a wrong-file signal. */
  looksUnmapped: boolean;
}

/**
 * A URL only if it is already one.
 *
 * `z.string().url()` on the tool side rejects `acme.com`, which is how most
 * sheets write a website — so rather than send a row that will fail validation,
 * this prefixes a scheme when the value looks like a bare domain and drops it
 * when it looks like nothing at all. Dropping is safe: the website is optional
 * and a lead is still worth importing without it.
 */
function normaliseWebsite(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  /* A bare domain: at least one dot, no spaces, and a plausible TLD. */
  if (/^[^\s/@]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) return `https://${v}`;
  return undefined;
}

/** An email only if it could be one, since the tool validates it strictly. */
function normaliseEmail(raw: string): string | undefined {
  const v = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : undefined;
}

/** 0–5, from either a number or something like "4.5 stars". Out of range → dropped. */
function normaliseRating(raw: string): number | undefined {
  const m = raw.match(/\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : undefined;
}

const clean = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());

export function parseLeadCsv(text: string): LeadCsvPreview | null {
  if (!text.trim()) return null;

  const { headers, records } = parseCsvRecords(text);
  if (headers.length === 0) {
    return {
      headers: [],
      rows: [],
      importable: [],
      counts: { total: 0, importable: 0, unusable: 0, duplicatesInFile: 0 },
      mapped: [],
      looksUnmapped: true,
    };
  }

  const lower = headers.map((h) => h.trim().toLowerCase());
  const mapped = (Object.entries(COLUMNS) as Array<[string, readonly string[]]>)
    .filter(([, names]) => lower.some((h) => names.includes(h)))
    .map(([field]) => field);

  const rows: LeadCsvRow[] = [];
  /** dedupe key → the line that first claimed it. */
  const seen = new Map<string, number>();

  records.forEach((record, i) => {
    const line = i + 2; /* header is line 1 */

    /**
     * The business name falls back to the first column when no header matched.
     * A sheet with no header row at all is common enough that treating its
     * first column as the name recovers the whole file, and the preview shows
     * exactly what it decided.
     */
    const businessName =
      csvColumn(record, COLUMNS.businessName) || (Object.values(record)[0] ?? '').trim();

    if (!businessName) {
      rows.push({ line, row: { businessName: '' }, problem: 'No business name' });
      return;
    }

    const row: LeadImportRow = {
      businessName,
      contactName: clean(csvColumn(record, COLUMNS.contactName)),
      email: normaliseEmail(csvColumn(record, COLUMNS.email)),
      phone: clean(csvColumn(record, COLUMNS.phone)),
      location: clean(csvColumn(record, COLUMNS.location)),
      website: normaliseWebsite(csvColumn(record, COLUMNS.website)),
      interest: clean(csvColumn(record, COLUMNS.interest)),
      notes: clean(csvColumn(record, COLUMNS.notes)),
      rating: normaliseRating(csvColumn(record, COLUMNS.rating)),
    };

    /* The same key the tool and the unique index will use. */
    const key = leadDedupeKey(row);
    const first = seen.get(key);
    if (first !== undefined) {
      rows.push({ line, row, duplicateOfLine: first });
      return;
    }
    seen.set(key, line);
    rows.push({ line, row });
  });

  const importable = rows.filter((r) => !r.problem && r.duplicateOfLine === undefined).map((r) => r.row);

  return {
    headers,
    rows,
    importable,
    counts: {
      total: rows.length,
      importable: importable.length,
      unusable: rows.filter((r) => r.problem).length,
      duplicatesInFile: rows.filter((r) => r.duplicateOfLine !== undefined).length,
    },
    mapped,
    looksUnmapped: !mapped.includes('businessName') && !mapped.includes('email'),
  };
}

/* ── export ────────────────────────────────────────────────────────── */

export interface ExportableLead {
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  status: string;
  source: string;
  rating?: number;
  interest?: string;
  notes?: string;
  createdAt: string;
}

/**
 * The pipeline as a spreadsheet — the design's "Export Clients".
 *
 * Column order matches the import's own vocabulary, so a file exported here
 * re-imports cleanly. `toCsv` neutralises formula-leading cells, which matters
 * most precisely here: this is the point where third-party text leaves the
 * product for a program that would execute it.
 */
export function leadsToCsv(leads: readonly ExportableLead[]): string {
  const headers = [
    'Business Name', 'Contact Name', 'Email', 'Phone', 'Location', 'Website',
    'Status', 'Source', 'Rating', 'Interest', 'Notes', 'Added',
  ];

  return toCsv(
    headers,
    leads.map((l) => [
      l.businessName,
      l.contactName ?? '',
      l.email ?? '',
      l.phone ?? '',
      l.location ?? '',
      l.website ?? '',
      l.status,
      l.source,
      l.rating === undefined ? '' : String(l.rating),
      l.interest ?? '',
      l.notes ?? '',
      l.createdAt.slice(0, 10),
    ]),
  );
}
