import { OrgGuard } from '@/components/auth/OrgGuard';

/**
 * Onboarding sits outside `(app)` — no `AppShell`.
 *
 * The prototype draws it full-bleed with its own Back control, and the reason
 * is more than visual: the sidebar links to Calendar, Assets and Discovery,
 * every one of which needs a genome that does not exist yet. Rendering the
 * shell around this flow would surround a first-run user with seven ways to
 * reach a screen that can only tell them nothing is set up.
 *
 * `OrgGuard` still applies. Both tool calls here are org-scoped, so a session
 * without an active organisation would fail them exactly as it fails the rest
 * of the app.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <OrgGuard>{children}</OrgGuard>;
}
