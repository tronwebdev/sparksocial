import { AssetsLibraryScreen } from '@/components/assets/AssetsLibraryScreen';

/**
 * `LIB-01` / `LIB-02` — `ui build/SparkSocial Assets Library.dc.html`.
 *
 * The page is the screen and nothing else. It used to be a stack of four
 * panels under a `TopBar` — an upload form, a gaps panel, a folder list and a
 * semantic search grid — which was the right *set* of capabilities and none of
 * the design: the prototype has no top bar at all, and its card carries the
 * title, the folder grid and the folder contents in one frame with Ask Spark at
 * the top right.
 *
 * Where the four went:
 *
 *   `FolderLibrary`   replaced. `AssetsLibraryScreen` is the design's version
 *                     of exactly this — folders, then a folder's assets in grid
 *                     or list — reading the same two tools.
 *   `AssetUploadForm` replaced by the design's Upload Files modal, which runs
 *                     the identical `asset.upload_url` → PUT →
 *                     `asset.ingest_url` sequence.
 *   `AssetSearchGrid` folded in as the folder search box. The screen searches
 *                     within an open folder rather than across the graph.
 *   `AssetGapsPanel`  not in this design, and not deleted — it answers
 *                     "what is missing", which the Command Center's queue asks
 *                     when a playbook cannot run. It stays a component with no
 *                     caller on this screen rather than being wired somewhere
 *                     the design does not put it.
 */
export default function AssetsPage() {
  return <AssetsLibraryScreen />;
}
