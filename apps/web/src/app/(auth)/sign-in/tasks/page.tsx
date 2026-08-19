'use client';

import { TaskChooseOrganization } from '@clerk/nextjs';
import { SparkMark } from '@/components/brand/SparkMark';

/**
 * Clerk session task — choose or create an organization. DORMANT by design.
 *
 * Org creation is now `OrgGuard.tsx` (mounted in the `(app)`, `(onboarding)`
 * and `meet-spark` layouts), not this screen — see that file's own comment.
 * That required turning **off** the Clerk Dashboard's "Force organization
 * selection" setting; with it off, Clerk never issues the `choose-organization`
 * session task this page exists to satisfy, `layout.tsx`'s `ClerkProvider`
 * carries no `taskUrls` pointing here, and this route is simply never
 * navigated to.
 *
 * Not deleted, because the two are coupled the other way too: if that
 * Dashboard setting is ever switched back on, Clerk resumes issuing the task
 * immediately, and a session with no `taskUrls` entry for it prints "Session
 * has pending tasks but no handling is configured…" and does nothing —
 * sign-up dead-ends right after the account is created, the worst place to
 * fail. This page plus re-adding `taskUrls={{ 'choose-organization':
 * '/sign-in/tasks' }}` to `layout.tsx` is the fix, already written and ready.
 */
export default function ChooseOrganizationPage() {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6">
      <div className="flex flex-col items-center">
        <SparkMark variant="card" />
        <h1 className="mt-8 text-center text-[26px] font-semibold text-foreground">
          Name your workspace
        </h1>
        <p className="mt-2 max-w-[420px] text-center text-[16px] text-ink-muted">
          Everything SPARK makes lives inside a workspace. You can add brands to it later.
        </p>
      </div>

      <TaskChooseOrganization
        redirectUrlComplete="/meet-spark"
        appearance={{
          variables: {
            colorBackground: '#141414',
            colorPrimary: '#A341FF',
            colorText: '#FFFFFF',
            colorTextSecondary: 'rgba(255,255,255,0.62)',
            colorInputBackground: '#1E1E1E',
            colorInputText: '#FFFFFF',
            borderRadius: '10px',
          },
          elements: {
            // The page already states the heading above; Clerk's own card
            // header would repeat it.
            cardBox: { boxShadow: 'none', border: '1px solid rgba(255,255,255,0.12)' },
            header: { display: 'none' },
          },
        }}
      />
    </div>
  );
}
