import { AppProviders } from '../AppProviders';

/**
 * Sign-in and sign-up are Clerk's own screens, so this branch needs the
 * provider as much as the product does — see `AppProviders.tsx`.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <div className="min-h-screen">{children}</div>
    </AppProviders>
  );
}
