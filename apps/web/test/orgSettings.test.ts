import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const code = (rel: string) =>
  readFileSync(join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const TREE = code('apps/web/src/components/settings/settingsTree.tsx');
const SHELL = code('apps/web/src/components/settings/SettingsShell.tsx');
const WORKSPACES = code('apps/web/src/app/workspaces/page.tsx');
const BUDGETS = code('apps/web/src/components/settings/BrandBudgetsSection.tsx');
const BILLING = code('apps/web/src/components/settings/BillingSection.tsx');
const ORG_LAYOUT = code('apps/web/src/app/organization/layout.tsx');
const PLAN_CARD = code('apps/web/src/components/shell/PlanCard.tsx');
const PROFILE = code('apps/web/src/components/settings/personal/ProfileSection.tsx');
const ORG_OVERVIEW = code('apps/web/src/components/settings/OrgOverviewSection.tsx');

/**
 * Three scopes, and the organisation is not a tab of a brand.
 *
 * The prototype draws `Settings PS *` for a person and `Settings WS *` for a
 * workspace (a brand), and nothing for the organisation that owns both. It was
 * added as a third segment of the brand settings switch at `/settings/org`,
 * behind `GenomeGuard`, with Ask Spark and a Back to a brand's dashboard. It is
 * its own screen now, reached from the brands page and returning there.
 */
describe('the organisation is a screen of its own', () => {
  it('has its own section list, outside /settings', () => {
    expect(TREE).toContain('ORG_SECTIONS');
    expect(TREE).toContain("href: '/organization/billing'");
    expect(TREE).toContain("href: '/organization/brands'");
    expect(TREE).not.toContain("href: '/settings/org");
  });

  it('claims its paths by prefix, so a new section needs no second list', () => {
    expect(TREE).toContain("pathname.startsWith('/organization/')");
  });

  it('does not need a brand to open', () => {
    expect(ORG_LAYOUT).toContain('<OrgGuard>');
    expect(ORG_LAYOUT).not.toContain('GenomeGuard');
  });

  it('carries nothing of a brand’s: no scope switch, no Ask Spark, Back to the brands page', () => {
    expect(SHELL).toContain("isOrg ? '/workspaces' : '/home'");
    expect(SHELL).toContain('{isOrg ? null : <SettingsTreeSwitch tree={tree} />}');
    expect(SHELL).not.toContain("{ key: 'org' as const");
  });

  it('is what Account Settings opens', () => {
    expect(WORKSPACES).toContain("router.push('/organization')");
  });

  it('lets the organisation be renamed, through the tool', () => {
    expect(ORG_OVERVIEW).toContain("invoke<{ name: string }>('org.rename'");
    expect(ORG_OVERVIEW).toContain('organization?.reload()');
  });

  /*
   * The per-card pencil still opens that brand's settings, and should: a
   * pencil on a card names the brand it belongs to and writes the selection
   * before navigating.
   */
  it('still reaches one brand’s settings from that brand’s own card', () => {
    expect(WORKSPACES).toContain('writeSelectedGenome(orgId, b.genomeId)');
  });

  /* Back as a brand screen — this brand's spend, not the organisation's balance. */
  it('files Credit & Usage under the brand again, reading the brand’s own spend', () => {
    expect(TREE).toContain("href: '/settings/credits'");
    expect(code('apps/web/src/components/settings/BrandUsageSection.tsx')).toContain("'brand.usage.get'");
  });
});

describe('the profile photo is the person’s, everywhere it is drawn', () => {
  it('uploads through Clerk rather than dispatching an event nothing hears', () => {
    expect(PROFILE).toContain('user.setProfileImage({ file })');
    expect(PROFILE).not.toContain('spark:open-user-profile');
  });

  it('shows on the sidebar’s plan card, with the memoji only as a fallback', () => {
    expect(PLAN_CARD).toContain('user.hasImage ? user.imageUrl');
  });
});

describe('brand budgets are presented as what they are', () => {
  it('says the limit is hard, and what that does', () => {
    expect(BUDGETS).toContain('hard');
    expect(BUDGETS).toMatch(/stops\s*\n?\s*drafting|stops drafting/);
  });

  /*
   * Clearing a limit is `null`, never zero. Zero means "this brand spends
   * nothing", and a Clear button that wrote it would freeze the brand it was
   * meant to free.
   */
  it('clears with null rather than zero', () => {
    expect(BUDGETS).toContain("draft?.trim() === '' ? null :");
    expect(BUDGETS).toContain('void save(b.brandId, null)');
  });

  /* A brand can hold more than one genome; the cap is on the brand. */
  it('lists brands, not genomes', () => {
    expect(BUDGETS).toContain('seen.has(g.brandId)');
  });
});

describe('buying credits', () => {
  /* The redirect back is a URL anyone can type. Only the webhook grants. */
  it('does not claim credits have arrived', () => {
    expect(BILLING).toContain('Payment received');
    expect(BILLING).not.toContain('Credits added');
  });

  it('says plainly when payments are not configured', () => {
    expect(BILLING).toContain('not configured');
  });
});
