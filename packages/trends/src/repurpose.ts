import { assetRoleWordList } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import { resolve, type AssetInventory, type ResolvedPlaybook } from '@sparksocial/playbooks';
import type { Trend } from './trend.js';

/**
 * `trend.repurpose` — turning a trend into a concrete next action, PRD §8.9
 * `DISC-01`/`DISC-02`.
 *
 * Deliberately a *suggestion*, not a draft: this picks which already-available
 * playbook best fits the trend and writes the intent line `content.draft`
 * would need, but does not call `content.draft` itself. Tools do not invoke
 * other tools — that composition is SPARK's job (or the UI's, chaining two
 * calls) — and keeping this one `effect: 'read'` means browsing trends never
 * costs anything or creates a row nobody asked for.
 *
 * Matching is against the *resolver's* output — real available playbooks for
 * this genome's actual assets, same as `playbook.resolve` — never against a
 * hardcoded playbook-to-trend-tag table. A trend tagged `workflow` matches
 * `demo_walkthrough` because that playbook's own name/description talk about
 * a workflow, not because anything here has a `workflow → demo_walkthrough`
 * lookup entry (CLAUDE.md invariant 5: the resolver's compatibility check is
 * the only gate; this only re-ranks what it already allowed through).
 */

export interface RepurposeSuggestion {
  playbookId: string;
  playbookName: string;
  pillar: string;
  mode: string;
  intent: string;
  unlockable: boolean;
  missingRoles: string[];
  matchedOn: string[];
}

export function suggestRepurpose(
  genome: Genome,
  assets: AssetInventory,
  trend: Trend,
): { suggestion: RepurposeSuggestion | undefined; ranked: ResolvedPlaybook[] } {
  const { ranked } = resolve(genome, assets);
  if (ranked.length === 0) return { suggestion: undefined, ranked };

  const tags = new Set(trend.tags.map((t) => t.toLowerCase()));
  const topicWords = new Set(tokenize(trend.topic));

  const scored = ranked.map((r) => ({ r, ...overlap(r, tags, topicWords) }));
  scored.sort((a, b) => b.count - a.count || b.r.score - a.r.score);
  const best = scored[0]!;

  return {
    suggestion: {
      playbookId: best.r.playbook.playbook_id,
      playbookName: best.r.playbook.name,
      pillar: best.r.playbook.content_pillar,
      mode: best.r.playbook.mode,
      intent: buildIntent(trend, best.r),
      unlockable: best.r.unlockable,
      missingRoles: best.r.missingRoles,
      matchedOn: best.matched,
    },
    ranked,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

function overlap(
  r: ResolvedPlaybook,
  tags: Set<string>,
  topicWords: Set<string>,
): { count: number; matched: string[] } {
  const haystack = new Set([
    ...tokenize(r.playbook.name),
    ...tokenize(r.playbook.description),
    r.playbook.content_pillar,
  ]);
  const matched = [...tags, ...topicWords].filter((w) => haystack.has(w));
  return { count: new Set(matched).size, matched: [...new Set(matched)] };
}

function buildIntent(trend: Trend, r: ResolvedPlaybook): string {
  const base = `Join the trend "${trend.topic}" with a ${r.playbook.name.toLowerCase()} post`;
  if (!r.unlockable) return base;
  // "footage" only when footage is actually what is missing — a brand kit or a
  // testimonial screenshot is a file, and calling it footage sends the owner to
  // fetch a camera for something already on their laptop.
  return r.unlockedBy === 'capture'
    ? `${base} — needs footage first (${assetRoleWordList(r.missingRoles)})`
    : `${base} — needs ${assetRoleWordList(r.missingRoles)} uploaded first`;
}
