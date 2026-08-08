import { describe, it, expect } from 'vitest';
import { ToolError } from '@sparksocial/shared/types';
import { buildKey, extensionOf } from '../src/types.js';
import { createMemoryBlobStore } from '../src/memory.js';

/**
 * The key layout is a tenancy boundary in its own right: it is what makes a
 * cross-tenant leak visible in a blob listing and what per-genome retention
 * policies attach to. A key that escapes its prefix defeats both.
 */
describe('storage key layout', () => {
  const base = { orgId: 'org_1', genomeId: 'gen_1', uuid: 'abc', now: new Date('2026-08-08T00:00:00Z') };

  it('nests org, then genome, then year and month', () => {
    expect(buildKey({ ...base, filename: 'shot.MP4' })).toBe('org_1/gen_1/2026/08/abc.mp4');
  });

  it('zero-pads the month so keys sort lexicographically', () => {
    const k = buildKey({ ...base, filename: 'a.jpg', now: new Date('2026-01-05T00:00:00Z') });
    expect(k).toContain('/2026/01/');
  });

  it('refuses a key without a genome — there is no unscoped location to write to', () => {
    expect(() => buildKey({ ...base, genomeId: '', filename: 'a.jpg' })).toThrow(ToolError);
  });

  it('refuses a key without an org', () => {
    expect(() => buildKey({ ...base, orgId: '', filename: 'a.jpg' })).toThrow(ToolError);
  });

  /* ── Path traversal ─────────────────────────────────────────────────── */

  it('strips separators so a crafted id cannot escape its own prefix', () => {
    const key = buildKey({ ...base, orgId: '../../org_2', filename: 'a.jpg' });
    expect(key).not.toContain('..');
    expect(key.startsWith('org_2/')).toBe(true);
  });

  it('rejects a segment that scrubs down to nothing', () => {
    expect(() => buildKey({ ...base, genomeId: '///', filename: 'a.jpg' })).toThrow(ToolError);
  });

  it('rejects a segment that scrubs down to a dot', () => {
    expect(() => buildKey({ ...base, genomeId: '.', filename: 'a.jpg' })).toThrow(ToolError);
  });

  it('rejects a segment made only of traversal characters', () => {
    expect(() => buildKey({ ...base, genomeId: '../..', filename: 'a.jpg' })).toThrow(ToolError);
  });

  it('does not let a filename inject path structure', () => {
    const key = buildKey({ ...base, filename: '../../../etc/passwd.jpg' });
    expect(key).toBe('org_1/gen_1/2026/08/abc.jpg');
  });
});

describe('extensionOf', () => {
  it.each([
    ['clip.mp4', '.mp4'],
    ['IMAGE.JPEG', '.jpeg'],
    ['no-extension', ''],
    ['trailing.', ''],
    ['many.dots.in.name.png', '.png'],
    ['weird.thisisfartoolongtobeanextension', ''],
  ])('%s → %s', (filename, expected) => {
    expect(extensionOf(filename)).toBe(expected);
  });
});

describe('memory blob store', () => {
  it('issues distinct create and read URLs and records the key', async () => {
    const store = createMemoryBlobStore();
    const r = await store.presignUpload({ key: 'org_1/gen_1/2026/08/a.jpg', contentType: 'image/jpeg' });
    expect(r.uploadUrl).toContain('sp=c');
    expect(r.readUrl).toContain('sp=r');
    expect(store.keys).toEqual(['org_1/gen_1/2026/08/a.jpg']);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
