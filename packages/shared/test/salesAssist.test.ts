import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SALES_HANDOFF,
  isCompleteSalesHandoff,
  resolveSalesHandoff,
  salesRouteFor,
} from '../src/salesAssist.js';

/**
 * Sales Assist's handoff resolution lives in `shared` because two packages on
 * opposite sides of the build order need the *same* answer: `agency` writes the
 * configuration and renders it on the settings screen, `engage` obeys it when a
 * lead is raised. A brand whose screen resolves a handoff one way while the
 * opportunity tool resolves it another is worse than no configuration — the
 * screen would be telling the owner something untrue.
 */

describe('isCompleteSalesHandoff', () => {
  it('accepts a map covering all three temperatures', () => {
    expect(isCompleteSalesHandoff({ hot: 'crm_notify', warm: 'save_notify', cold: 'nurture_only' })).toBe(true);
  });

  it('rejects a partial map', () => {
    // A partial map is not a partial preference — it is a lead with no rule.
    expect(isCompleteSalesHandoff({ hot: 'crm_notify' })).toBe(false);
    expect(isCompleteSalesHandoff({ hot: 'crm_notify', warm: 'save_notify' })).toBe(false);
  });

  it('rejects a map with a destination nothing honours', () => {
    expect(isCompleteSalesHandoff({ hot: 'email_the_ceo', warm: 'save_notify', cold: 'nurture_only' })).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isCompleteSalesHandoff(undefined)).toBe(false);
    expect(isCompleteSalesHandoff({})).toBe(false);
  });
});

describe('resolveSalesHandoff', () => {
  it('returns the brand’s own map when it is complete', () => {
    const own = { hot: 'save_notify', warm: 'nurture_only', cold: 'nurture_only' };
    expect(resolveSalesHandoff(own)).toEqual(own);
  });

  it('falls back wholesale rather than merging key-by-key', () => {
    // Merging would produce a configuration the owner never chose and cannot see
    // on their screen — half theirs, half ours, attributable to neither.
    expect(resolveSalesHandoff({ hot: 'nurture_only' })).toEqual(DEFAULT_SALES_HANDOFF);
  });

  it('defaults toward telling somebody', () => {
    // A hot lead nobody hears about is the expensive failure; a cold lead that
    // notifies is merely mildly annoying.
    expect(resolveSalesHandoff(undefined).hot).toBe('crm_notify');
    expect(resolveSalesHandoff(undefined).cold).toBe('nurture_only');
  });

  it('does not hand back a reference callers can mutate into the defaults', () => {
    const resolved = resolveSalesHandoff(undefined);
    resolved.hot = 'nurture_only';
    expect(DEFAULT_SALES_HANDOFF.hot).toBe('crm_notify');
  });
});

describe('salesRouteFor', () => {
  const handoff = { hot: 'crm_notify', warm: 'save_notify', cold: 'nurture_only' } as const;

  it('routes a crm_notify lead to the configured destination', () => {
    expect(salesRouteFor('hot', handoff, 'sales@clientforce.ai')).toBe('sales@clientforce.ai');
  });

  it('routes nowhere when crm_notify has no destination configured', () => {
    // Writing the literal "crm_notify" into `routed_to` would look like a real
    // destination in the UI while meaning nothing.
    expect(salesRouteFor('hot', handoff, undefined)).toBeUndefined();
  });

  it('leaves save_notify and nurture_only where they are', () => {
    // Both mean "keep it here", and the row already exists. Routing it anywhere
    // would be inventing a destination the owner did not ask for.
    expect(salesRouteFor('warm', handoff, 'sales@clientforce.ai')).toBeUndefined();
    expect(salesRouteFor('cold', handoff, 'sales@clientforce.ai')).toBeUndefined();
  });
});
