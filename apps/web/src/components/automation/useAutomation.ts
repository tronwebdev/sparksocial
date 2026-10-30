'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@/lib/tools';
import { platformLabel } from '@/lib/platforms';
import { KIND_META, statusChip, type RecipeKind, type StatusChip } from './recipeMeta';
import { userMessage } from '@/lib/errorCopy';

/**
 * Everything the Automation screen reads, in one place.
 *
 * ── Why two calls for one table ───────────────────────────────────────────
 *
 * The design's queue has six tabs — All, Drafts, Needs Review, Scheduled,
 * Published, Failed — and no single tool answers them. A `recipe_outputs` row
 * has exactly three states (`pending_review`, `approved`, `rejected`), and once
 * approved it carries a `contentItemId` whose *own* status is what "Scheduled",
 * "Published" and "Failed" mean. So the queue is `recipe.output.list` joined to
 * `content.list` on that id, locally.
 *
 * Rejected outputs are left out. Somebody removed them on purpose, and a queue
 * that keeps showing what you threw away is a queue you stop clearing.
 */

export interface RecipeItem {
  id: string;
  kind: RecipeKind;
  name: string;
  config: unknown;
  status: 'active' | 'paused' | 'completed';
  intervalMinutes?: number;
  lastRunAt?: string;
  createdAt: string;
}

interface OutputItem {
  id: string;
  recipeId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  preview: {
    title?: string;
    intent?: string;
    sourceUrl?: string;
    playbookId?: string;
    playbookName?: string;
    /** Every post the output became — one per chosen account. */
    contentItemIds?: string[];
  };
  contentItemId?: string;
  createdAt: string;
}

interface ContentItem {
  contentItemId: string;
  summary: string;
  status: string;
  scheduledAt?: string;
  platform?: string;
}

export interface QueueRow {
  id: string;
  kind: RecipeKind;
  recipeName: string;
  title: string;
  sub?: string;
  account?: string;
  chip: StatusChip;
  createdAt: string;
  scheduledAt?: string;
  contentItemId?: string;
  /** Every post the output became. `contentItemId` is the first of them. */
  contentItemIds: string[];
  /** The format's name, so a row can say what it will become. */
  formatName?: string;
  /** True while the output is still `pending_review` — the only decidable state. */
  canDecide: boolean;
  /**
   * The playbook the run picked, when it picked one. `content.draft` requires
   * it, so approving an output that names none cannot produce a draft — see
   * the approve path in `AutomationScreen`.
   */
  playbookId?: string;
  /** What the run intended to say — the draft's brief, and the manage caption. */
  intent?: string;
}

export interface ManageRow extends QueueRow {
  caption: string;
  detail: string;
}

export function useAutomation(genomeId: string | undefined) {
  const [recipes, setRecipes] = useState<RecipeItem[] | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[] | null>(null);
  const [content, setContent] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const [r, o, c] = await Promise.all([
      invoke<{ recipes: RecipeItem[] }>('recipe.list', { genomeId }),
      invoke<{ outputs: OutputItem[] }>('recipe.output.list', { genomeId, limit: 100 }),
      invoke<{ items: ContentItem[] }>('content.list', { genomeId, limit: 100 }),
    ]);

    setRecipes(r.status === 'succeeded' ? r.output.recipes : []);
    setOutputs(o.status === 'succeeded' ? o.output.outputs : []);
    setContent(c.status === 'succeeded' ? c.output.items : []);

    /* One message, from whichever failed first — three banners for one outage
       is three times the noise and no more information. */
    const failed = [r, o, c].find((x) => x.status !== 'succeeded');
    setError(failed && failed.status === 'failed' ? userMessage(failed.error) : null);
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes]);
  const contentById = useMemo(() => new Map((content ?? []).map((c) => [c.contentItemId, c])), [content]);

  const rows: QueueRow[] | null = useMemo(() => {
    if (outputs === null) return null;
    return outputs
      .filter((o) => o.status !== 'rejected')
      .map((o) => {
        const recipe = byId.get(o.recipeId);
        const item = o.contentItemId ? contentById.get(o.contentItemId) : undefined;
        const kind = recipe?.kind ?? 'auto_trend';
        const ids = o.preview.contentItemIds ?? (o.contentItemId ? [o.contentItemId] : []);
        /* The posts' own platforms once they exist; the recipe's choice before. */
        const posted = ids.map((id) => contentById.get(id)?.platform).filter((p): p is string => !!p);
        const chosen = ((recipe?.config ?? {}) as { targetPlatforms?: unknown }).targetPlatforms;
        const platforms = posted.length ? posted : Array.isArray(chosen) ? chosen.filter((p): p is string => typeof p === 'string') : [];
        /* `pending_review` wins over the content status: an output that is
           still waiting on a person is Waiting Approval whatever its draft
           looks like. */
        const chip = statusChip(o.status === 'pending_review' ? 'pending_review' : (item?.status ?? 'draft'));

        return {
          id: o.id,
          kind,
          recipeName: recipe?.name ?? KIND_META[kind].name,
          title: o.preview.title ?? item?.summary ?? o.preview.intent ?? 'Untitled post',
          ...(o.preview.sourceUrl ? { sub: hostOf(o.preview.sourceUrl) } : {}),
          ...(platforms.length ? { account: [...new Set(platforms)].map(platformLabel).join(', ') } : {}),
          chip,
          createdAt: o.createdAt,
          ...(item?.scheduledAt ? { scheduledAt: item.scheduledAt } : {}),
          ...(o.contentItemId ? { contentItemId: o.contentItemId } : {}),
          contentItemIds: ids,
          ...(o.preview.playbookName ? { formatName: o.preview.playbookName } : {}),
          canDecide: o.status === 'pending_review',
          ...(o.preview.playbookId ? { playbookId: o.preview.playbookId } : {}),
          ...(o.preview.intent ? { intent: o.preview.intent } : {}),
        };
      });
  }, [outputs, byId, contentById]);

  const manageRows = useCallback(
    (kind: RecipeKind): ManageRow[] =>
      (rows ?? [])
        .filter((r) => r.kind === kind)
        .map((r) => {
          const output = (outputs ?? []).find((o) => o.id === r.id);
          return {
            ...r,
            caption: output?.preview.intent ?? r.title,
            detail: r.canDecide
              ? r.playbookId
                ? `Waiting on you. Approving it writes the ${r.formatName ?? 'post'}${r.formatName ? ' post' : ''} and schedules it${r.account ? ` to ${r.account}` : ''}; rejecting drops it and the recipe will not offer it again.`
                : 'Waiting on you, but no format this brand can make fits it — there is nothing to post, so it can only be removed.'
              : r.contentItemIds.length
                ? `${r.contentItemIds.length === 1 ? 'A post' : `${r.contentItemIds.length} posts`}${r.account ? ` to ${r.account}` : ''}, now ${r.chip.label.toLowerCase()}.`
                : 'Produced by this recipe.',
          };
        }),
    [rows, outputs],
  );

  const needsReview = (rows ?? []).filter((r) => r.canDecide).length;

  return { recipes, rows, manageRows, needsReview, error, reload: load };
}

/** "blog.brand.com" from a feed item's URL — the queue's small second chip. */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
