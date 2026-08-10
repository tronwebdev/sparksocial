'use client';

import { TaskChooseOrganization } from '@clerk/nextjs';
import { SparkMark } from '@/components/brand/SparkMark';

/**
 * Clerk session task — choose or create an organization.
 *
 * The instance has `force_organization_selection: true`, so Clerk parks a
 * freshly signed-up session at `<signInUrl>/tasks` until it has an active
 * organization. Without this route that redirect 404s and sign-up dead-ends
 * *after* the account was successfully created — the worst place to fail.
 *
 * Keeping the setting on is deliberate rather than convenient. Every genome,
 * asset and `tool_calls` row is keyed by org, and `apps/api/src/clerk-auth.ts`
 * rejects a session without one — so an org-less session cannot make a single
 * tool call. Letting Clerk guarantee the org before the app loads is stronger
 * than our `useEnsureOrg` stopgap, which only runs if the user happens to pass
 * through `/meet-spark`: deep-linking to `/calendar` on a fresh account would
 * otherwise reach a shell where every request 403s.
 *
 * Themed rather than left default, because this sits between two custom
 * full-bleed dark screens and Clerk's stock light card in the middle of that
 * sequence reads as a different product.
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
