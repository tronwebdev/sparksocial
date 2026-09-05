/**
 * The three recipe kinds, as the design draws them — and the one place the
 * prototype's vocabulary is translated into the engine's.
 *
 * `SparkSocial Automation.dc.html` names them AutoTrend Engager, Bulk Connector
 * and RSS Autopost, cycling cyan / amber / purple through the cards, the queue
 * chips and the wizard. `recipe.create` calls the same three `auto_trend`,
 * `bulk_connector` and `rss`. Everything that needs both lives here rather than
 * being re-derived per component.
 */

export type RecipeKind = 'auto_trend' | 'bulk_connector' | 'rss';

export const KINDS: readonly RecipeKind[] = ['auto_trend', 'bulk_connector', 'rss'];

export interface KindMeta {
  kind: RecipeKind;
  name: string;
  desc: string;
  /** The card's wash and the disc its glyph sits on. */
  bg: string;
  iconBg: string;
  /** The queue chip's fill and hairline. */
  chip: string;
  chipRing: string;
  /** The steps this kind's wizard walks, in order. */
  steps: readonly StepKind[];
}

export type StepKind = 'name' | 'query' | 'source' | 'validate' | 'feed' | 'freq';

export const KIND_META: Record<RecipeKind, KindMeta> = {
  auto_trend: {
    kind: 'auto_trend',
    name: 'AutoTrend Engager',
    desc: 'Surface trending topics from real-time queries and turn them into on-brand posts.',
    bg: 'var(--ss-grad-auto-trend)',
    iconBg: 'var(--ss-grad-auto-trend-icon)',
    chip: 'var(--ss-auto-trend-chip)',
    chipRing: 'rgba(11,170,199,0.35)',
    steps: ['name', 'query', 'freq'],
  },
  bulk_connector: {
    kind: 'bulk_connector',
    name: 'Bulk Connector',
    desc: 'Schedule a backlog of posts from CSV, Canva, Drive or a folder, on cycle.',
    bg: 'var(--ss-grad-auto-bulk)',
    iconBg: 'var(--ss-grad-auto-bulk-icon)',
    chip: 'var(--ss-auto-bulk-chip)',
    chipRing: 'rgba(228,137,21,0.35)',
    /* Four, per `wzKindsAll` in the prototype's own script — the extra step is
       the preview & validate pass between choosing a source and setting the
       cadence. */
    steps: ['name', 'source', 'validate', 'freq'],
  },
  rss: {
    kind: 'rss',
    name: 'RSS Autopost',
    desc: 'Auto-publish from any RSS feed & Podcast Stations with CTA, scheduling, and optional review gate.',
    bg: 'var(--ss-grad-auto-rss)',
    iconBg: 'var(--ss-grad-auto-rss-icon)',
    chip: 'var(--ss-auto-rss-chip)',
    chipRing: 'rgba(137,55,214,0.3)',
    steps: ['name', 'feed', 'freq'],
  },
};

/** The prompt SPARK "says" above each step — `atBubble` in the prototype. */
export const STEP_BUBBLE: Record<StepKind, string> = {
  name: 'Name this recipe and pick where its posts should publish.',
  query:
    'Search for trends globally by entering your keywords, selecting a language, and choosing a post age.',
  source: 'Select a file type to upload: CSV for a template, Canva folders, or Google Drive for access.',
  validate: '',
  feed: "Connect any RSS feed or Podcast Station and I'll turn new items into posts.",
  freq: 'Choose how often you want your campaign to run!',
};

/**
 * The queue's status chip.
 *
 * ── Where the design's five chips came from, and the one that had to go ────
 *
 * The prototype draws Published, Scheduled, Regenerating, Waiting Approval and
 * Failed. Four of those are real states a row can be in: a recipe output is
 * `pending_review` until somebody decides it (Waiting Approval), and once
 * approved it becomes a `content_items` row whose own status is what the other
 * three read.
 *
 * **Regenerating is not a state anything in this system enters.** Nothing
 * writes it, nothing clears it, and no tool reports it — it is a mock in the
 * fixture data. A row that has been drafted and not yet scheduled is a *draft*,
 * so that is what the chip says, in the neutral grey the palette already has.
 * Labelling drafts "Regenerating" would be a spinner over a thing that is not
 * spinning.
 */
export interface StatusChip {
  label: string;
  bg: string;
  ring: string;
  color: string;
}

export function statusChip(status: string): StatusChip {
  switch (status) {
    case 'published':
      return {
        label: 'Published',
        bg: 'var(--ss-auto-published-bg)',
        ring: 'var(--ss-green-500)',
        color: 'var(--ss-auto-published)',
      };
    case 'scheduled':
    case 'approved':
      return {
        label: 'Scheduled',
        bg: 'var(--ss-auto-scheduled-bg)',
        ring: 'var(--ss-auto-scheduled)',
        color: 'var(--ss-auto-scheduled)',
      };
    case 'pending_review':
    case 'needs_review':
      return {
        label: 'Waiting Approval',
        bg: 'var(--ss-auto-review-bg)',
        ring: 'var(--ss-auto-review-ring)',
        color: 'var(--ss-amber-500)',
      };
    case 'failed':
    case 'blocked':
      return {
        label: status === 'blocked' ? 'Blocked' : 'Failed',
        bg: 'var(--ss-auto-failed-bg)',
        ring: 'var(--ss-auto-failed)',
        color: 'var(--ss-auto-failed)',
      };
    default:
      return {
        label: 'Draft',
        bg: 'var(--ss-auto-draft-bg)',
        ring: 'rgba(131,131,131,0.35)',
        color: '#5B5B5B',
      };
  }
}

/** The six tabs, and which chip labels each one keeps. */
export const QUEUE_TABS: ReadonlyArray<{ label: string; keeps: readonly string[] | null }> = [
  { label: 'All', keeps: null },
  { label: 'Drafts', keeps: ['Draft'] },
  { label: 'Needs Review', keeps: ['Waiting Approval'] },
  { label: 'Scheduled', keeps: ['Scheduled'] },
  { label: 'Published', keeps: ['Published'] },
  { label: 'Failed', keeps: ['Failed', 'Blocked'] },
];

/** "Tue 12 Apr, 10:00" — the queue row's second line. */
export function queueStamp(iso: string | undefined): string {
  if (!iso) return 'No slot yet';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date}, ${time}`;
}

/** "26th April, 2026" — the manage view's created line. */
export function longDay(iso: string): string {
  const d = new Date(iso);
  const n = d.getDate();
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix} ${d.toLocaleDateString('en', { month: 'long' })}, ${d.getFullYear()}`;
}
