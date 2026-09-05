'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { AskSpark } from '@/components/shell/AskSpark';
import { CreateFolderModal } from './library/CreateFolderModal';
import { UploadFilesModal } from './library/UploadFilesModal';
import { RightsModal } from './library/RightsModal';
import { FolderMembersModal } from './library/FolderMembers';
import { DeleteFolderModal, PickFolderModal, RenameFolderModal, ShareFolderModal } from './library/FolderActionModals';
import { ViewAssetModal } from './library/ViewAssetModal';
import { FolderCard, CreateFolderCard, FoldersEmptyState, UnfiledCard } from './library/FolderCards';
import { AssetGrid, AssetList } from './library/AssetViews';
import { assetName, type Asset, type Folder } from './library/types';

/**
 * ASSETS LIBRARY — `ui build/SparkSocial Assets Library.dc.html`.
 *
 * One file, four screen labels, and they are the interaction spec rather than
 * four designs: `Assets Library` (the frame), `Assets Empty State`,
 * `My Folders`, `Folder Assets`, plus three modals — `Create Folder Modal`,
 * `Upload Files Modal`, `View Asset Modal`.
 *
 * ── The frame ────────────────────────────────────────────────────────────
 *
 * The card is `324,18 · 1386x1084` at radius 30 — which is `AppShell`'s own
 * `main` (`my-[18px] mr-[18px] rounded-2xl`, and `rounded-2xl` is 30 in this
 * config), so nothing here re-draws it. Only the wash differs, and it is this
 * screen's own (`--ss-grad-lib`): 115deg/245deg at 0.35 and 0.3 over `#F7F7F7`,
 * against the shared canvas's -157/-198deg at 0.2. Every x below is measured
 * from the card's left edge at 324, so the design's 352 is an inset of 28.
 *
 *   title       352,52    26px/700 "Assets Library"
 *   subtitle    352,96    16px/400 `#838383`
 *   Create      1226,50   226x52 r12 on `#0C0C0C`, a `#C46BF5` plus and a
 *                         16px/600 white label
 *   Ask Spark   1478,44   the 60px orb and its 44px pill
 *   rule        352,150   1300x1 `rgba(131,131,131,.2)`
 *
 * **Folders** (`My Folders`): the heading at 352,196 in 22/700, a Date picker
 * at 1160,184 (190x52 r12) and a search at 1366,184 (286x52), then cards on a
 * 270 pitch from 352,262 — each 248x266 at radius 18 under
 * `0 16px 40px -32px rgba(12,12,12,.35)`, with a 224x132 thumb well at 12,12,
 * a 24px checkbox at 22,22, a ⋯ at right 16, the name centred at 158 in
 * 16.5/700, "12 Files · 134MB" at 190 and "Created: …" at 220. The last cell is
 * a dashed create card at the same size.
 *
 * **Empty** (`Assets Empty State`): a blurred 530x560 ghost at 750,190, a
 * 170px white disc at 930,330 with two 12x5 eye pills, and a 500x210 white card
 * at 765,520 whose 22px notch points up at them — "Opps!, You don't have any
 * folder currently." in 24/700 over a 48px outlined Create button.
 *
 * **Folder contents** (`Folder Assets`): the folder name at 352,46, its meta
 * row at 94, Upload File at 1276,50 (176x52, `#6CE8FF` cloud), the rule at 130,
 * Back To Folders at 352,170, then a 272x56 view toggle at 907,162 (the active
 * half on `#9CEFFF`, `transition: background .2s`) and a 457x56 search at
 * 1195,162. Grid cards are 316x338 on a 328 pitch from 242; list rows are 114
 * tall under a 60px header with columns at 26/468/860/1000/1226.
 *
 * ── What is real, and the two places the design outruns the tools ────────
 *
 * Folders are real: `asset.folder.create` and `asset.folder.list` (which
 * returns `createdAt` and a real `assetCount`). Assets are real:
 * `asset.retrieve` gives url, mediaType, filename, sizeBytes, caption and
 * createdAt — every column the list view draws. Removing is `asset.archive`.
 * Uploading is `asset.upload_url` → PUT → `asset.ingest_url`, which is exactly
 * what `AssetUploadForm` already does and what the Upload modal reuses.
 *
 *   **"134MB" per folder.** Summed from the assets actually retrieved for that
 *   folder, and only shown when every one of them reports a size — `sizeBytes`
 *   is null on rows uploaded before that column existed, and a total that
 *   silently omits half its files is worse than no total.
 *
 *   **The folder ⋯ menu** ("rename, share, delete" in the prototype's toast).
 *   There is no rename, share or delete tool for a folder — `asset.folder.*` is
 *   create, list and move — so the menu says which of the three exist rather
 *   than opening onto three dead rows. Moving an asset *between* folders is
 *   real and lives on the asset, where the tool takes it.
 *
 * ── Retrieval is not a filesystem ────────────────────────────────────────
 *
 * There is no "list this folder" query. `asset.retrieve` is the Asset Graph's
 * only read and it is semantic, so a folder's contents are fetched by using the
 * folder's own name as the intent and filtering the results to that folder —
 * the same method `FolderLibrary` established, kept deliberately so the two
 * cannot disagree. A folder holding more than `k` assets shows the best matches
 * rather than all of them; the count on the folder card comes from a real
 * `count(*)`, so the two never quietly agree on a wrong number.
 */

const DATE_SORTS = [
  { key: 'newest' as const, label: 'Newest first' },
  { key: 'oldest' as const, label: 'Oldest first' },
  { key: 'name' as const, label: 'Name (A–Z)' },
];
type DateSort = (typeof DATE_SORTS)[number]['key'];

/**
 * The id the Unfiled shelf stands in under.
 *
 * Not a folder in the database — `assets.folderId` is null for these — so it
 * needs an id the rest of the screen can carry through `openFolder` without a
 * second "what am I looking at" flag. The double underscores are there because
 * folder ids are UUIDs and this can never collide with one.
 */
const UNFILED = '__unfiled__';

export function AssetsLibraryScreen() {
  const { genome, loading: genomeLoading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;

  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [openFolder, setOpenFolder] = useState<Folder | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [folderQuery, setFolderQuery] = useState('');
  const [sort, setSort] = useState<DateSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);

  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [assetQuery, setAssetQuery] = useState('');
  const [rawPage, setPage] = useState(0);

  /* Everything retrieval is holding back for rights, across the genome —
     `asset.retrieve` cannot return these, so they need their own read. */
  const [pending, setPending] = useState<Asset[] | null>(null);
  /** Which folder's ⋯ menu is open, and which folder an action panel is for. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Assets in no folder, and the one being re-filed. */
  const [unfiled, setUnfiled] = useState<Asset[] | null>(null);
  const [filing, setFiling] = useState<Asset | null>(null);
  const [actOn, setActOn] = useState<{
    folder: Folder;
    action: 'rename' | 'delete' | 'share' | 'members';
  } | null>(null);
  const [modal, setModal] = useState<'create' | 'upload' | 'rights' | null>(null);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The design's toast: bottom-centre, 2.2s, one at a time. */
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2300);
  }, []);

  const loadFolders = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ folders: Folder[] }>('asset.folder.list', { genomeId });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setFolders([]);
      return;
    }
    setError(null);
    setFolders(res.output.folders);
  }, [genomeId]);

  useEffect(() => {
    if (!menuFor) return;
    /* Capture phase, so the ⋯ button's own handler still runs and toggles —
       without it a second click would close and immediately reopen. */
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  const loadUnfiled = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ assets: Asset[] }>('asset.unfiled', { genomeId });
    setUnfiled(res.status === 'succeeded' ? res.output.assets : []);
  }, [genomeId]);

  const loadPending = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ assets: Asset[] }>('asset.rights.pending', { genomeId });
    setPending(res.status === 'succeeded' ? res.output.assets : []);
  }, [genomeId]);

  useEffect(() => {
    void loadFolders();
    void loadPending();
    void loadUnfiled();
  }, [loadFolders, loadPending, loadUnfiled]);

  /* `?folder=` is what Share hands out; opening it lands on that folder rather
     than on the folder grid. Runs once per load — `openedFromUrl` keeps a Back
     To Folders from being undone by this effect on the next render. */
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || !folders) return;
    const wanted = new URLSearchParams(window.location.search).get('folder');
    if (!wanted) return;
    openedFromUrl.current = true;
    const found = folders.find((f) => f.folderId === wanted);
    if (found) {
      setOpenFolder(found);
      setView('grid');
    } else {
      say('That folder link is not in this brand — pick a brand it belongs to, or ask whoever shared it.');
    }
  }, [folders, say]);

  const loadAssets = useCallback(
    async (folder: Folder) => {
      if (!genomeId) return;
      setAssets(null);
      /* The Unfiled shelf is not a folder row — it is the absence of one — so
         it reads the direct listing rather than semantic retrieval. */
      if (folder.folderId === UNFILED) {
        const res = await invoke<{ assets: Asset[] }>('asset.unfiled', { genomeId });
        const rows = res.status === 'succeeded' ? res.output.assets : [];
        setUnfiled(rows);
        setAssets(rows);
        return;
      }
      const res = await invoke<{ results: Asset[] }>('asset.retrieve', {
        genomeId,
        /* The folder's own name is the query — see this file's header on why
           retrieval, not a folder predicate. */
        intent: folder.name,
        k: 50,
      });
      if (res.status !== 'succeeded') {
        setAssets([]);
        return;
      }
      setAssets(res.output.results.filter((a) => a.folderId === folder.folderId));
    },
    [genomeId],
  );

  useEffect(() => {
    if (openFolder) void loadAssets(openFolder);
  }, [openFolder, loadAssets]);

  const visibleFolders = useMemo(() => {
    const list = [...(folders ?? [])];
    const q = folderQuery.trim().toLowerCase();
    const filtered = q ? list.filter((f) => f.name.toLowerCase().includes(q)) : list;
    return filtered.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'oldest'
          ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }, [folders, folderQuery, sort]);

  const visibleAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return assets ?? [];
    return (assets ?? []).filter((a) =>
      `${a.filename ?? ''} ${a.caption ?? ''} ${a.mediaType}`.toLowerCase().includes(q),
    );
  }, [assets, assetQuery]);

  const shelfCount =
    openFolder?.folderId === UNFILED ? (assets?.length ?? 0) : (openFolder?.assetCount ?? 0);

  const folderPending = useMemo(
    () => (openFolder ? (pending ?? []).filter((a) => a.folderId === openFolder.folderId) : (pending ?? [])),
    [pending, openFolder],
  );

  /* The design's grid runs two rows of four between the toolbar and the pager
     at 1006; the list, at 114px a row under a 60px header, fits six. */
  const pageSize = view === 'grid' ? 8 : 6;
  const pageCount = Math.max(1, Math.ceil(visibleAssets.length / pageSize));
  const page = Math.min(rawPage, pageCount - 1);
  const pageAssets = useMemo(
    () => visibleAssets.slice(page * pageSize, page * pageSize + pageSize),
    [visibleAssets, page, pageSize],
  );

  /**
   * Share = a link to the folder.
   *
   * Not a public link. `whitelabel.link.create` mints unauthenticated review
   * tokens, but nothing serves them yet — there is no `/review/[token]` route —
   * so handing someone one would be handing them a 404. This is an in-app deep
   * link: anyone already in the workspace opens the folder, anyone else hits
   * sign-in. When the public review page exists, a folder scope on that tool is
   * the upgrade path.
   */
  function folderLink(f: Folder): string {
    return `${window.location.origin}/assets?folder=${encodeURIComponent(f.folderId)}`;
  }

  async function removeAsset(a: Asset) {
    if (!genomeId) return;
    const res = await invoke('asset.archive', { genomeId, assetId: a.assetId }, `asset-archive:${a.assetId}`);
    if (res.status !== 'succeeded') {
      say(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setAssets((prev) => prev?.filter((x) => x.assetId !== a.assetId) ?? prev);
    say(`${a.filename ?? a.caption ?? 'Asset'} deleted`);
    void loadFolders();
  }

  if (genomeLoading) {
    return <div className="h-full w-full bg-lib-wash" />;
  }

  if (genomeError || !genomeId) {
    return (
      <div className="h-full w-full bg-lib-wash px-lib-inset pt-[34px]">
        <p className="text-16 text-ink-muted">{genomeError ?? 'No brand selected.'}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-y-auto bg-lib-wash pb-[40px]">
      {/* ── header band ──────────────────────────────────────────────── */}
      {/*
        A fixed 98px band, not "whatever the tallest child measures".

        The design's rule is at y=150 and its title at 52, and the row between
        them holds three things of different heights — the title block (60),
        the black action (52) and Ask Spark's own block (66). Letting the row
        size itself put the rule at 122 and pushed everything below it down by
        the difference, which is how the folder cards ended up 62px low. The
        band is the design's measurement; `items-start` keeps each child on its
        own top edge inside it.
      */}
      <div
        className={cn(
          'flex flex-wrap items-start gap-4 px-lib-inset max-xl:h-auto max-xl:pb-4',
          /* The band runs from the card's top edge to its rule, and the two
             pages put the rule in different places: 150 on the folder list
             (a 26px title over a 16px subtitle) and 130 inside a folder (the
             same title over a 15.5px meta row). Minus the card's own 18, that
             is 132 and 112. */
          openFolder ? 'h-[112px] pt-[28px]' : 'h-[132px] pt-[34px]',
        )}
        /* The right edge is the card's, less the 12 the design leaves beside
           Ask Spark — which is what puts the black action's right edge on 1452
           rather than hard against the pill. */
        style={{ paddingRight: 12, columnGap: 26 }}
      >
        <div className="min-w-0 flex-1">
          {openFolder ? (
            <>
              {/* 352,46 — the folder's own name, then its meta row at 94. */}
              <h1 className="truncate text-[26px] font-bold leading-[1.27] text-ink">{openFolder.name}</h1>
              {/* 94 against a title box of 46..79. */}
              <div className="mt-[15px] flex flex-wrap items-center gap-[14px] text-[15.5px] font-medium" style={{ color: '#5B5B5B' }}>
                <span>
                  {/* The Unfiled shelf has no row of its own, so its count is
                      whatever the listing just returned rather than a stored
                      `assetCount` that goes stale the moment one is filed. */}
                  {shelfCount} {shelfCount === 1 ? 'File' : 'Files'}
                </span>
                <Dot />
                <span>{folderSize(assets)}</span>
                {openFolder.folderId === UNFILED ? null : (
                  <>
                    <Dot />
                    <span>Created: {longDate(openFolder.createdAt)}</span>
                  </>
                )}
                {/* `asset.retrieve` filters to `rightsStatus = 'cleared'`
                    (`packages/db/src/scoped.ts`), so a folder can hold more than
                    it will hand back. The count is the real list from
                    `asset.rights.pending`, and it opens that list — a number
                    you cannot act on is just an accusation. */}
                {folderPending.length > 0 ? (
                  <>
                    <Dot />
                    <button
                      type="button"
                      onClick={() => setModal('rights')}
                      className="underline underline-offset-[3px] transition-opacity hover:opacity-70"
                      style={{ color: '#B4762A' }}
                    >
                      {folderPending.length} awaiting rights clearance
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[26px] font-bold leading-[1.27] text-ink">Assets Library</h1>
              <p className="mt-[11px] text-16 font-normal text-ink-muted">
                A centralized hub for managing and accessing all your digital assets.
              </p>
              {/* The same list, reachable before a folder is open — otherwise a
                  pending asset is only findable by guessing which folder it
                  landed in. */}
              {(pending ?? []).length > 0 ? (
                <button
                  type="button"
                  onClick={() => setModal('rights')}
                  className="mt-[8px] text-15 font-medium underline underline-offset-[3px] transition-opacity hover:opacity-70"
                  style={{ color: '#B4762A' }}
                >
                  {(pending ?? []).length} {(pending ?? []).length === 1 ? 'asset is' : 'assets are'} waiting on rights clearance — review
                </button>
              ) : null}
            </>
          )}
        </div>

        {/* The design's black action sits left of Ask Spark, and swaps with the
            page: Create A New Folder on the folder list, Upload File inside a
            folder. */}
        {openFolder && openFolder.folderId !== UNFILED ? (
          <button
            type="button"
            onClick={() => setModal('upload')}
            className="flex h-[52px] w-[176px] shrink-0 items-center justify-center gap-[11px] rounded-xl bg-ink transition-colors hover:bg-[#242424] active:scale-[0.985]"
          >
            <svg width="21" height="18" viewBox="0 0 21 18" fill="none" aria-hidden>
              <path d="M5.4 14.5H4.8A3.8 3.8 0 0 1 4 7a5.4 5.4 0 0 1 10.6-1.2A4.3 4.3 0 0 1 16 14.4h-.9" stroke="#6CE8FF" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M10.5 16.6V9.2m0 0-2.7 2.7m2.7-2.7 2.7 2.7" stroke="#6CE8FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="whitespace-nowrap text-16 font-semibold text-white">Upload File</span>
          </button>
        ) : (folders?.length ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => setModal('create')}
            className="flex h-[52px] w-[226px] shrink-0 items-center justify-center gap-[10px] rounded-xl bg-ink transition-colors hover:bg-[#242424] active:scale-[0.985]"
          >
            <span className="text-[19px] font-semibold leading-none" style={{ color: '#C46BF5' }}>
              +
            </span>
            <span className="whitespace-nowrap text-16 font-semibold text-white">Create A New Folder</span>
          </button>
        ) : null}

        {/* 1478,44 — the orb and pill, which is `AskSpark`'s own block and the
            one drawer this app has. */}
        <div className="hidden shrink-0 xl:block">
          <AskSpark compact />
        </div>
      </div>

      {/* 352,150 — full-width rule, inset 28 with the design's 1300 cap. */}
      <div className="mx-lib-inset h-px max-w-lib-rule" style={{ background: 'rgba(131,131,131,0.2)' }} />

      {error ? <p className="px-lib-inset pt-6 text-16 text-ink-muted">{error}</p> : null}

      {openFolder ? (
        /* ── folder contents ──────────────────────────────────────────── */
        <div className="px-lib-inset pt-[32px]">
          {/* 162..218 — Back To Folders and the toggle/search share one row,
              both centred on 190. */}
          <div className="flex min-h-[56px] flex-wrap items-center gap-4 pr-[30px]">
            <button
              type="button"
              onClick={() => {
                setOpenFolder(null);
                setAssetQuery('');
                setPage(0);
                void loadFolders();
              }}
              className="flex h-[40px] items-center gap-[13px] transition-opacity hover:opacity-70"
            >
              <span
                className="flex h-[29px] w-[29px] items-center justify-center rounded-full"
                style={{ boxShadow: 'inset 0 0 0 1.2px rgba(12,12,12,0.5)' }}
              >
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
                  <path d="M6 1 1 6l5 5" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="whitespace-nowrap text-[19px] font-semibold text-ink">Back To Folders</span>
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-[16px]">
              {/* 907,162 · 272x56, the active half on `#9CEFFF` over .2s. */}
              <div
                className="flex h-[56px] w-[272px] shrink-0 items-center rounded-[14px] bg-white p-[5px]"
                style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
              >
                <ViewToggle active={view === 'list'} onClick={() => setView('list')} label="List View" width={126}>
                  <svg width="18" height="15" viewBox="0 0 19 16" fill="none" aria-hidden>
                    <path d="M6 2h12M6 8h12M6 14h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="1.6" cy="2" r="1.5" fill="#0C0C0C" />
                    <circle cx="1.6" cy="8" r="1.5" fill="#0C0C0C" />
                    <circle cx="1.6" cy="14" r="1.5" fill="#0C0C0C" />
                  </svg>
                </ViewToggle>
                <ViewToggle active={view === 'grid'} onClick={() => setView('grid')} label="Grid View" width={132}>
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
                    <rect x="1" y="1" width="6" height="6" rx="1.6" stroke="#0C0C0C" strokeWidth="1.5" />
                    <rect x="10" y="1" width="6" height="6" rx="1.6" stroke="#0C0C0C" strokeWidth="1.5" />
                    <rect x="1" y="10" width="6" height="6" rx="1.6" stroke="#0C0C0C" strokeWidth="1.5" />
                    <rect x="10" y="10" width="6" height="6" rx="1.6" stroke="#0C0C0C" strokeWidth="1.5" />
                  </svg>
                </ViewToggle>
              </div>

              {/* 1195,162 · 457x56. The design swaps its placeholder with the
                  view, which is a nice tell that the search is over files. */}
              <SearchBox
                value={assetQuery}
                onChange={(v) => {
                  setAssetQuery(v);
                  setPage(0);
                }}
                placeholder={view === 'grid' ? 'Search files' : 'Search folder'}
                className="h-[56px] w-[457px] max-w-full rounded-[14px]"
                label="Search files in this folder"
              />
            </div>
          </div>

          <div className="mt-[24px]">
            {assets === null ? (
              <p className="text-16 text-ink-muted">Loading…</p>
            ) : visibleAssets.length === 0 ? (
              <p className="text-16 text-ink-muted">
                {assetQuery
                  ? 'Nothing in this folder matches that search.'
                  : (assets?.length ?? 0) === 0 && openFolder.assetCount > 0
                    ? `This folder holds ${openFolder.assetCount} ${openFolder.assetCount === 1 ? 'asset' : 'assets'}, and retrieval could not surface them by the folder's name — the Asset Graph is an index of meaning, not a filesystem. Search for what is in them instead.`
                    : 'Nothing here yet. Upload a file to fill this folder.'}
              </p>
            ) : view === 'grid' ? (
              <AssetGrid
                assets={pageAssets}
                onPreview={setPreview}
                onRemove={(a) => void removeAsset(a)}
                {...(openFolder.folderId === UNFILED ? { onFile: setFiling } : {})}
              />
            ) : (
              <AssetList
                assets={pageAssets}
                onPreview={setPreview}
                onRemove={(a) => void removeAsset(a)}
                {...(openFolder.folderId === UNFILED ? { onFile: setFiling } : {})}
              />
            )}
          </div>

          {/* 352,1006 "Page 1 of 4" in 16/500 #5B5B5B, then two 34px discs at
              1568 and 1612 ringed `rgba(131,131,131,.35)`, the disabled one at
              .45 opacity. The prototype's next arrow only toasts; here it pages
              for real over what retrieval returned — a page is a slice of the
              list already in hand, so `Page x of y` is a count of that list and
              not a claim about the graph. */}
          <div className="mt-[30px] flex max-w-lib-rule items-center gap-[16px]">
            <span className="text-16 font-medium" style={{ color: '#5B5B5B' }}>
              Page {pageCount === 0 ? 0 : page + 1} of {pageCount}
            </span>
            <span className="text-[15px] font-normal" style={{ color: '#838383' }}>
              {visibleAssets.length} of {assets?.length ?? 0} shown
            </span>
            <div className="ml-auto flex items-center gap-[10px] pr-[6px]">
              <PageDisc
                back
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                label="Previous page"
              />
              <PageDisc
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                label="Next page"
              />
            </div>
          </div>
        </div>
      ) : folders === null ? (
        <div className="px-lib-inset pt-[30px]">
          <p className="text-16 text-ink-muted">Loading folders…</p>
        </div>
      ) : folders.length === 0 ? (
        <FoldersEmptyState onCreate={() => setModal('create')} />
      ) : (
        /* ── folder list ──────────────────────────────────────────────── */
        <div className="px-lib-inset pt-[34px]">
          {/* 184..236 — the heading and both controls share one 52px row.
              `pr-[30px]` on top of the section's own 28 makes 58, which is
              where the design ends its rule and both controls. The grid below
              keeps the full width, because the design's fifth cell runs to
              1680 — the card's own edge. The heading and both controls are
              centred on 210, which is where the design puts all three. */}
          <div className="flex min-h-[52px] flex-wrap items-center gap-4 pr-[30px]">
            <h2 className="whitespace-nowrap text-[22px] font-bold text-ink">My Folders</h2>

            <div className="ml-auto flex flex-wrap items-center gap-[16px]">
              {/* 1160,184 · 190x52. The design toasts "Date filter — mock"; the
                  folder list is held client-side, so the sort is real. */}
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((v) => !v)}
                  className="flex h-[52px] w-[190px] items-center gap-[12px] rounded-xl bg-white px-[18px] transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
                >
                  <svg width="19" height="20" viewBox="0 0 24 25" fill="none" aria-hidden className="shrink-0">
                    <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#5B5B5B" strokeWidth="1.8" />
                    <path d="M2.9 9.9h18.2" stroke="#5B5B5B" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#5B5B5B" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <span className="flex-1 text-left text-16 font-medium" style={{ color: '#5B5B5B' }}>
                    {sort === 'newest' ? 'Date' : DATE_SORTS.find((d) => d.key === sort)!.label}
                  </span>
                  <svg width="13" height="8" viewBox="0 0 13 8" fill="none" aria-hidden className="shrink-0">
                    <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {sortOpen ? (
                  <div
                    className="absolute right-0 top-[58px] z-20 w-[200px] rounded-xl bg-white p-[6px]"
                    style={{ boxShadow: '0 18px 40px -18px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.2)' }}
                  >
                    {DATE_SORTS.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => {
                          setSort(d.key);
                          setSortOpen(false);
                        }}
                        className={cn(
                          'flex h-[40px] w-full items-center rounded-lg px-[12px] text-left text-[15px] font-medium',
                          d.key === sort ? 'bg-[rgba(131,131,131,0.1)] text-ink' : 'text-ink-muted hover:bg-[rgba(131,131,131,0.07)]',
                        )}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* 1366,184 · 286x52 */}
              <SearchBox
                value={folderQuery}
                onChange={setFolderQuery}
                placeholder="Search folder"
                className="h-[52px] w-[286px] max-w-full rounded-xl"
                label="Search folders"
              />
            </div>
          </div>

          {/* 262 — cards on a 270 pitch, the create card last. */}
          <div className="mt-[26px] flex flex-wrap gap-lib-folder-gap">
            {visibleFolders.map((f) => (
              <FolderCard
                key={f.folderId}
                folder={f}
                checked={checked.includes(f.folderId)}
                onCheck={() =>
                  setChecked((prev) =>
                    prev.includes(f.folderId) ? prev.filter((x) => x !== f.folderId) : [...prev, f.folderId],
                  )
                }
                onOpen={() => {
                  setOpenFolder(f);
                  setView('grid');
                  setPage(0);
                }}
                menuOpen={menuFor === f.folderId}
                onMenu={() => setMenuFor((cur) => (cur === f.folderId ? null : f.folderId))}
                onRename={() => setActOn({ folder: f, action: 'rename' })}
                onShare={() => setActOn({ folder: f, action: 'share' })}
                onMembers={() => setActOn({ folder: f, action: 'members' })}
                onDelete={() => setActOn({ folder: f, action: 'delete' })}
              />
            ))}
            {folderQuery.trim() ? null : (
              <>
                {(unfiled?.length ?? 0) > 0 ? (
                  <UnfiledCard
                    count={unfiled!.length}
                    onOpen={() => {
                      setOpenFolder({
                        folderId: UNFILED,
                        name: 'Unfiled',
                        createdAt: new Date().toISOString(),
                        assetCount: unfiled!.length,
                      });
                      setView('grid');
                      setPage(0);
                    }}
                  />
                ) : null}
                <CreateFolderCard onCreate={() => setModal('create')} />
              </>
            )}
          </div>

          {visibleFolders.length === 0 && folderQuery.trim() ? (
            <p className="mt-[24px] text-16 text-ink-muted">No folder matches “{folderQuery.trim()}”.</p>
          ) : null}
        </div>
      )}

      {/* ── modals ───────────────────────────────────────────────────── */}
      {modal === 'create' ? (
        <CreateFolderModal
          genomeId={genomeId}
          onClose={() => setModal(null)}
          onCreated={(name) => {
            setModal(null);
            say(`Folder “${name}” created`);
            void loadFolders();
          }}
        />
      ) : null}

      {modal === 'upload' && openFolder ? (
        <UploadFilesModal
          genomeId={genomeId}
          folder={openFolder}
          onClose={() => setModal(null)}
          onDone={(count) => {
            setModal(null);
            say(`${count} ${count === 1 ? 'file' : 'files'} added to ${openFolder.name}`);
            void loadAssets(openFolder);
            void loadFolders();
            /* An upload without the rights box ticked lands as `pending`, which
               means it appears in neither the grid nor the folder — without
               this it would show up nowhere until the next page load. */
            void loadPending();
          }}
        />
      ) : null}

      {modal === 'rights' ? (
        <RightsModal
          genomeId={genomeId}
          assets={folderPending}
          onClose={() => setModal(null)}
          onChanged={(message) => {
            say(message);
            void loadPending();
            /* Cleared means retrievable, so the folder itself changes too. */
            if (openFolder) void loadAssets(openFolder);
          }}
        />
      ) : null}

      {actOn?.action === 'members' ? (
        <FolderMembersModal
          genomeId={genomeId}
          folder={actOn.folder}
          onClose={() => setActOn(null)}
          onSaved={(count) => {
            setActOn(null);
            say(
              count === 0
                ? `Nobody is assigned to “${actOn.folder.name}”`
                : `${count} ${count === 1 ? 'person' : 'people'} assigned to “${actOn.folder.name}”`,
            );
          }}
        />
      ) : null}

      {actOn?.action === 'share' ? (
        <ShareFolderModal folder={actOn.folder} url={folderLink(actOn.folder)} onClose={() => setActOn(null)} />
      ) : null}

      {actOn?.action === 'rename' ? (
        <RenameFolderModal
          genomeId={genomeId}
          folder={actOn.folder}
          onClose={() => setActOn(null)}
          onRenamed={(name) => {
            setActOn(null);
            say(`Folder renamed to “${name}”`);
            /* The open folder carries its own copy of the row. */
            setOpenFolder((cur) => (cur && cur.folderId === actOn.folder.folderId ? { ...cur, name } : cur));
            void loadFolders();
          }}
        />
      ) : null}

      {actOn?.action === 'delete' ? (
        <DeleteFolderModal
          genomeId={genomeId}
          folder={actOn.folder}
          onClose={() => setActOn(null)}
          onDeleted={(unfiled) => {
            setActOn(null);
            say(
              unfiled === 0
                ? `“${actOn.folder.name}” deleted`
                : `“${actOn.folder.name}” deleted — ${unfiled} ${unfiled === 1 ? 'file is' : 'files are'} now unfiled`,
            );
            if (openFolder?.folderId === actOn.folder.folderId) setOpenFolder(null);
            void loadFolders();
            void loadPending();
            /* The files that were in it are on the Unfiled shelf now. */
            void loadUnfiled();
          }}
        />
      ) : null}

      {filing ? (
        <PickFolderModal
          genomeId={genomeId}
          asset={filing.assetId}
          assetName={assetName(filing)}
          folders={folders ?? []}
          onClose={() => setFiling(null)}
          onFiled={(name) => {
            setFiling(null);
            say(`Moved to “${name}”`);
            void loadUnfiled();
            void loadFolders();
            if (openFolder) void loadAssets(openFolder);
          }}
        />
      ) : null}

      {preview ? <ViewAssetModal asset={preview} onClose={() => setPreview(null)} /> : null}

      {/* The design's toast — fixed, bottom-centre, `ss-toast 2.2s`. */}
      {toast ? (
        <div
          role="status"
          className="fixed bottom-[34px] left-1/2 z-[100] -translate-x-1/2 animate-toast-in whitespace-nowrap rounded-xl px-[22px] py-[13px] text-15 font-medium text-white motion-reduce:animate-none"
          style={{ background: '#0C0C0C', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.4)' }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/* 34px discs at 1568/1612, ringed `rgba(131,131,131,.35)`; the design draws the
   unavailable one at .45 opacity rather than hiding it. */
function PageDisc({
  back = false,
  disabled,
  onClick,
  label,
}: {
  back?: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors enabled:hover:bg-[rgba(131,131,131,0.08)] disabled:cursor-default"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', opacity: disabled ? 0.45 : 1 }}
    >
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden style={back ? { transform: 'scaleX(-1)' } : undefined}>
        <path d="m1 1 5 5-5 5" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function Dot() {
  return <span aria-hidden className="block h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: '#838383' }} />;
}

function ViewToggle({
  active,
  onClick,
  label,
  width,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ width, background: active ? 'var(--ss-lib-toggle)' : '#FFFFFF' }}
      className="flex h-[46px] items-center justify-center gap-[9px] rounded-[10px] transition-colors duration-200 motion-reduce:transition-none"
    >
      {children}
      <span className="whitespace-nowrap text-[15.5px] font-semibold text-ink">{label}</span>
    </button>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
  className,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className: string;
  label: string;
}) {
  return (
    <div className={cn('relative bg-white', className)} style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-full w-full bg-transparent pl-[18px] pr-[46px] text-[15.5px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
      />
      <svg
        width="19"
        height="19"
        viewBox="0 0 26 26"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute right-[18px] top-1/2 -translate-y-1/2"
      >
        <circle cx="11" cy="11" r="8" stroke="#838383" strokeWidth="2" />
        <path d="m17 17 6 6" stroke="#838383" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** "Oct 2, 2026" — the design's own format. */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A folder's total size.
 *
 * Only stated when every asset reports one: `sizeBytes` is null on rows
 * uploaded before that column existed, and "134MB" that silently omits half the
 * files is a wrong number rather than a missing one.
 */
export function folderSize(assets: Asset[] | null): string {
  if (!assets || assets.length === 0) return '—';
  if (assets.some((a) => a.sizeBytes === null || a.sizeBytes === undefined)) return 'size partly unknown';
  const total = assets.reduce((n, a) => n + (a.sizeBytes ?? 0), 0);
  return formatBytes(total);
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}
