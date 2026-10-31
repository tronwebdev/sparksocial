/**
 * The two shapes this screen reads, as the tools actually return them —
 * `asset.folder.list` and `asset.retrieve` (see `AssetsLibraryScreen`).
 */

export interface Folder {
  folderId: string;
  name: string;
  createdAt: string;
  assetCount: number;
}

export interface Asset {
  assetId: string;
  role: string;
  caption: string | null;
  url: string;
  mediaType: string;
  /** Null on rows uploaded before the column existed — the caption stands in. */
  filename: string | null;
  /** Null for the same reason, and why a folder total can be "partly unknown". */
  sizeBytes: number | null;
  createdAt: string;
  folderId: string | null;
  rightsStatus: string;
  usageCount: number;
}

/**
 * The design's two type chips are Video (magenta) and Image (purple); Audio,
 * PDF, Text and File are this codebase's, in the same shape.
 *
 * `mediaType` is the Asset Graph's own word — `image`/`video`/`audio`/
 * `document` — not a MIME type, so the prefix test is what matches both it and
 * the `image/png` form older rows carry.
 */
export type AssetKind = 'Video' | 'Image' | 'Audio' | 'PDF' | 'Text' | 'File';

/**
 * `url` separates the one `document` that is not a file. A crawled website or
 * pasted guidelines are registered as a knowledge asset whose url is a
 * `knowledge:` reference (`registerKnowledgeAsset`) — the text lives in
 * `knowledge_chunks`, and there is nothing at that address to frame or open.
 * Calling it a PDF put a blank iframe in the preview and a dead "Open original".
 */
export function assetKind(mediaType: string, url = ''): AssetKind {
  if (url.startsWith(KNOWLEDGE)) return 'Text';
  if (mediaType.startsWith('video')) return 'Video';
  if (mediaType.startsWith('image')) return 'Image';
  if (mediaType.startsWith('audio')) return 'Audio';
  if (mediaType.startsWith('document') || mediaType === 'application/pdf') return 'PDF';
  return 'File';
}

const KNOWLEDGE = 'knowledge:';

/**
 * The page a knowledge asset was read from — `knowledge:https://…` for a crawl
 * — or null for pasted text, whose reference is a chunk id with nowhere to go.
 */
export function knowledgeSource(url: string): string | null {
  if (!url.startsWith(KNOWLEDGE)) return null;
  const rest = url.slice(KNOWLEDGE.length);
  return /^https?:\/\//i.test(rest) ? rest : null;
}

export function assetName(a: Asset): string {
  return a.filename ?? a.caption ?? 'Untitled asset';
}

/** "Oct 2, 2024 - 12:45PM", the format under every card and in the date column. */
export function assetStamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).replace(' ', '');
  return `${date} - ${time}`;
}
