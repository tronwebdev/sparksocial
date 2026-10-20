import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { chunkText, makeBrandKnowledgeAttachDocument } from '../src/brand.js';

/**
 * `brand.knowledge.attach_document` — F6's "Upload company Docs (PDF)".
 *
 * Two things are worth pinning. The **scanned PDF**, because it is the common
 * failure and it fails quietly: the parse succeeds, the text is empty, and
 * without a check the brand is told its guideline was read. And the **chunking**,
 * because a whole guideline arriving as one chunk would match every query about
 * the brand equally and rank against nothing.
 */

const GUIDELINE = [
  'Northside Barbers brand guideline',
  '',
  'What we do',
  'Cuts for men who want to look sharp without booking a whole afternoon.',
  '',
  'What we never say',
  'Cheapest in town. Guaranteed results.',
].join('\n');

function ctx(over: { attached?: unknown[]; createAsset?: (args: unknown) => Promise<{ id: string }> } = {}): ToolCtx {
  const attached = over.attached ?? [];
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      knowledge: {
        attach: async (args: unknown) => {
          attached.push(args);
          return { id: `k_${attached.length}`, docId: (args as { docId: string }).docId };
        },
      },
      /* `registerKnowledgeAsset` writes here. Absent before, which meant it
         threw into its own catch and the tests passed while proving nothing
         about the asset row — and `as unknown as ToolCtx` kept the compiler
         quiet about it. */
      assets: { create: over.createAsset ?? (async () => ({ id: 'asset_1' })) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const deps = (text: string, pages = 2) => ({
  embed: { embed: async () => Array.from({ length: 8 }, () => 0.1) },
  reader: { read: async () => ({ text, pages }) },
});

describe('brand.knowledge.attach_document', () => {
  it('attaches the extracted text and reports what was read', async () => {
    const attached: unknown[] = [];
    const tool = makeBrandKnowledgeAttachDocument(deps(GUIDELINE) as never);
    const out = await tool.handler(
      { genomeId: 'gen_1', url: 'https://blob.example/guide.pdf', filename: 'guide.pdf' },
      ctx({ attached }),
    );

    expect(out).toMatchObject({ docId: 'doc:guide.pdf', pages: 2, chunks: 1 });
    expect(out.characters).toBeGreaterThan(100);
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({
      genomeId: 'gen_1',
      orgId: 'org_1',
      // Part number in the id, so re-attaching a corrected document is visibly a
      // second copy rather than an invisible merge.
      docId: 'doc:guide.pdf#1',
      citation: { label: 'guide.pdf' },
    });
  });

  it('refuses a scanned PDF by name rather than attaching nothing quietly', async () => {
    // The parse succeeds and the text is empty. Without this the brand is told
    // its guideline was read and then wonders why the agent knows none of it.
    const tool = makeBrandKnowledgeAttachDocument(deps('   \n  \n ', 12) as never);
    const err = await tool
      .handler({ genomeId: 'gen_1', url: 'https://blob.example/scan.pdf', filename: 'scan.pdf' }, ctx())
      .catch((e: unknown) => e);

    expect((err as ToolError).code).toBe('INVALID_INPUT');
    expect((err as ToolError).message).toContain('scan');
  });

  it('splits a long document into several chunks, each cited', async () => {
    const attached: unknown[] = [];
    const long = `${'Every claim we can stand behind. '.repeat(900)}`;
    const tool = makeBrandKnowledgeAttachDocument(deps(long, 40) as never);
    const out = await tool.handler(
      { genomeId: 'gen_1', url: 'https://blob.example/long.pdf', filename: 'long.pdf' },
      ctx({ attached }),
    );

    expect(out.chunks).toBeGreaterThan(1);
    expect(attached).toHaveLength(out.chunks);
    for (const [i, call] of attached.entries()) {
      expect(call).toMatchObject({ docId: `doc:long.pdf#${i + 1}`, citation: { label: 'long.pdf' } });
    }
  });

  it('caps how much of one document is embedded', async () => {
    // Past forty chunks somebody has uploaded the wrong file, and the honest
    // answer is to stop rather than embed a novel.
    const tool = makeBrandKnowledgeAttachDocument(deps('word '.repeat(200_000), 900) as never);
    const out = await tool.handler(
      { genomeId: 'gen_1', url: 'https://blob.example/novel.pdf', filename: 'novel.pdf' },
      ctx(),
    );
    expect(out.chunks).toBe(40);
  });

  it('is write/auto/non-idempotent, family brand', () => {
    const tool = makeBrandKnowledgeAttachDocument(deps(GUIDELINE) as never);
    expect(tool.effect).toBe('write');
    expect(tool.autonomy).toBe('auto');
    // Attaching the same document twice is two copies in retrieval, not a
    // refresh — the same reasoning `brand.knowledge.attach` gives.
    expect(tool.idempotent).toBe(false);
    expect(toolFamily(tool.name)).toBe('brand');
  });
});

describe('chunkText', () => {
  it('returns one chunk for anything inside the budget', () => {
    expect(chunkText('short', 100)).toEqual(['short']);
  });

  it('breaks on a paragraph boundary rather than mid-sentence', () => {
    // Splitting mid-sentence is what makes a retrieved chunk unquotable — the
    // answer cites half a claim.
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    const out = chunkText(text, 80);
    expect(out[0]).toBe('a'.repeat(60));
    expect(out[1]).toBe('b'.repeat(60));
  });

  it('ignores a break too early to be worth honouring', () => {
    // A paragraph ending at character 5 of an 80-character budget would produce
    // a chunk per line.
    const text = `ab\n\n${'c'.repeat(200)}`;
    const out = chunkText(text, 80);
    expect(out[0]!.length).toBe(80);
  });

  it('covers the whole input, in order, with nothing lost', () => {
    const text = 'x'.repeat(250);
    const out = chunkText(text, 80);
    expect(out.join('')).toBe(text);
  });
});

/**
 * The asset id, which the Assets Library now depends on.
 *
 * That panel used to upload a PDF through `asset.ingest_url`: an asset row with
 * the `knowledge` role and no text extracted, so it satisfied the role gate —
 * unlocking seven playbooks — while `knowledge.list` stayed empty and the
 * writer never saw a word of the file. A knowledge asset with nothing behind it
 * is worse than none, because it reports a capability the brand does not have.
 *
 * It now calls this tool instead, which reads the file *and* registers the one
 * row, and needs the id back to put the upload in the folder that was open.
 */
describe('the registered asset is reported back', () => {
  it('returns the assetId so a caller can file the upload', async () => {
    const tool = makeBrandKnowledgeAttachDocument(deps(GUIDELINE) as never);

    const out = await tool.handler(
      { genomeId: 'gen_1', url: 'https://files.test/handbook.pdf', filename: 'handbook.pdf' },
      ctx({ createAsset: async () => ({ id: 'asset_xyz' }) }),
    );

    expect(out.assetId).toBe('asset_xyz');
    expect(out.chunks).toBeGreaterThan(0);
  });

  /*
   * Registration is deliberately non-fatal — the chunks are what this tool
   * promises and they are already written. The caller skips the folder move
   * rather than reporting the upload as lost.
   */
  it('omits the assetId rather than failing when the row cannot be written', async () => {
    const tool = makeBrandKnowledgeAttachDocument(deps(GUIDELINE) as never);

    const out = await tool.handler(
      { genomeId: 'gen_1', url: 'https://files.test/handbook.pdf', filename: 'handbook.pdf' },
      ctx({ createAsset: async () => { throw new Error('assets unavailable'); } }),
    );

    expect(out.assetId).toBeUndefined();
    expect(out.chunks).toBeGreaterThan(0);
  });
});
