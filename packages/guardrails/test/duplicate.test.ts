import { describe, expect, it } from 'vitest';
import { duplicate } from '../src/duplicate.js';

const noRefs = { referencedAssetIds: [] as string[], assetLastUsedDaysAgo: {} };

describe('duplicate — text similarity', () => {
  it('passes an unrelated draft against unrelated recent posts', () => {
    const result = duplicate({
      draftEmbedding: [1, 0, 0],
      recentPublishedEmbeddings: [[0, 1, 0], [0, 0, 1]],
      ...noRefs,
    });
    expect(result.verdict).toBe('pass');
  });

  it('flags a near-identical restatement (cosine similarity above threshold)', () => {
    const result = duplicate({
      draftEmbedding: [1, 0, 0],
      recentPublishedEmbeddings: [[0.99, 0.01, 0], [0, 1, 0]],
      ...noRefs,
    });
    expect(result.verdict).toBe('flag');
    expect(result.rule).toBe('duplicate');
  });

  it('passes with no recent published posts to compare against', () => {
    const result = duplicate({ draftEmbedding: [1, 0, 0], recentPublishedEmbeddings: [], ...noRefs });
    expect(result.verdict).toBe('pass');
  });

  it('respects a custom similarity threshold', () => {
    // cosine([1,0,0], [0.5,0.5,0.5]) ≈ 0.577 — related but not a restatement.
    const args = { draftEmbedding: [1, 0, 0], recentPublishedEmbeddings: [[0.5, 0.5, 0.5]], ...noRefs };
    expect(duplicate(args).verdict).toBe('pass'); // under the default 0.92 threshold
    expect(duplicate({ ...args, similarityThreshold: 0.5 }).verdict).toBe('flag'); // over a stricter 0.5
  });
});

describe('duplicate — asset reuse cooldown', () => {
  const base = { draftEmbedding: [1, 0, 0], recentPublishedEmbeddings: [] as number[][] };

  it('passes an asset never used before', () => {
    const result = duplicate({ ...base, referencedAssetIds: ['a1'], assetLastUsedDaysAgo: { a1: undefined } });
    expect(result.verdict).toBe('pass');
  });

  it('flags an asset used within the cooldown window', () => {
    const result = duplicate({ ...base, referencedAssetIds: ['a1'], assetLastUsedDaysAgo: { a1: 2 } });
    expect(result.verdict).toBe('flag');
    expect((result.evidence as { assetsInCooldown: string[] }).assetsInCooldown).toContain('a1');
  });

  it('passes an asset used outside the cooldown window', () => {
    const result = duplicate({ ...base, referencedAssetIds: ['a1'], assetLastUsedDaysAgo: { a1: 30 } });
    expect(result.verdict).toBe('pass');
  });

  it('respects a custom cooldown', () => {
    const result = duplicate({ ...base, referencedAssetIds: ['a1'], assetLastUsedDaysAgo: { a1: 10 }, cooldownDays: 14 });
    expect(result.verdict).toBe('flag');
  });

  it('names every asset in cooldown, not just the first', () => {
    const result = duplicate({
      ...base,
      referencedAssetIds: ['a1', 'a2', 'a3'],
      assetLastUsedDaysAgo: { a1: 1, a2: 100, a3: 3 },
    });
    expect((result.evidence as { assetsInCooldown: string[] }).assetsInCooldown).toEqual(['a1', 'a3']);
  });
});
