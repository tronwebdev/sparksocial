import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { CalendarBoard } from '@/components/calendar/CalendarBoard';

/**
 * `CAL-01` — the calendar, reviewed at mix level (§6.8 Step 4).
 *
 * Real data: `campaign.create` → `calendar.generate` → `calendar.get`, all
 * through the one tool proxy.
 */
export default function CalendarPage() {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} />
      <div className="p-8">
        <header className="mb-6">
          <h1 className="text-[20px] font-medium text-ink">Calendar</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            The balance is the thing to judge — not the individual posts.
          </p>
        </header>
        <CalendarBoard />
      </div>
    </>
  );
}
