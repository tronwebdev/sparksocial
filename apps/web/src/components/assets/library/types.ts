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
 * PDF and File are this codebase's, in the same shape.
 *
 * `mediaType` is the Asset Graph's own word — `image`/`video`/`audio`/
 * `document` — not a MIME type, so the prefix test is what matches both it and
 * the `image/png` form older rows carry.
 */
export function assetKind(mediaType: string): 'Video' | 'Image' | 'Audio' | 'PDF' | 'File' {
  if (mediaType.startsWith('video')) return 'Video';
  if (mediaType.startsWith('image')) return 'Image';
  if (mediaType.startsWith('audio')) return 'Audio';
  if (mediaType.startsWith('document') || mediaType === 'application/pdf') return 'PDF';
  return 'File';
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
