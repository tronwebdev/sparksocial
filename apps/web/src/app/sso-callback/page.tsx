'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

/** Where Clerk lands after an OAuth round-trip. Renders nothing but the handoff. */
export default function SSOCallbackPage() {
  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background">
      <p className="text-[16px] text-ink-muted">Signing you in…</p>
      <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/meet-spark" />
    </div>
  );
}
