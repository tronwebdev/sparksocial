import { createRequire } from 'node:module';
import { ToolError } from '@sparksocial/shared';
import type { DocumentReader } from '@sparksocial/agency';

/**
 * PDF TEXT, FOR `brand.knowledge.attach_document` — F6's "Upload company Docs".
 *
 * `pdf-parse` lives here rather than in `packages/agency` for the same reason
 * the embed client does: the tool declares what it needs and the app supplies
 * it, so the package stays testable without a parser and the parser stays out
 * of every bundle that imports the registry.
 *
 * `createRequire` because `pdf-parse` is CommonJS with a default export that
 * `import` resolves to a module namespace rather than the function under this
 * monorepo's settings — a real interop wart, not a stylistic choice.
 */
const require = createRequire(import.meta.url);
type PdfParse = (data: Buffer) => Promise<{ text: string; numpages: number }>;

/** Past this, the download is the problem rather than the parse. */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * 25MB. The prototype's dropzone says "up to 500MB", which is a number nobody
 * measured: a 500MB PDF is not a brand guideline, and parsing one in-process
 * would take the API down for every other request while it ran. The cap is
 * stated to the owner rather than discovered by them.
 */
const MAX_BYTES = 25 * 1024 * 1024;

export function createDocumentReader(): DocumentReader {
  let parse: PdfParse | undefined;

  return {
    async read(url) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

      let bytes: Buffer;
      try {
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) {
          throw new ToolError('UPSTREAM_FAILED', `Could not download that document (${res.status}).`, { url });
        }
        /**
         * Checked before reading the body, and again after. The header is a
         * claim; the length is a fact. Trusting only the header lets a
         * mislabelled response allocate whatever it likes.
         */
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared > MAX_BYTES) {
          throw new ToolError('INVALID_INPUT', 'That file is larger than 25MB.', { bytes: declared });
        }
        bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > MAX_BYTES) {
          throw new ToolError('INVALID_INPUT', 'That file is larger than 25MB.', { bytes: bytes.length });
        }
      } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError('UPSTREAM_FAILED', 'That document could not be downloaded.', {
          reason: e instanceof Error ? e.message : String(e),
        });
      } finally {
        clearTimeout(timer);
      }

      // Cheaper than a parse and a much clearer error: a JPEG renamed to .pdf
      // otherwise fails deep inside the parser with something unquotable.
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new ToolError('INVALID_INPUT', 'That file is not a PDF.', {});
      }

      parse ??= require('pdf-parse') as PdfParse;
      try {
        const out = await parse(bytes);
        return { text: out.text, pages: out.numpages };
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', 'That PDF could not be read — it may be encrypted or damaged.', {
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
}
