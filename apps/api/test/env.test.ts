import { afterEach, describe, expect, it, vi } from 'vitest';
import { envBool, envList, envNum, envSet, envStr } from '../src/env.js';

/**
 * Present-but-empty must mean absent.
 *
 * `.env.example` ships every optional key as `KEY=`, and copying it to `.env`
 * is the documented first step — so this is the *default* state of a fresh
 * checkout, not an edge case. `??` does not fall back on `''`, so every default
 * in the API silently stopped applying.
 *
 * Found when the seeded golden set became unreachable: `DEV_SEED_ORG_ID=` seeded
 * every genome under the org id `''`, and `genome.list` returned an empty array
 * against a store that held three.
 */

const KEY = 'SPARK_TEST_ENV_KEY';
afterEach(() => {
  delete process.env[KEY];
  vi.restoreAllMocks();
});

describe('envStr', () => {
  it('falls back when unset', () => {
    expect(envStr(KEY, 'fallback')).toBe('fallback');
  });

  it('falls back when present but empty — the case that broke the golden set', () => {
    process.env[KEY] = '';
    expect(envStr(KEY, 'org_dev')).toBe('org_dev');
  });

  it('falls back on whitespace only', () => {
    // A trailing space after `=` in a .env file is invisible and common.
    process.env[KEY] = '   ';
    expect(envStr(KEY, 'org_dev')).toBe('org_dev');
  });

  it('uses a real value, trimmed', () => {
    process.env[KEY] = '  org_real  ';
    expect(envStr(KEY, 'org_dev')).toBe('org_real');
  });
});

describe('envNum', () => {
  it('falls back when empty rather than returning zero', () => {
    /**
     * `Number('')` is 0, which is why this is worse than a missing default:
     * an empty `DEV_MONTHLY_CAP_CENTS` set the spend cap to zero and denied
     * every paid tool call, and an empty `PORT` bound port 0 — an arbitrary
     * free port, on a server that reports it started successfully.
     */
    process.env[KEY] = '';
    expect(envNum(KEY, 8080)).toBe(8080);
  });

  it('falls back on a value that is not a number', () => {
    // `NaN` compared against anything is false, so a typo'd cap would not
    // throw — it would make every budget check pass.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[KEY] = 'eighty-eighty';
    expect(envNum(KEY, 8080)).toBe(8080);
  });

  it('says so when it rejects a value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[KEY] = 'abc';
    envNum(KEY, 1);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps a real zero', () => {
    // Distinct from empty: someone writing `0` means zero.
    process.env[KEY] = '0';
    expect(envNum(KEY, 8080)).toBe(0);
  });

  it('parses a real value', () => {
    process.env[KEY] = '2';
    expect(envNum(KEY, 500)).toBe(2);
  });
});

describe('envSet', () => {
  it('treats an empty credential as unconfigured', () => {
    // Every "real client or fake?" seam keys on this. `KEY=` is present, so
    // without the emptiness check they all select the real client and fail on
    // the first request with a vendor auth error instead of a local warning.
    process.env[KEY] = '';
    expect(envSet(KEY)).toBe(false);
  });

  it('recognises a real credential', () => {
    process.env[KEY] = 'sk-abc';
    expect(envSet(KEY)).toBe(true);
  });
});

describe('envList', () => {
  it('falls back when empty', () => {
    // An empty CLERK_AUTHORIZED_PARTIES produced `['']` → filtered to `[]` →
    // the resolver refusing to start. Loud, at least, unlike the others.
    process.env[KEY] = '';
    expect(envList(KEY, ['http://localhost:3000'])).toEqual(['http://localhost:3000']);
  });

  it('splits and trims', () => {
    process.env[KEY] = 'https://a.example, https://b.example';
    expect(envList(KEY, [])).toEqual(['https://a.example', 'https://b.example']);
  });

  it('drops empty entries from a trailing comma', () => {
    process.env[KEY] = 'https://a.example,,';
    expect(envList(KEY, [])).toEqual(['https://a.example']);
  });
});

describe('envBool', () => {
  it('falls back when unset', () => {
    expect(envBool(KEY, true)).toBe(true);
    expect(envBool(KEY, false)).toBe(false);
  });

  it('falls back when present but empty — same "empty means absent" rule as the others', () => {
    process.env[KEY] = '';
    expect(envBool(KEY, true)).toBe(true);
  });

  it('recognises common false spellings, case-insensitively', () => {
    for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
      process.env[KEY] = v;
      expect(envBool(KEY, true), v).toBe(false);
    }
  });

  it('recognises common true spellings, case-insensitively', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on']) {
      process.env[KEY] = v;
      expect(envBool(KEY, false), v).toBe(true);
    }
  });

  it('warns and falls back on an unrecognised value, rather than guessing which way a typo leans', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[KEY] = 'disbaled';
    expect(envBool(KEY, true)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
