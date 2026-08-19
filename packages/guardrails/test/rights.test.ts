import { describe, expect, it } from 'vitest';
import { rights } from '../src/rights.js';

describe('rights', () => {
  it('passes when every referenced asset is cleared and no likeness license is needed', () => {
    const result = rights({
      referencedAssetRights: [{ assetId: 'a1', rightsStatus: 'cleared' }],
      requiresLikenessLicense: false,
      avatarEnabled: false,
    });
    expect(result.verdict).toBe('pass');
  });

  it('blocks on any uncleared asset', () => {
    const result = rights({
      referencedAssetRights: [
        { assetId: 'a1', rightsStatus: 'cleared' },
        { assetId: 'a2', rightsStatus: 'pending' },
      ],
      requiresLikenessLicense: false,
      avatarEnabled: false,
    });
    expect(result.verdict).toBe('block');
    expect(result.rule).toBe('rights');
    expect((result.evidence as { uncleared: string[] }).uncleared).toEqual(['a2']);
  });

  it('blocks on a restricted asset', () => {
    const result = rights({
      referencedAssetRights: [{ assetId: 'a1', rightsStatus: 'restricted' }],
      requiresLikenessLicense: false,
      avatarEnabled: false,
    });
    expect(result.verdict).toBe('block');
  });

  it('blocks likeness-requiring content when avatar is not enabled — defense in depth against the resolver', () => {
    const result = rights({ referencedAssetRights: [], requiresLikenessLicense: true, avatarEnabled: false });
    expect(result.verdict).toBe('block');
    expect(result.fixAction).toContain('consent');
  });

  it('passes likeness-requiring content once avatar is enabled and assets are cleared', () => {
    const result = rights({ referencedAssetRights: [], requiresLikenessLicense: true, avatarEnabled: true });
    expect(result.verdict).toBe('pass');
  });

  it('checks asset clearance before the likeness gate', () => {
    // Both are actually violated; the asset-clearance block should surface
    // first since it names the specific asset to fix.
    const result = rights({
      referencedAssetRights: [{ assetId: 'a1', rightsStatus: 'pending' }],
      requiresLikenessLicense: true,
      avatarEnabled: false,
    });
    expect(result.verdict).toBe('block');
    expect((result.evidence as { uncleared?: string[] }).uncleared).toEqual(['a1']);
  });

  it('passes with no referenced assets and no likeness requirement', () => {
    expect(rights({ referencedAssetRights: [], requiresLikenessLicense: false, avatarEnabled: false }).verdict).toBe('pass');
  });
});
