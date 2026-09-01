'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useSignUp } from '@clerk/nextjs';
import { AuthBackdrop, AuthPanel, AuthHeader, SuccessBadge, OtpInput } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/**
 * Verify Email — `Auth.dc.html` state 2. Full-bleed `#0C0C0C`, centred code entry.
 *
 * Dark surface, so this subtree sets `.dark` and reads the same semantic tokens
 * as everything else rather than hardcoding white text.
 *
 * ── The already-signed-in guard ─────────────────────────────────────────────
 * Same fix as `sign-in/page.tsx` and `sign-up/page.tsx`, and the same real
 * incident that motivated it: a successful `attemptEmailAddressVerification`
 * completes the session and navigates to `/meet-spark` — but a refresh (or a
 * back-navigation) that lands the browser back on this page *after* that
 * already happened calls `attemptEmailAddressVerification` again on a session
 * with nothing left to verify, and Clerk throws "already signed in" instead of
 * quietly doing nothing. Without this guard that reads as the first code
 * having failed, when it had already worked.
 */
export default function VerifyPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoaded && isSignedIn) router.replace('/meet-spark');
  }, [authLoaded, isSignedIn, router]);

  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({ fields: {}, form: undefined });
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  /**
   * `AUTH-03`'s resend cooldown, which PRD §8.1 asks for ("OTP verification with
   * resend throttling") and which was drawn in the prototype as a live
   * `Cooldown: 96s`.
   *
   * This is a *client-side* timer over a *server-side* rule. Clerk throttles
   * resends itself and will refuse one regardless of what this component thinks —
   * so the honest description is that the timer makes an existing limit visible,
   * not that it enforces one. Without it the button looks broken: you press it, a
   * silent refusal comes back, and nothing tells you to wait.
   */
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1_000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        // `Screenshot …192654` puts a confirmation between verifying and the
        // splash, rather than jumping straight to /meet-spark.
        setDone(true);
        return;
      }

      /**
       * The code was accepted — `attemptEmailAddressVerification` would have
       * thrown otherwise. `status` is `missing_requirements`, meaning the Clerk
       * instance wants a field the sign-up form never collected (a required
       * phone number is the usual one).
       *
       * This previously said "That code did not complete sign-up. Try again."
       * which is both wrong and harmful: the code *had* worked, so retrying it
       * hit "this verification has already been verified" and stranded the user
       * with no way forward. Name the actual missing field instead.
       */
      const missing = result.missingFields ?? [];
      setErrors({
        fields: {},
        form: missing.length
          ? `Your email is verified, but this Clerk instance also requires: ${missing
              .map(readableField)
              .join(', ')}. Turn those off in Clerk → User & Authentication, or add them to the sign-up form.`
          : `Your email is verified, but sign-up is still incomplete (status: ${result.status}).`,
      });
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  /** `phone_number` → "phone number". Clerk returns snake_case field ids. */
  function readableField(field: string): string {
    return field.replace(/_/g, ' ');
  }

  async function resend() {
    if (!isLoaded) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setResent(true);
      /**
       * Sixty seconds, started only on a *successful* resend. Starting it before
       * the call would leave somebody waiting out a cooldown for a code that was
       * never sent — which is the same failure the timer exists to prevent, in
       * the other direction.
       */
      setCooldown(60);
    } catch (err) {
      setErrors(toFieldErrors(err));
    }
  }

  if (done) {
    return (
      <AuthBackdrop tone="dark">
        <AuthPanel tone="dark" glow className="text-center">
          <AuthHeader tone="dark" title={<>Confirmation<br />Successful</>} />
          <div className="mt-6 flex justify-center">
            <SuccessBadge />
          </div>
          <Button
            size="cta"
            variant="secondary"
            className="mt-6 w-full border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]"
            onClick={() => router.push('/meet-spark')}
          >
            Continue
          </Button>
        </AuthPanel>
      </AuthBackdrop>
    );
  }

  return (
    <AuthBackdrop tone="dark">
      <AuthPanel tone="dark">
        <AuthHeader
          tone="dark"
          title="Enter verification code"
          subtitle={
            <>
              we sent a code to <span className="text-white">{signUp?.emailAddress ?? 'your inbox'}</span>
            </>
          }
        />

        <form onSubmit={submit} className="mt-7 flex flex-col">
          <OtpInput value={code} onChange={setCode} tone="dark" disabled={!isLoaded || busy} />

          {errors.form || errors.fields.code ? (
            <p role="alert" className="mt-3 text-center text-14 text-destructive">
              {errors.form ?? errors.fields.code}
            </p>
          ) : null}

          <div className="mt-[26px] flex items-center justify-between text-14">
            <span className="text-ink-muted">
              Didn&apos;t get the code?{' '}
              <button
                type="button"
                onClick={resend}
                className="text-white/80 underline disabled:no-underline disabled:opacity-50"
                disabled={!isLoaded || cooldown > 0}
              >
                {resent && cooldown === 0 ? 'Code resent' : 'Resend'}
              </button>
            </span>
            {/* The design shows a cooldown readout, so keep the slot occupied
                rather than letting the row reflow when the timer starts. */}
            <span className="text-ink-muted">Cooldown: {cooldown > 0 ? `${cooldown}s` : '—'}</span>
          </div>

          {/*
            The gradient-outlined button from the capture. A gradient *border*
            needs two layers — `padding-box` for the fill, `border-box` for the
            stroke — because `border-image` cannot follow a border radius.
          */}
          <Button
            type="submit"
            size="cta"
            className="mt-[26px] w-full border border-transparent bg-white/[0.04] text-white hover:bg-white/[0.08]"
            style={{
              backgroundImage:
                'linear-gradient(var(--ss-ink-900), var(--ss-ink-900)), var(--ss-grad-brand)',
              backgroundOrigin: 'padding-box, border-box',
              backgroundClip: 'padding-box, border-box',
            }}
            disabled={!isLoaded || busy || code.length < 6}
          >
            {busy ? 'Verifying…' : 'Verify Account'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => router.push('/sign-up')}
          className="mt-[22px] block w-full text-center text-16 text-ink-muted transition-colors hover:text-white"
        >
          Cancel
        </button>
      </AuthPanel>
    </AuthBackdrop>
  );
}
