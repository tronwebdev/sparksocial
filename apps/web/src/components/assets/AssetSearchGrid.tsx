'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { relativeTime } from '@/lib/relativeTime';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { ASSET_ROLES } from './roles';
import { AssetDetailPanel, type DetailAsset } from './AssetDetailPanel';

/**
 * `asset.retrieve` — real since P2, reached from no screen until now.
 *
 * There is no "list every asset" tool: retrieval is intent-scored by design
 * (§4.3), never a bare table scan. A browsing screen has no natural intent to
 * search with, so this defaults to the brand name — broad enough to surface
 * most of the library — and always offers the role filter (`requiredRoles`)
 * as the more reliable way to narrow it. Worth stating plainly rather than
 * pretending this is a generic list view wearing a search box.
 */

interface RetrievedAsset {
  assetId: string;
  role: string;
  caption: string | null;
  embeddingScore: number;
  usageCount: number;
  lastUsedAt: string | null;
  rightsStatus: string;
  folderId: string | null;
  /**
   * `asset.retrieve` has returned these two since the grid view landed and this
   * interface dropped them, so a media library rendered a list of assets it could
   * describe and not show. That is a table with extra steps.
   */
  url: string;
  mediaType: string;
  /** Null on any row uploaded before `assets.filename`/`size_bytes` existed. */
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

/** How many the grid asks for per page. */
const PAGE = 24;

/**
 * Sorting is client-side over one page, and that is a real limitation rather than
 * a shortcut.
 *
 * `asset.retrieve` orders by a *computed score* — cosine similarity minus recency
 * and diversity penalties — so there is no server-side "sort by date" to ask for
 * without abandoning relevance ranking entirely. Sorting the page you are looking
 * at is honest; calling it a library-wide sort would not be. The label says so.
 */
type Sort = 'relevance' | 'newest' | 'name';

function bytes(n: number | null): string | null {
  if (n === null) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Filename, then caption, then the role — never an empty label. */
function label(a: RetrievedAsset): string {
  if (a.filename) return a.filename;
  if (a.caption) return a.caption;
  return ASSET_ROLES.find((r) => r.value === a.role)?.label ?? a.role;
}

export function AssetSearchGrid({ refreshKey }: { refreshKey: number }) {
  const { genome } = useSelectedGenome();
  const [intent, setIntent] = useState('');
  const [role, setRole] = useState('');
  const [results, setResults] = useState<RetrievedAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DetailAsset | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<Sort>('relevance');
  const [page, setPage] = useState(0);
  /** Which row's caption is being edited, and the draft text. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<RetrievedAsset | null>(null);

  const search = useCallback(async () => {
    if (!genome) return;
    setResults(null);
    const res = await invoke<{ results: RetrievedAsset[] }>('asset.retrieve', {
      genomeId: genome.genomeId,
      intent: intent.trim() || genome.name,
      ...(role ? { requiredRoles: [role] } : {}),
      k: PAGE,
      ...(page > 0 ? { offset: page * PAGE } : {}),
    });
    if (res.status === 'succeeded') {
      setResults(res.output.results);
      setError(null);
    } else {
      setResults([]);
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
    }
  }, [genome, intent, role, page]);

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genome, refreshKey, page]);

  /** Narrowing the search should start from the first page, not page 3 of it. */
  useEffect(() => {
    setPage(0);
  }, [intent, role]);

  async function saveCaption(assetId: string, caption: string) {
    if (!genome || busy) return;
    setBusy(assetId);
    const res = await invoke('asset.caption.set', { genomeId: genome.genomeId, assetId, caption });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That change was gated.');
      return;
    }
    setEditing(null);
    // Re-search rather than patching the row: the caption was re-embedded, so
    // this asset's own relevance score has changed and the ordering with it.
    await search();
  }

  async function archive(assetId: string) {
    if (!genome || busy) return;
    setBusy(assetId);
    const res = await invoke('asset.archive', { genomeId: genome.genomeId, assetId, archived: true });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That change was gated.');
      return;
    }
    await search();
  }

  /**
   * Sorted for display only. Relevance is the order the server returned, so that
   * branch deliberately does nothing rather than re-sorting by a score it would
   * then have to explain.
   */
  const sorted = [...(results ?? [])].sort((a, b) => {
    if (sort === 'newest') return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === 'name') return label(a).localeCompare(label(b));
    return 0;
  });

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid grid-cols-1 min-w-[200px] flex-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="asset-intent">
            What are you looking for
          </label>
          <input
            id="asset-intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder={genome ? `e.g. ${genome.name} storefront` : 'e.g. storefront photo'}
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="asset-role-filter">
            Role
          </label>
          <select
            id="asset-role-filter"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink"
          >
            <option value="">Any role</option>
            {ASSET_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void search()}
          className="h-10 rounded border border-border px-4 text-[14px] font-medium text-ink hover:bg-surface-muted"
        >
          Search
        </button>

        <div className="grid grid-cols-1 gap-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="asset-sort">
            Sort this page
          </label>
          <select
            id="asset-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink"
          >
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
          </select>
        </div>

        {/*
          Grid and list, as `LIB-02` draws them. The list view is the one that can
          show a caption long enough to read and edit, which is why metadata
          editing lives there and not on a card.
        */}
        <div className="flex items-center gap-1 self-end rounded border border-border p-0.5">
          {(['grid', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded px-3 py-1.5 text-[13px] capitalize ${
                view === v ? 'bg-ink text-surface' : 'text-ink-muted'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      <div className="mt-5">
        {results === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : results.length === 0 ? (
          /*
            The designed empty state. Two different situations reach here and they
            need different words: a brand with nothing in the library at all, and
            a search that matched nothing. Telling somebody to "broaden the
            search" when they have never uploaded anything is the unhelpful
            version of this message.
          */
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="text-[15px] font-medium text-ink">
              {intent.trim() || role ? 'Nothing matched that' : 'Nothing in the library yet'}
            </p>
            <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-ink-muted">
              {intent.trim() || role
                ? 'Retrieval scores meaning rather than matching words, so a broader phrase usually finds more than a more precise one. Clearing the role filter helps most.'
                : 'Assets are what SPARK builds posts from — a product shot, a piece of finished work, a clip of the space. Add one above and it becomes searchable once it has been captioned.'}
            </p>
            {page > 0 ? (
              <button
                type="button"
                onClick={() => setPage(0)}
                className="mt-3 text-[13px] font-medium text-primary underline decoration-dotted underline-offset-2"
              >
                Back to the first page
              </button>
            ) : null}
          </div>
        ) : view === 'grid' ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {sorted.map((a) => (
              <li key={a.assetId} className="rounded-xl border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setPreview(a)}
                  className="block w-full bg-surface-muted"
                  title="Preview"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.mediaType === 'image' ? (
                    <img src={a.url} alt={label(a)} className="h-32 w-full object-cover" />
                  ) : a.mediaType === 'video' ? (
                    <video src={a.url} className="h-32 w-full object-cover" muted preload="metadata" />
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center text-[12px] text-ink-muted">
                      Audio
                    </div>
                  )}
                </button>
                <div className="p-3">
                  <p className="truncate text-[13px] text-ink" title={label(a)}>
                    {label(a)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="neutral">{ASSET_ROLES.find((r) => r.value === a.role)?.label ?? a.role}</Badge>
                    <Badge variant={a.rightsStatus === 'cleared' ? 'success' : 'warn'}>{a.rightsStatus}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {[bytes(a.sizeBytes), `used ${a.usageCount}\u00D7`].filter(Boolean).join(' \u00B7 ')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelected(a)}
                      className="text-[12px] font-medium text-primary underline decoration-dotted underline-offset-2"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      disabled={busy === a.assetId}
                      onClick={() => void archive(a.assetId)}
                      className="ml-auto text-[12px] font-medium text-destructive disabled:opacity-50"
                    >
                      {busy === a.assetId ? '\u2026' : 'Archive'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          /*
            `LIB-02`'s list columns, with one substitution. The prototype's header
            is `Assets | Meta Description | Type | Date Uploaded | Action`; the
            second is called "Caption" here because that is what the field is
            everywhere else in the product, and it is what retrieval matches on.
            Calling the same value two things on two screens is how somebody
            comes to believe there are two of them.
          */
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[46rem] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 font-medium">Asset</th>
                  <th className="px-3 py-2 font-medium">Caption</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Uploaded</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.assetId} className="border-b border-border last:border-b-0 align-top">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setPreview(a)}
                        className="flex items-center gap-2 text-left"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {a.mediaType === 'image' ? (
                          <img src={a.url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-muted text-[10px] text-ink-muted">
                            {a.mediaType === 'video' ? 'Vid' : 'Aud'}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block max-w-[16rem] truncate text-ink">{label(a)}</span>
                          {bytes(a.sizeBytes) ? (
                            <span className="block text-[11px] text-ink-muted">{bytes(a.sizeBytes)}</span>
                          ) : null}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {editing?.id === a.assetId ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            value={editing.text}
                            onChange={(e) => setEditing({ id: a.assetId, text: e.target.value })}
                            maxLength={400}
                            className="h-8 min-w-[14rem] flex-1 rounded border border-border bg-input px-2 text-[13px] text-ink"
                          />
                          <Button
                            size="sm"
                            disabled={busy === a.assetId || editing.text.trim().length < 3}
                            onClick={() => void saveCaption(a.assetId, editing.text.trim())}
                          >
                            {busy === a.assetId ? 'Saving\u2026' : 'Save'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: a.assetId, text: a.caption ?? '' })}
                          className="max-w-[26rem] text-left text-ink-muted hover:text-ink"
                          title="Edit \u2014 this is the text retrieval matches on"
                        >
                          {a.caption ?? 'Add a caption'}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize text-ink-muted">{a.mediaType}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{relativeTime(a.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(a)}
                          className="text-[12px] font-medium text-primary underline decoration-dotted underline-offset-2"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          disabled={busy === a.assetId}
                          onClick={() => void archive(a.assetId)}
                          className="text-[12px] font-medium text-destructive disabled:opacity-50"
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          Paging, not a total. `asset.retrieve` returns a page and no count, so
          "Page 3 of 4" cannot be shown honestly — the prototype's version implies
          a total nothing computes. `Next` is offered when the page came back full,
          which is the only signal available that there may be more.
        */}
        {results !== null && (page > 0 || results.length === PAGE) ? (
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="text-[12px] tabular-nums text-ink-muted">Page {page + 1}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={results.length < PAGE}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      {/* Preview \u2014 `LIB-02`'s View Asset modal. Media at size, and nothing else:
          every action it could offer already exists on the row behind it. */}
      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-h-full w-full max-w-3xl overflow-auto rounded-xl border border-border bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-ink">{label(preview)}</p>
              <p className="text-[12px] text-ink-muted">
                {[bytes(preview.sizeBytes), preview.mediaType].filter(Boolean).join(' \u00B7 ')}
              </p>
            </div>
            <div className="mt-3">
              {preview.mediaType === 'image' ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={preview.url} alt={label(preview)} className="max-h-[60vh] w-full object-contain" />
              ) : preview.mediaType === 'video' ? (
                <video src={preview.url} controls className="max-h-[60vh] w-full" />
              ) : (
                <audio src={preview.url} controls className="w-full" />
              )}
            </div>
            {preview.caption ? (
              <p className="mt-3 text-[13px] text-ink-muted">{preview.caption}</p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <AssetDetailPanel
        asset={selected}
        genomeId={genome?.genomeId ?? ''}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onChanged={() => void search()}
      />
    </section>
  );
}
