import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_RUNGS,
  rungAutonomy,
  rungFromBrandAutonomy,
  salesAssistApplies,
  type EngagementRung,
} from '../src/campaignAutonomy.js';

/**
 * The engagement ladder's three functions (`CMP-01`, F8 — four rungs with the
 * Sales Assist configuration on top, decided 22 August).
 *
 * These are pure lookups, which is exactly why they are worth pinning: they are
 * the single definition of "may this campaign reply" and "do the handoff rules
 * apply", read by `packages/engage`, `packages/campaign` and the wizard. A
 * silent change here changes what the agent does to somebody's inbox.
 */

describe('rungAutonomy', () => {
  it('maps the four rungs onto the three-value vocabulary the reply path reads', () => {
    expect(rungAutonomy('observe')).toBe('off');
    expect(rungAutonomy('suggest')).toBe('suggest');
    expect(rungAutonomy('auto_reply')).toBe('auto');
    // `sales_assist` IS auto-reply plus a configuration. A rung that answered
    // replies differently from `auto_reply` would make the ladder two ladders.
    expect(rungAutonomy('sales_assist')).toBe('auto');
  });

  it('treats an unset rung as off', () => {
    // A campaign predating the question has not opted in, and the direction to
    // fail in is the one where nothing is sent.
    expect(rungAutonomy(undefined)).toBe('off');
  });

  it('answers for every rung, so a new one cannot default to silence', () => {
    for (const rung of ENGAGEMENT_RUNGS) {
      expect(['off', 'suggest', 'auto']).toContain(rungAutonomy(rung));
    }
    expect(ENGAGEMENT_RUNGS).toHaveLength(4);
  });
});

describe('rungFromBrandAutonomy', () => {
  it('widens the brand template onto the ladder', () => {
    expect(rungFromBrandAutonomy('off')).toBe('observe');
    expect(rungFromBrandAutonomy('suggest')).toBe('suggest');
    expect(rungFromBrandAutonomy('auto')).toBe('auto_reply');
  });

  it('does not promote `auto` onto the top rung', () => {
    // The whole point of writing the widening down once: a brand that only ever
    // said "answer the safe ones" has not asked for lead qualification or
    // handoff routing, and `sales_assist` would grant both.
    expect(rungFromBrandAutonomy('auto')).not.toBe('sales_assist');
  });

  it('treats an unset brand setting as the bottom rung', () => {
    expect(rungFromBrandAutonomy(undefined)).toBe('observe');
  });

  it('round-trips through rungAutonomy, so the wizard and the server agree', () => {
    // The wizard preselects with this function and the reply path reads the
    // result through `rungAutonomy`. If these two disagreed, a screen showing
    // "Suggest replies" could produce a campaign that sends unattended.
    for (const autonomy of ['off', 'suggest', 'auto'] as const) {
      expect(rungAutonomy(rungFromBrandAutonomy(autonomy))).toBe(autonomy);
    }
  });
});

describe('salesAssistApplies', () => {
  it('applies on the top rung only', () => {
    const below: EngagementRung[] = ['observe', 'suggest', 'auto_reply'];
    for (const rung of below) expect(salesAssistApplies(rung)).toBe(false);
    expect(salesAssistApplies('sales_assist')).toBe(true);
    expect(salesAssistApplies(undefined)).toBe(false);
  });
});
