'use client';

import { platformLabel } from '@/lib/platforms';

/**
 * The queue card's filter row — `SparkSocial Command Center.dc.html`.
 *
 * Shared, because the design has one card on the Agent Calendar tab and swaps
 * only its body: the heading, the info glyph and these five filters stay put
 * whether you are in List View or Calendar Mode.
 *
 * The design puts them at 601 / 811 / 1021 / 1231 / 1441, each 194x54 at radius
 * 10 in a `rgba(131,131,131,0.3)` ring, on a 210px pitch. That last one runs to
 * 1635 in a 1629 card — the design overflows its own card by 6px — so they are
 * right-anchored to the card's edge instead, which lands the first on 600.
 *
 * ── They filter now ───────────────────────────────────────────────────────
 *
 * All five were inert, with a title saying so, on the reasoning that the
 * prototype toasts them as mocks. That was wrong about where the data is:
 * `content.list` returns the whole queue in one read and `PlanQueue` already
 * holds it client-side to sort and page it, so filtering it needs no new tool
 * and no round trip. Four of the five are real selects over the values actually
 * present in the loaded rows.
 *
 * `By Account` is the exception and stays disabled: an "account" is a connected
 * social login, `content_items` carries a `platform` and no account id, and
 * `integration.health` — which does know about accounts — is not what this card
 * reads. Filtering by it would need a field that does not exist rather than a
 * control that does not work.
 */

export interface QueueFilterState {
  platform: string;
  mediaType: string;
  status: string;
  /** `'any'`, or a window in days as a string — see `DATE_WINDOWS`. */
  when: string;
}

export const EMPTY_FILTERS: QueueFilterState = {
  platform: 'any',
  mediaType: 'any',
  status: 'any',
  when: 'any',
};

/** Windows a queue is actually asked about, forwards and back. */
export const DATE_WINDOWS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'any', label: 'Date' },
  { value: '7', label: 'Next 7 days' },
  { value: '30', label: 'Next 30 days' },
  { value: 'past', label: 'Already past' },
  { value: 'none', label: 'No slot yet' },
];

/** Does a row survive the current filter? Exported so the card can count. */
export function matchesFilters(
  row: { platform?: string; mediaType?: string; status: string; scheduledAt?: string },
  f: QueueFilterState,
  now = Date.now(),
): boolean {
  if (f.platform !== 'any' && row.platform !== f.platform) return false;
  if (f.mediaType !== 'any' && (row.mediaType ?? 'text') !== f.mediaType) return false;
  if (f.status !== 'any' && row.status !== f.status) return false;

  if (f.when !== 'any') {
    const at = row.scheduledAt ? Date.parse(row.scheduledAt) : null;
    if (f.when === 'none') return at === null;
    if (at === null) return false;
    if (f.when === 'past') return at < now;
    const days = Number(f.when);
    if (Number.isFinite(days)) return at >= now && at <= now + days * 86_400_000;
  }
  return true;
}

/** The design's 194x54 box, holding a native select so it is keyboard-usable. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
  hasCal,
  disabledReason,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
  hasCal?: boolean;
  disabledReason?: string;
}) {
  const inert = Boolean(disabledReason) || options.length <= 1;
  return (
    <div
      title={disabledReason ?? (options.length <= 1 ? `Nothing in the queue to filter by ${label.toLowerCase()}.` : undefined)}
      className={`relative flex h-[54px] w-[194px] shrink-0 items-center gap-[11px] rounded bg-white px-4 transition-shadow ${
        inert ? 'opacity-55' : 'hover:shadow-[inset_0_0_0_1.4px_#838383]'
      }`}
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
    >
      {hasCal ? (
        <svg width="19" height="20" viewBox="0 0 24 25" fill="none" aria-hidden className="shrink-0">
          <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#838383" strokeWidth="1.8" />
          <path d="M2.9 9.9h18.2" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : null}

      <label className="sr-only" htmlFor={`queue-filter-${label}`}>
        {label}
      </label>
      <select
        id={`queue-filter-${label}`}
        value={value}
        disabled={inert}
        onChange={(e) => onChange(e.target.value)}
        /* `appearance-none` because the design draws its own chevron, and the
           native one would sit beside it. */
        className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-16 font-medium text-ink outline-none disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <svg width="13" height="8" viewBox="0 0 13 8" fill="none" aria-hidden className="shrink-0">
        <path d="m1 1 5.5 6L12 1" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function QueueFilters({
  value,
  onChange,
  platforms,
  mediaTypes,
  statuses,
  statusLabel,
}: {
  value: QueueFilterState;
  onChange: (next: QueueFilterState) => void;
  /** The values actually present in the loaded rows — an option nothing matches is a dead end. */
  platforms: readonly string[];
  mediaTypes: readonly string[];
  statuses: readonly string[];
  /** Turns a `content_items.status` into the chip's own wording. */
  statusLabel: (s: string) => string;
}) {
  const set = (patch: Partial<QueueFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="ml-auto flex shrink-0 items-center gap-[16px]">
      <span className="mr-[36px] flex shrink-0 items-center gap-[11px]">
        <svg width="24" height="17" viewBox="0 0 24 17" fill="none" aria-hidden>
          <path d="M1 2h22M4.5 8.5h15M9 15h6" stroke="#838383" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="text-16 font-semibold text-ink-muted">Filters:</span>
      </span>

      <FilterSelect
        label="Date"
        hasCal
        value={value.when}
        onChange={(when) => set({ when })}
        options={DATE_WINDOWS}
      />
      <FilterSelect
        label="Channels"
        value={value.platform}
        onChange={(platform) => set({ platform })}
        options={[
          { value: 'any', label: 'Channels' },
          ...platforms.map((p) => ({ value: p, label: platformLabel(p) })),
        ]}
      />
      <FilterSelect
        label="Content type"
        value={value.mediaType}
        onChange={(mediaType) => set({ mediaType })}
        options={[
          { value: 'any', label: 'Content type' },
          ...mediaTypes.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) })),
        ]}
      />
      <FilterSelect
        label="By Status"
        value={value.status}
        onChange={(status) => set({ status })}
        options={[
          { value: 'any', label: 'By Status' },
          ...statuses.map((st) => ({ value: st, label: statusLabel(st) })),
        ]}
      />
      <FilterSelect
        label="By Account"
        value="any"
        onChange={() => undefined}
        options={[{ value: 'any', label: 'By Account' }]}
        disabledReason="An account is a connected social login. `content_items` carries a platform and no account id, so there is no field here to filter by."
      />
    </div>
  );
}

/**
 * The card's header band, shared by both views for the same reason.
 *
 * 86 tall on this card — its 54px filter boxes sit on 16..70 — with the heading
 * on 28,30 and the info glyph beside it, where the design puts it (265) rather
 * than at the right edge, which is where it was stealing 31px from the row.
 */
export function QueueCardHeader({
  title,
  hint,
  filters,
}: {
  title: string;
  hint: string;
  /** The filter row, when this card has one. */
  filters?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 pb-[16px] pl-7 pr-0 pt-[16px]">
      <h2 className="text-20 font-semibold leading-[1.28] text-ink">{title}</h2>
      <span
        title={hint}
        className="flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
        style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
      >
        i
      </span>
      {filters}
    </div>
  );
}
