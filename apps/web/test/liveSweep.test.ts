import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Defects found sweeping every screen of the deployed app on 29 October.
 * Each is pinned at the line that caused it.
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('what the production sweep found', () => {
  it('lets a brand be deleted from the brands page, through the real flow', () => {
    const page = src('src/app/workspaces/page.tsx');
    expect(page).not.toContain('Nothing in the product deletes a brand');
    expect(page).toContain('<DeleteBrandModal');
    expect(page).toContain('onClick={() => setDeleting(b)}');
  });

  it('shows the Unfiled shelf when a brand has no folders yet', () => {
    expect(src('src/components/assets/AssetsLibraryScreen.tsx')).toContain(
      'folders.length === 0 && (unfiled?.length ?? 0) === 0',
    );
  });

  it('names what is held for approval in words, and on the brand being looked at', () => {
    const screen = src('src/components/command-center/NeedsAttentionScreen.tsx');
    expect(screen).not.toContain('`${it.tool} is waiting for your approval`');
    expect(screen).toContain('toolLabel(it.tool)');
    expect(screen).not.toContain('res.output.genomes[0]!.genomeId');
  });

  it('does not tell a customer to set environment variables', () => {
    const feed = src('src/components/discovery/DiscoveryFeed.tsx');
    expect(feed).not.toContain('in the API environment');
    expect(feed).not.toContain('Industry: SaaS');
    expect(feed).not.toContain('packages/trends/src/safety.ts');
  });

  it('does not explain a disabled control in tool names', () => {
    expect(src('src/components/command-center/PlanQueue.tsx')).not.toContain('keyed on the held call');
    expect(src('src/components/calendar/DraftReviewModal.tsx')).not.toContain('approval.decide takes a callId');
    expect(src('src/components/command-center/draft-panel/DraftPanel.tsx')).not.toContain('title="compose.fanout');
    expect(src('src/components/agency/AgencyWizard.tsx')).not.toContain('No tool generates');
  });

  /* The dashboard's "View" links to /agents?draft=<id>, which mounts the panel
     before the genome is known; it sat on its skeleton for good. */
  it('loads a linked draft once the brand arrives, not only when the panel opens', () => {
    const panel = src('src/components/command-center/draft-panel/DraftPanel.tsx');
    expect(panel).toContain("if (open && genomeId && initialContentItemId && phase === 'loading' && !draft)");
  });

  it('folds /account into Account Settings, so members can be given brands', () => {
    expect(src('src/app/(app)/account/page.tsx')).toContain("redirect('/organization')");
    const tree = src('src/components/settings/settingsTree.tsx');
    for (const p of ['/organization/members', '/organization/policies', '/organization/transfer']) {
      expect(tree).toContain(`href: '${p}'`);
    }
    expect(src('src/app/organization/members/page.tsx')).toContain('<TeamPanel />');
  });

  /* PRD audit: pause, resume, rename, duplicate and activate were registered
     tools reachable from no screen. */
  it('reaches every campaign control from Edit Campaign', () => {
    const card = src('src/components/command-center/CampaignFocusCard.tsx');
    expect(card).toContain('<CampaignManageModal');
    expect(card).toContain('onClick={() => setManaging(true)}');
    const list = src('src/components/calendar/CampaignList.tsx');
    for (const tool of ['campaign.resume', 'campaign.pause', 'campaign.rename', 'campaign.duplicate']) {
      expect(list).toContain(`'${tool}'`);
    }
    // A duplicate copies terms, not slots — it is planned straight after.
    expect(list).toContain("invoke<{ slotCount: number }>('calendar.generate'");
    expect(src('src/components/campaign/CampaignWizard.tsx')).not.toContain('activate it from the calendar');
  });

  it('shows the running campaign as Current Focus, not the newest one', () => {
    expect(src('src/components/command-center/CommandCenterOverview.tsx')).toContain(
      "res.output.campaigns.find((c) => c.status === 'active') ?? res.output.campaigns[0]!",
    );
  });

  it('writes the calendar screen’s statuses as words', () => {
    expect(src('src/components/command-center/CalendarMonthGrid.tsx')).not.toContain(
      'statusLabel={(st) => st[0]!.toUpperCase() + st.slice(1)}',
    );
  });
});
