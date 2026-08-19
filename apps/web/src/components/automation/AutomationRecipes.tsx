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
  status: 'active' | 'paused';
  intervalMinutes?: number;
  lastRunAt?: string;
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
                      <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => void toggleStatus(r)}>
                        {r.status === 'active' ? 'Pause' : 'Resume'}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => void remove(r)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  {r.lastRunAt ? (
                    <p className="mt-2 text-[12px] text-ink-muted">
                      Last ran {new Date(r.lastRunAt).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
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

function NewRecipeForm({ genomeId, onCreated }: { genomeId: string; onCreated: () => void }) {
  const [kind, setKind] = useState<Kind>('rss');
  const [name, setName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [minScore, setMinScore] = useState(0.4);
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
          ? { minScore }
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
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted">Minimum match score ({Math.round(minScore * 100)}%)</label>
          <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
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
