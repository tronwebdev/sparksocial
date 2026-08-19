import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTrendSource } from '../src/trend-sources.js';

/**
 * `buildTrendSource`'s own job is thin — read env, decide which real sources
 * to include, hand the result to `createCompositeTrendSource` (already
 * covered in packages/trends/test/composite.test.ts). What's worth testing
 * here is the selection logic itself: stub-only when nothing is configured,
 * and that a configured-but-disabled source still doesn't run.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildTrendSource', () => {
  it('falls back to the stub source alone when nothing is configured', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', '');
    vi.stubEnv('REDDIT_CLIENT_SECRET', '');
    vi.stubEnv('YOUTUBE_API_KEY', '');
    vi.stubEnv('TREND_SOURCE_HACKERNEWS_ENABLED', '');
    vi.stubEnv('PRODUCTHUNT_CLIENT_ID', '');
    vi.stubEnv('PRODUCTHUNT_CLIENT_SECRET', '');
    vi.stubEnv('PINTEREST_ACCESS_TOKEN', '');

    const source = buildTrendSource();
    expect(source.name).toBe('stub');
    const out = await source.fetch({ limit: 5 });
    expect(out.length).toBeGreaterThan(0);
  });

  it('Hacker News is off by default even though it needs no credential', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', '');
    vi.stubEnv('REDDIT_CLIENT_SECRET', '');
    vi.stubEnv('YOUTUBE_API_KEY', '');
    vi.stubEnv('PRODUCTHUNT_CLIENT_ID', '');
    vi.stubEnv('PINTEREST_ACCESS_TOKEN', '');

    const off = buildTrendSource();
    expect(off.name).toBe('stub');

    vi.stubEnv('TREND_SOURCE_HACKERNEWS_ENABLED', 'true');
    const on = buildTrendSource();
    expect(on.name).toContain('hackernews');
  });

  it('includes Product Hunt once both OAuth credentials are set', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', '');
    vi.stubEnv('YOUTUBE_API_KEY', '');
    vi.stubEnv('PRODUCTHUNT_CLIENT_ID', 'id');
    vi.stubEnv('PRODUCTHUNT_CLIENT_SECRET', 'secret');

    const source = buildTrendSource();
    expect(source.name).toContain('producthunt');
  });

  it('includes Pinterest once an access token is set, without needing a second credential', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', '');
    vi.stubEnv('YOUTUBE_API_KEY', '');
    vi.stubEnv('PINTEREST_ACCESS_TOKEN', 'tok');

    const source = buildTrendSource();
    expect(source.name).toContain('pinterest');
  });

  it('includes a source once its credentials are set', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id');
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret');
    vi.stubEnv('YOUTUBE_API_KEY', '');

    const source = buildTrendSource();
    expect(source.name).toContain('reddit');
    expect(source.name).not.toContain('youtube');
  });

  it('a configured-but-disabled source is excluded from the composite name', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id');
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret');
    vi.stubEnv('TREND_SOURCE_REDDIT_ENABLED', 'false');
    vi.stubEnv('YOUTUBE_API_KEY', 'key');

    const source = buildTrendSource();
    expect(source.name).not.toContain('reddit');
    expect(source.name).toContain('youtube');
  });

  it('merges every configured source into one composite', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id');
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret');
    vi.stubEnv('YOUTUBE_API_KEY', 'key');

    const source = buildTrendSource();
    expect(source.name).toContain('reddit');
    expect(source.name).toContain('youtube');
  });
});
