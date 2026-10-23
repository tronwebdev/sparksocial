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

/**
 * There were two scopes and there are three.
 *
 * The prototype draws `Settings PS *` for a person and `Settings WS *` for a
 * workspace, and nothing for the organisation that owns both — even though the
 * plan, the credit balance and the audit trail are all org-scoped in the
 * stores that hold them. So "Account Settings" on the brands page opened one
 * brand's settings, and a balance shared by every brand was shown as though it
 * belonged to whichever one was selected in a cookie.
 */
describe('the organisation is a scope of its own', () => {
  it('has its own section list', () => {
    expect(TREE).toContain('ORG_SECTIONS');
    expect(TREE).toContain("href: '/settings/org/billing'");
    expect(TREE).toContain("href: '/settings/org/brands'");
  });

  it('claims its paths by prefix, so a new section needs no second list', () => {
    expect(TREE).toContain("pathname.startsWith('/settings/org/')");
  });

  it('switches three ways', () => {
    expect(SHELL).toContain("tree === 'org' ? ORG_SECTIONS");
    expect(SHELL).toContain("{ key: 'org' as const, label: 'Organisation'");
  });

  it('is what Account Settings opens', () => {
    expect(WORKSPACES).toContain("router.push('/settings/org')");
  });

  /*
   * The per-card pencil still opens that brand's settings, and should: the
   * complaint was ambiguity, not the destination. A button labelled "Account
   * Settings" on a page listing every brand opened whichever one a cookie had
   * selected; a pencil on a card names the brand it belongs to and writes the
   * selection before navigating. Brand settings reached that way are reached
   * from inside a brand in the only sense that matters — the brand is known.
   */
  it('still reaches one brand’s settings from that brand’s own card', () => {
    expect(WORKSPACES).toContain('writeSelectedGenome(orgId, b.genomeId)');
  });

  /* Credits were never a brand screen — the tools they read take no brand. */
  it('no longer files credits under a brand', () => {
    expect(TREE).not.toContain("href: '/settings/credits'");
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
