import { cn } from '@/lib/utils';
import { SparkMark } from './SparkMark';

/**
 * What a wait looks like when there is no shape to show yet: SPARK thinking —
 * head tilted, eyes scanning, dots orbiting — with one line saying what it is
 * fetching.
 *
 * It replaces the bare grey "Loading…" lines that sat where whole screens and
 * panels were about to appear, and gives the app a page-level loading state it
 * did not have. A skeleton is still the right answer where the shape of what is
 * coming is known (a list, a grid of cards): it says how much is coming, which
 * this cannot. This is for the waits before that — opening the account,
 * resolving the brand, a panel's first read.
 *
 *   page    the whole viewport, for the guards and route loading
 *   panel   centred in the space a section will fill
 *   inline  a row, for dropdowns and lists
 *
 * `role="status"` with the label as its text, so a screen reader hears what is
 * loading rather than nothing until the content appears.
 */
const SIZE = { page: 120, panel: 72, inline: 30 } as const;

export function SparkLoader({
  label = 'Loading…',
  size = 'panel',
  className,
}: {
  label?: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  if (size === 'inline') {
    return (
      <div role="status" className={cn('flex items-center gap-[10px] text-14 text-ink-muted', className)}>
        <SparkMark size={SIZE.inline} mood="thinking" decorative />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-[18px] text-center',
        size === 'page' ? 'min-h-screen p-8' : 'w-full py-[48px]',
        className,
      )}
    >
      <SparkMark size={SIZE[size]} mood="thinking" decorative />
      <p className={cn('text-ink-muted', size === 'page' ? 'text-16' : 'text-15')}>{label}</p>
    </div>
  );
}

/**
 * The other end of a wait: SPARK in its error mood above a heading and a line
 * of detail. For the screens that stop the app rather than one panel —
 * "Could not open your account" — where a grey sentence alone read as a blank
 * page with a typo on it.
 */
export function SparkFailure({ title, detail, className }: { title: string; detail?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('flex min-h-screen flex-col items-center justify-center gap-[16px] p-8 text-center', className)}>
      <SparkMark size={96} mood="error" decorative />
      <div className="max-w-md">
        <p className="text-16 font-medium text-ink">{title}</p>
        {detail ? <p className="mt-1 text-14 text-ink-muted">{detail}</p> : null}
      </div>
    </div>
  );
}

/**
 * A button's label while its action runs: SPARK thinking, then the words.
 *
 *   <button disabled={saving}>{saving ? <Busy>Saving…</Busy> : 'Save'}</button>
 *
 * Every busy button in the app used to swap its label for a bare "Saving…",
 * which reads the same as a button that has frozen. The mark says something is
 * happening; the words say what. It takes the button's own text colour and
 * sizes itself to the label, so it fits a 30px pill and a 56px call to action
 * alike (`size` overrides).
 */
export function Busy({ children, size = 20, className }: { children: React.ReactNode; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center gap-[8px] align-middle', className)}>
      <SparkMark size={size} mood="thinking" decorative className="-my-[4px]" />
      <span>{children}</span>
    </span>
  );
}
