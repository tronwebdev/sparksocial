import { describe, expect, it } from 'vitest';
import { assetKind, knowledgeSource } from '../src/components/assets/library/types';
import { folderSize } from '../src/components/assets/AssetsLibraryScreen';
import type { Asset } from '../src/components/assets/library/types';

/**
 * What the Assets Library calls a thing, and so how it draws and previews it.
 *
 * The case that prompted these: a crawled website is registered as a
 * `document` asset at a `knowledge:` reference. It was labelled PDF, previewed
 * in an iframe pointed at an address no browser can load, and offered an
 * "Open original" that went nowhere.
 */
describe('assetKind', () => {
  it('calls a knowledge reference Text, whatever its media type', () => {
    expect(assetKind('document', 'knowledge:https://www.monmouthcoffee.co.uk/')).toBe('Text');
    expect(assetKind('document', 'knowledge:brand-guidelines')).toBe('Text');
  });

  it('still calls an uploaded document a PDF — the only document the library accepts', () => {
    expect(assetKind('document', 'https://cdn.example/org/gen/menu.pdf')).toBe('PDF');
    expect(assetKind('application/pdf')).toBe('PDF');
  });

  it('reads media by prefix, so old MIME-typed rows still match', () => {
    expect(assetKind('image/png', 'https://cdn.example/a.png')).toBe('Image');
    expect(assetKind('video')).toBe('Video');
    expect(assetKind('audio/mpeg')).toBe('Audio');
    expect(assetKind('application/zip')).toBe('File');
  });
});

describe('knowledgeSource', () => {
  it('returns the page a crawl read', () => {
    expect(knowledgeSource('knowledge:https://www.monmouthcoffee.co.uk/')).toBe('https://www.monmouthcoffee.co.uk/');
  });

  it('returns nothing for pasted text, whose reference is a chunk id', () => {
    expect(knowledgeSource('knowledge:brand-guidelines')).toBeNull();
  });

  it('returns nothing for an ordinary file', () => {
    expect(knowledgeSource('https://cdn.example/a.png')).toBeNull();
  });

  it('does not hand a script URL to a link', () => {
    expect(knowledgeSource('knowledge:javascript:alert(1)')).toBeNull();
  });
});

describe('folderSize', () => {
  const asset = (sizeBytes: number | null): Asset => ({
    assetId: Math.random().toString(36),
    role: 'knowledge',
    caption: null,
    url: 'https://cdn.example/a',
    mediaType: 'image',
    filename: null,
    sizeBytes,
    createdAt: '2026-10-31T00:00:00Z',
    folderId: null,
    rightsStatus: 'cleared',
    usageCount: 0,
  });

  it('sums the sizes when every file has one', () => {
    expect(folderSize([asset(2 * 1024 ** 2), asset(3 * 1024 ** 2)])).toBe('5MB');
  });

  it('says partly when only some are unknown', () => {
    expect(folderSize([asset(1024), asset(null)])).toBe('size partly unknown');
  });

  it('says unknown, not partly, when none has a size', () => {
    expect(folderSize([asset(null), asset(null)])).toBe('size unknown');
  });
});
