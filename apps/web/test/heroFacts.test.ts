import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Source with the comments taken out — they quote the copy they replaced. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const HERO = code('apps/web/src/components/command-center/CampaignFocusCard.tsx');
const OVERVIEW = code('apps/web/src/components/command-center/CommandCenterOverview.tsx');
const INTRO = code('apps/web/src/components/campaign/CampaignIntro.tsx');
const WIZARD = code('apps/web/src/components/campaign/CampaignWizard.tsx');

/**
 * Two slots that printed something other than what they were labelled.
 *
 * Both were the same mistake in different places: a screen asked a question,
 * got no answer because nothing exposed one, and wrote down a plausible
 * substitute instead of saying so. "Primary CTA" rendered an em dash for every
 * brand under a comment asserting the field did not exist — it did, on its own
 * column, read verbatim by fourteen playbook `cta` beats; `genome.get` just
 * never returned it. The wizard's entry card told every arrival to create its
 * "first campaign", including a brand with one running and an agent drafting
 * copy for it.
 */
describe('the hero shows the brand\'s own call-to-action', () => {
  it('renders the value rather than a hardcoded dash', () => {
    expect(HERO).toContain('primaryCta');
    // The em dash survives as the unset state, not as the only state.
    expect(HERO).toMatch(/\{primaryCta \|\| '\u2014'\}/);
    expect(HERO).not.toContain('A campaign has no primary-CTA field yet');
  });

  it('reads it from the genome, which is where it is written', () => {
    expect(OVERVIEW).toContain("invoke<{ genome: { offer?: { primary_cta?: string } } }>('genome.get'");
    expect(OVERVIEW).toContain('primaryCta={primaryCta}');
  });
});

describe('the campaign intro counts before it greets', () => {
  it('has a headline for each of the three states', () => {
    expect(INTRO).toContain('Let\u2019s set up a campaign.'); // answer still in flight
    expect(INTRO).toContain('Let\u2019s create another campaign.');
    expect(INTRO).toContain('Let\u2019s create your first campaign.');
  });

  it('never states "first" unconditionally', () => {
    // The old copy was baked into the heading's own markup.
    expect(INTRO).not.toContain('Let&rsquo;s create your first campaign.');
    expect(INTRO).toContain('{headline}');
  });

  it('asks the registry rather than guessing', () => {
    expect(WIZARD).toContain("invoke<{ campaigns: unknown[] }>('campaign.list'");
    expect(WIZARD).toContain('hasCampaign={hasCampaign}');
  });
});
