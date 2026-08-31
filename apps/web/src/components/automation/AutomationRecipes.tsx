'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';

/**
 * Automation Recipes — plan §12 P5, `AUTO-01`→`AUTO-04.4`. Two tabs: the
 * recipes themselves (create/run/pause/delete) and the output queue
 * (`recipe.output.list`/`.decide`) — the review step that makes "runs
 * unattended" honest rather than reckless, per `recipe.*`'s own module
 * comment: nothing here can post anything by itself.
 */

type Kind = 'auto_trend' | 'bulk_connector' | 'rss';

interface RecipeItem {
  id: string;
  kind: Kind;
  name: string;
  config: unknown;
  /**
   * `completed` is set by the engine when a recipe passes its own `endAt` — it is
   * not a state anybody chooses. Before it existed an expired recipe stayed
   * `active` forever and the scheduler kept polling it every five minutes.
   */
  status: 'active' | 'paused' | 'completed';
  intervalMinutes?: number;
  lastRunAt?: string;
}

/** `trend.sources` — what a keyword will actually reach in this workspace. */
interface TrendSourcesView {
  anyKeywordSearch: boolean;
  keywordNote: string;
}

interface OutputItem {
  id: string;
  recipeId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  preview: { title?: string; intent?: string; sourceUrl?: string; playbookId?: string };
  contentItemId?: string;
  createdAt: string;
}

const KIND_LABEL: Record<Kind, string> = {
  auto_trend: 'AutoTrend',
  bulk_connector: 'Bulk Connector',
  rss: 'RSS',
};

export function AutomationRecipes() {
  const { genome, loading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [tab, setTab] = useState<'recipes' | 'queue'>('recipes');
  const [recipes, setRecipes] = useState<RecipeItem[] | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecipeItem | null>(null);
  /**
   * What a keyword will actually reach in this workspace.
   *
   * Loaded once, alongside the recipes, rather than per form: it describes the
   * *workspace's* configuration and does not change while somebody fills in a
   * form. Null while loading and after a failure — the keyword inputs stay usable
   * either way, since not knowing which sources search is a reason to say nothing
   * about it, not a reason to block the field.
   */
  const [sources, setSources] = useState<TrendSourcesView | null>(null);

  const loadRecipes = useCallback(async (id: string) => {
    setError(null);
    const res = await invoke<{ recipes: RecipeItem[] }>('recipe.list', { genomeId: id });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setRecipes([]);
      return;
    }
    setRecipes(res.output.recipes);
  }, []);

  const loadQueue = useCallback(async (id: string) => {
    setError(null);
    const res = await invoke<{ outputs: OutputItem[] }>('recipe.output.list', { genomeId: id, status: 'pending_review', limit: 50 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setOutputs([]);
      return;
    }
    setOutputs(res.output.outputs);
  }, []);

  useEffect(() => {
    if (!genomeId) return;
    if (tab === 'recipes') void loadRecipes(genomeId);
    else void loadQueue(genomeId);
  }, [genomeId, tab, loadRecipes, loadQueue]);

  useEffect(() => {
    // Independent of the genome: trend sources are a workspace-level
    // configuration, so this does not re-run on a brand switch.
    void (async () => {
      const res = await invoke<TrendSourcesView>('trend.sources', {});
      if (res.status === 'succeeded') setSources(res.output);
    })();
  }, []);

  async function toggleStatus(r: RecipeItem) {
    if (!genomeId || busyId) return;
    setBusyId(r.id);
    const status = r.status === 'active' ? 'paused' : 'active';
    const res = await invoke<RecipeItem>('recipe.schedule', { id: r.id, genomeId, status });
    setBusyId(null);
    if (res.status === 'succeeded') setRecipes((prev) => prev?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? prev);
  }

  async function runNow(r: RecipeItem) {
    if (!genomeId || busyId) return;
    setBusyId(r.id);
    await invoke('recipe.run', { id: r.id, genomeId }, crypto.randomUUID());
    setBusyId(null);
    void loadRecipes(genomeId);
  }

  async function remove(r: RecipeItem) {
    if (!genomeId || busyId) return;
    setBusyId(r.id);
    const res = await invoke('recipe.delete', { id: r.id, genomeId });
    setBusyId(null);
    if (res.status === 'succeeded') setRecipes((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
  }

  async function approve(o: OutputItem) {
    if (!genomeId || busyId) return;
    setBusyId(o.id);
    if (o.preview.playbookId) {
      const draft = await invoke<{ contentItemId: string }>(
        'content.draft',
        { genomeId, playbookId: o.preview.playbookId, intent: o.preview.intent ?? o.preview.title ?? '' },
        crypto.randomUUID(),
      );
      if (draft.status === 'succeeded') {
        await invoke('recipe.output.decide', { id: o.id, genomeId, status: 'approved', contentItemId: draft.output.contentItemId });
        setOutputs((prev) => prev?.filter((x) => x.id !== o.id) ?? prev);
      }
    }
    setBusyId(null);
  }

  async function reject(o: OutputItem) {
    if (!genomeId || busyId) return;
    setBusyId(o.id);
    const res = await invoke('recipe.output.decide', { id: o.id, genomeId, status: 'rejected' });
    setBusyId(null);
    if (res.status === 'succeeded') setOutputs((prev) => prev?.filter((x) => x.id !== o.id) ?? prev);
  }

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (genomeError || !genomeId) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{genomeError ?? 'No brand selected.'}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Automation Recipes</h2>
          <p className="mt-1 text-[14px] text-ink-muted">Work that runs unattended — every output waits for review before anything is drafted.</p>
        </div>
        {tab === 'recipes' ? (
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : 'New recipe'}
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-4">
        {(
          [
            { key: 'recipes', label: 'Recipes' },
            { key: 'queue', label: 'Output queue' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === t.key ? 'bg-ink text-surface' : 'bg-surface-muted text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recipes' ? (
        <>
          {showForm ? (
            <NewRecipeForm
              genomeId={genomeId}
              sources={sources}
              onCreated={() => {
                setShowForm(false);
                void loadRecipes(genomeId);
              }}
            />
          ) : null}

          {recipes === null ? (
            <div className="mt-4 grid grid-cols-1 gap-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded" />
              ))}
            </div>
          ) : error ? (
            <p className="mt-4 text-[14px] text-ink-muted">{error}</p>
          ) : recipes.length === 0 ? (
            <p className="mt-4 text-[14px] text-ink-muted">No recipes yet — create one above.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3">
              {recipes.map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[14px] font-medium text-ink">{r.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">{KIND_LABEL[r.kind]}</Badge>
                        <Badge variant={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>
                        {r.intervalMinutes ? <Badge variant="neutral">every {r.intervalMinutes}m</Badge> : <Badge variant="neutral">manual only</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void runNow(r)}>
                        Run now
                      </Button>
                      {/* A completed recipe has passed its own end date. Offering
                          Resume would put it straight back on the scheduler to be
                          refused and completed again on its next tick — so the
                          honest control is Edit, to move the end date. */}
                      {r.status === 'completed' ? null : (
                        <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => void toggleStatus(r)}>
                          {r.status === 'active' ? 'Pause' : 'Resume'}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => void remove(r)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  {r.status === 'completed' ? (
                    // Otherwise "completed" reads as a failure, or as something the
                    // owner did. It is the recipe's own end date arriving.
                    <p className="mt-2 text-[12px] text-ink-muted">
                      Past its end date, so it is no longer being run. Edit it to set a new one.
                    </p>
                  ) : null}
                  {r.lastRunAt ? (
                    <p className="mt-2 text-[12px] text-ink-muted">
                      Last ran {new Date(r.lastRunAt).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  ) : null}
                  {editing?.id === r.id ? (
                    <EditRecipeForm
                      genomeId={genome!.genomeId}
                      recipe={r}
                      sources={sources}
                      onClose={() => setEditing(null)}
                      onSaved={() => {
                        setEditing(null);
                        if (genomeId) void loadRecipes(genomeId);
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : outputs === null ? (
        <div className="mt-4 grid grid-cols-1 gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded" />
          ))}
        </div>
      ) : error ? (
        <p className="mt-4 text-[14px] text-ink-muted">{error}</p>
      ) : outputs.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-muted">Nothing waiting for review.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3">
          {outputs.map((o) => (
            <li key={o.id} className="rounded-lg border border-border p-4">
              <p className="text-[14px] font-medium text-ink">{o.preview.title ?? 'Untitled'}</p>
              {o.preview.intent ? <p className="mt-1 text-[13px] text-ink-muted">{o.preview.intent}</p> : null}
              {o.preview.sourceUrl ? (
                <a href={o.preview.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12px] text-brand-purple hover:underline">
                  {o.preview.sourceUrl}
                </a>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" disabled={busyId === o.id || !o.preview.playbookId} onClick={() => void approve(o)}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" disabled={busyId === o.id} onClick={() => void reject(o)}>
                  Reject
                </Button>
              </div>
              {!o.preview.playbookId ? (
                <p className="mt-2 text-[12px] text-ink-muted">No matching playbook — open Command Center to draft this one by hand, then reject it here.</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type BulkSource = 'csv' | 'drive' | 'canva';

function NewRecipeForm({
  genomeId,
  onCreated,
  sources,
}: {
  genomeId: string;
  onCreated: () => void;
  sources: TrendSourcesView | null;
}) {
  const [kind, setKind] = useState<Kind>('rss');
  const [name, setName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [minScore, setMinScore] = useState(0.4);
  /**
   * `AUTO-02`'s keyword step, which had nothing to reach until `TrendSource.fetch`
   * took the parameter. Comma-separated text rather than a chip editor: the
   * prototype draws chips, and chips are the right control once there is somewhere
   * to save a partial one — a text field is honest about being one value.
   */
  const [keywords, setKeywords] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [bulkSource, setBulkSource] = useState<BulkSource>('csv');
  const [csvUrl, setCsvUrl] = useState('');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [canvaFolderId, setCanvaFolderId] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const config =
      kind === 'rss'
        ? { feedUrl }
        : kind === 'auto_trend'
          ? {
              minScore,
              // Sent only when non-empty, so a recipe that names no keywords makes
              // byte-for-byte the config every recipe made before this step existed.
              ...(splitList(keywords).length ? { keywords: splitList(keywords) } : {}),
              ...(splitList(excludeKeywords).length ? { excludeKeywords: splitList(excludeKeywords) } : {}),
            }
          : bulkSource === 'csv'
            ? { source: 'csv' as const, csvUrl }
            : bulkSource === 'drive'
              ? { source: 'drive' as const, driveFolderId }
              : { source: 'canva' as const, canvaFolderId };
    const res = await invoke(
      'recipe.create',
      { genomeId, kind, name, config, ...(intervalMinutes ? { intervalMinutes } : {}) },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onCreated();
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-muted p-4">
      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Kind</label>
        <div className="flex flex-wrap gap-2">
          {(['rss', 'auto_trend', 'bulk_connector'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[13px]',
                kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface',
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Industry blog watch"
          className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
        />
      </div>

      {kind === 'rss' ? (
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">Feed URL</label>
          <input
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
      ) : kind === 'auto_trend' ? (
        <div className="grid grid-cols-1 gap-3">
          <KeywordFields
            keywords={keywords}
            onKeywords={setKeywords}
            excludeKeywords={excludeKeywords}
            onExcludeKeywords={setExcludeKeywords}
            sources={sources}
          />
          <div className="grid grid-cols-1 gap-1">
            <label className="text-[12px] font-medium text-ink-muted">Minimum match score ({Math.round(minScore * 100)}%)</label>
            <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            <p className="text-[12px] text-ink-muted">
              How close a trend has to be to this brand before SPARK will build a post from it. A keyword that
              matches but scores below this produces nothing, and the run says so.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <label className="text-[12px] font-medium text-ink-muted">Source</label>
          <div className="flex flex-wrap gap-2">
            {(['csv', 'drive', 'canva'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setBulkSource(s)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13px] capitalize',
                  bulkSource === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface',
                )}
              >
                {s === 'csv' ? 'CSV' : s === 'drive' ? 'Google Drive' : 'Canva'}
              </button>
            ))}
          </div>

          {bulkSource === 'csv' ? (
            <input
              value={csvUrl}
              onChange={(e) => setCsvUrl(e.target.value)}
              placeholder="https://example.com/rows.csv"
              className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
            />
          ) : bulkSource === 'drive' ? (
            <>
              <input
                value={driveFolderId}
                onChange={(e) => setDriveFolderId(e.target.value)}
                placeholder="Drive folder id (from its share link)"
                className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
              />
              <p className="text-[12px] text-ink-muted">
                The folder must be shared &quot;Anyone with the link can view&quot; — this reads through one shared,
                restricted API key, not your own Google account.
              </p>
            </>
          ) : (
            <>
              <input
                value={canvaFolderId}
                onChange={(e) => setCanvaFolderId(e.target.value)}
                placeholder="Canva folder id"
                className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
              />
              <p className="text-[12px] text-ink-muted">
                Needs this brand&apos;s own Canva account connected first — see Connections in Settings.
              </p>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Run every (minutes, optional — manual only if blank)</label>
        <input
          type="number"
          min={15}
          value={intervalMinutes}
          onChange={(e) => setIntervalMinutes(e.target.value ? Number(e.target.value) : '')}
          placeholder="e.g. 1440 for daily"
          className="h-9 w-40 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
        />
      </div>

      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      <Button size="sm" disabled={busy || !name.trim()} onClick={() => void create()} className="w-fit">
        {busy ? 'Creating…' : 'Create recipe'}
      </Button>
    </div>
  );
}

/** Comma-separated text to a trimmed list. The one place this is parsed. */
function splitList(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * The keyword step, and the sentence that keeps it honest.
 *
 * ── Why the note is not optional ──────────────────────────────────────────
 *
 * What a keyword *does* depends on which sources the workspace has configured.
 * Reddit and YouTube take a query and search their platform; Hacker News,
 * Product Hunt and Pinterest can only narrow the trending page they already
 * fetch. For a niche word the second kind returns nothing — and nothing on a
 * screen is indistinguishable from "there are no trends about this", one being a
 * fact about the world and the other a fact about our integration.
 *
 * Without the note the owner's reasonable conclusion is that their keyword is
 * wrong, and their next move is to try a different one, which fails the same way.
 * `trend.sources` composes the sentence server-side so two screens cannot phrase
 * the same claim differently.
 */
function KeywordFields({
  keywords,
  onKeywords,
  excludeKeywords,
  onExcludeKeywords,
  sources,
}: {
  keywords: string;
  onKeywords: (v: string) => void;
  excludeKeywords: string;
  onExcludeKeywords: (v: string) => void;
  sources: TrendSourcesView | null;
}) {
  const words = splitList(keywords);
  const excluded = splitList(excludeKeywords);

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Keywords</label>
        <input
          value={keywords}
          onChange={(e) => onKeywords(e.target.value)}
          placeholder="marketing, sales, AI agents"
          className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
        />
        <p className="text-[12px] text-ink-muted">
          {/* OR, and said so: the intersection of three topics is almost always
              empty, which would make the control look broken. */}
          Comma separated. A trend matching <em>any</em> of these counts. Leave empty to take whatever is
          trending.
        </p>
        {words.length > 10 ? (
          <p className="text-[12px] text-warn">
            Ten at most — past that a keyword list stops narrowing anything, which is the same as none.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Exclude keywords</label>
        <input
          value={excludeKeywords}
          onChange={(e) => onExcludeKeywords(e.target.value)}
          placeholder="politics, crypto"
          className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
        />
        <p className="text-[12px] text-ink-muted">
          Applied after everything else, and by SPARK rather than by the platform — no source&rsquo;s search
          accepts a negation, so this is the half none of them can do.
        </p>
        {excluded.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {excluded.map((word) => (
              <span
                key={word}
                className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] text-ink"
              >
                {word}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Shown whenever the keyword field is on screen, not only once a word has
          been typed: the point is to set the expectation *before* an empty result
          gets misread. */}
      {sources ? (
        <p
          className={cn(
            'rounded-lg border p-3 text-[12px]',
            sources.anyKeywordSearch ? 'border-border text-ink-muted' : 'border-warn/40 bg-warn/5 text-ink',
          )}
        >
          {sources.keywordNote}
        </p>
      ) : null}

      {/*
        Brand safety, stated rather than offered as a control.

        The prototype draws an "Enable brand safety filter" checkbox, defaulted
        *off*. Both halves are wrong here: `rankTrends` removes unsafe trends
        unconditionally, so the filter cannot be turned off, and it is on for every
        recipe including one that never opened this form. A checkbox would be a
        control that stores a value and changes nothing — and worse than the usual
        version of that, because its default would misdescribe the protection the
        brand already has.
      */}
      <p className="text-[12px] text-ink-muted">
        Brand safety is always on: a trend that trips this brand&rsquo;s guardrails is dropped before it can
        become a draft, and there is no setting that turns that off.
      </p>
    </div>
  );
}

/**
 * EDITING A SAVED RECIPE.
 *
 * Every field of a recipe was write-once. `recipe.create` set them, and the only
 * other writes were `recipe.schedule` (status) and `recipe.delete` — so
 * correcting a mistyped feed URL, adding a keyword, or moving an end date all
 * meant deleting the recipe and rebuilding it, which also discarded its run
 * history and every output still waiting in the queue.
 *
 * ── What this form deliberately does not offer ────────────────────────────
 *
 * The recipe's **kind**. Changing it would invalidate the stored config and orphan
 * every output produced under the old one; that is a new recipe, and the button
 * above makes one. `recipe.update` refuses it at the schema, so this is the screen
 * agreeing with the tool rather than the screen enforcing it.
 *
 * ── Why the config is sent whole ──────────────────────────────────────────
 *
 * `recipe.update` replaces the config rather than merging it, so this reads the
 * stored one, edits the fields it knows, and sends the result. A form that sent
 * only its own fields would rely on a merge — and a merge lets half a config pass
 * validation on the strength of the half it kept, which is how a recipe ends up
 * stored in a state the runner cannot execute.
 */
function EditRecipeForm({
  genomeId,
  recipe,
  sources,
  onClose,
  onSaved,
}: {
  genomeId: string;
  recipe: RecipeItem;
  sources: TrendSourcesView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const stored = (recipe.config ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(recipe.name);
  const [feedUrl, setFeedUrl] = useState(String(stored.feedUrl ?? ''));
  const [keywords, setKeywords] = useState((Array.isArray(stored.keywords) ? stored.keywords : []).join(', '));
  const [excludeKeywords, setExcludeKeywords] = useState(
    (Array.isArray(stored.excludeKeywords) ? stored.excludeKeywords : []).join(', '),
  );
  const [minScore, setMinScore] = useState(typeof stored.minScore === 'number' ? stored.minScore : 0.4);
  /**
   * Dates as `yyyy-mm-dd` for the input, stored as ISO datetimes.
   *
   * Moving the end date is the single most likely reason to open this form: a
   * recipe marked `completed` has passed its own `endAt`, and this is the only
   * control that can restart it.
   */
  const [endAt, setEndAt] = useState(isoToDateInput(stored.endAt));
  const [intervalMinutes, setIntervalMinutes] = useState<number | ''>(recipe.intervalMinutes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    /**
     * Spread over the stored config, so fields this form does not draw —
     * `region`, `language`, `goal`, `reviewBeforePublish`, a bulk connector's
     * source — survive an edit rather than being silently dropped by a form that
     * never knew about them.
     */
    const config: Record<string, unknown> = { ...stored };
    if (recipe.kind === 'rss') config.feedUrl = feedUrl.trim();
    if (recipe.kind === 'auto_trend') {
      config.minScore = minScore;
      config.keywords = splitList(keywords);
      config.excludeKeywords = splitList(excludeKeywords);
    }
    // Cleared rather than set to an empty string: `endAt` is an optional ISO
    // datetime and `''` fails its schema, which would make "remove the end date"
    // impossible to express.
    if (endAt) config.endAt = new Date(`${endAt}T23:59:59.000Z`).toISOString();
    else delete config.endAt;

    const res = await invoke<RecipeItem>(
      'recipe.update',
      {
        id: recipe.id,
        genomeId,
        name: name.trim(),
        config,
        // Null clears the schedule, leaving a recipe that only runs when asked.
        intervalMinutes: intervalMinutes === '' ? null : intervalMinutes,
      },
      // Stable: the same edit sent twice lands the same row.
      `recipe.update:${recipe.id}`,
    );

    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That change needs approval.');
      return;
    }
    onSaved();
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
        Editing &mdash; {KIND_LABEL[recipe.kind]}
      </p>

      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink"
        />
      </div>

      {recipe.kind === 'rss' ? (
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">Feed URL</label>
          <input
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink"
          />
        </div>
      ) : null}

      {recipe.kind === 'auto_trend' ? (
        <>
          <KeywordFields
            keywords={keywords}
            onKeywords={setKeywords}
            excludeKeywords={excludeKeywords}
            onExcludeKeywords={setExcludeKeywords}
            sources={sources}
          />
          <div className="grid grid-cols-1 gap-1">
            <label className="text-[12px] font-medium text-ink-muted">
              Minimum match score ({Math.round(minScore * 100)}%)
            </label>
            <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          </div>
        </>
      ) : null}

      {/* A bulk connector's source and its id are not editable here: they are the
          recipe's whole identity, and pointing one at a different folder is a
          different recipe. The fields survive the edit untouched via the spread. */}
      {recipe.kind === 'bulk_connector' ? (
        <p className="text-[12px] text-ink-muted">
          Its source and folder are not editable &mdash; pointing a connector at different files is a
          different recipe. Name, schedule and end date can be changed here.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">Runs every (minutes)</label>
          <input
            type="number"
            min={15}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Leave empty for manual only"
            className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">End date</label>
          <input
            type="date"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="h-9 rounded border border-border bg-input px-3 text-[13px] text-ink"
          />
          {recipe.status === 'completed' ? (
            <p className="text-[12px] text-ink-muted">
              Moving this forward is what restarts the recipe &mdash; it stopped because this date passed.
            </p>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** An ISO datetime to the `yyyy-mm-dd` a date input wants, or empty. */
function isoToDateInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
