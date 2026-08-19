'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useSignIn } from '@clerk/nextjs';
import { SkyBackdrop, GlassCard } from '@/components/auth/GlassCard';
import { AuthField, MailIcon, LockIcon } from '@/components/auth/AuthField';
import { SocialRow, type OAuthStrategy } from '@/components/auth/SocialRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wordmark } from '@/components/brand/Wordmark';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/**
 * Login — `Auth.dc.html` state 4. Full-bleed cyan sky, 568px glass card.
 *
 * ── The additional-factor states, not just password ────────────────────────
 *
 * `signIn.create({identifier, password})` does not always resolve straight to
 * `complete`. This used to treat every other outcome identically — one message,
 * "needs an additional step that is not available yet" — which is how a
 * *correct* password on a real account produced what reads as a broken login.
 *
 * The two states worth handling are the ones this app can actually satisfy
 * without collecting a phone number, which nothing here does:
 *
 * - `needs_first_factor` with an `email_code` factor available — the instance
 *   wants a code alongside the password. Same primitive as sign-up's verify
 *   step, just returned from a different Clerk resource.
 * - `needs_second_factor` — MFA is on for the account. `totp` needs no
 *   "prepare" call (an authenticator app is already generating codes); a second
 *   factor sent by email does.
 *
 * Anything else (`needs_new_password`, a phone-based factor, `needs_identifier`
 * reappearing) still falls through to the honest fallback — naming what Clerk
 * is actually asking for is what changed, not pretending every case is covered.
 *
 * ── The already-signed-in guard ─────────────────────────────────────────────
 * A session-claims propagation race can land an *already-authenticated*
 * browser here — most concretely, right after `TaskChooseOrganization`
 * (`sign-in/tasks/page.tsx`) finishes and hard-navigates to
 * `redirectUrlComplete`: if the updated session cookie hasn't fully
 * propagated to that request yet, `middleware.ts`'s `auth.protect()` can
 * momentarily treat the visitor as unauthenticated and redirect to `/sign-in`
 * proper, not back to the task page. Without this guard, that user sees a
 * blank login form, and `signIn.create()` throws Clerk's own "already signed
 * in" error the instant they submit it — which reads as the app being
 * broken rather than a session that resolves itself if you just wait a beat.
 */

type Step =
  | { kind: 'password' }
  | { kind: 'first_factor_code'; emailAddressId: string; safeIdentifier: string }
  | { kind: 'second_factor_totp' }
  | { kind: 'second_factor_code'; safeIdentifier: string };

export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoaded && isSignedIn) router.replace('/');
  }, [authLoaded, isSignedIn, router]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [errors, setErrors] = useState<FieldErrors>({ fields: {}, form: undefined });
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function complete(result: { status: string | null; createdSessionId: string | null }) {
    if (result.status === 'complete' && result.createdSessionId && setActive) {
      await setActive({ session: result.createdSessionId });
      router.push('/');
      return true;
    }
    return false;
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const result = await signIn.create({ identifier: email, password });
      if (await complete(result)) return;

      if (result.status === 'needs_first_factor') {
        const emailFactor = result.supportedFirstFactors?.find(
          (f): f is Extract<typeof f, { strategy: 'email_code' }> => f.strategy === 'email_code',
        );
        if (emailFactor) {
          await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: emailFactor.emailAddressId });
          setStep({ kind: 'first_factor_code', emailAddressId: emailFactor.emailAddressId, safeIdentifier: emailFactor.safeIdentifier });
          return;
        }
      }

      if (result.status === 'needs_second_factor') {
        const totp = result.supportedSecondFactors?.find((f) => f.strategy === 'totp');
        if (totp) {
          setStep({ kind: 'second_factor_totp' });
          return;
        }
        const emailFactor = result.supportedSecondFactors?.find(
          (f): f is Extract<typeof f, { strategy: 'email_code' }> => f.strategy === 'email_code',
        );
        if (emailFactor) {
          await signIn.prepareSecondFactor({ strategy: 'email_code' });
          setStep({ kind: 'second_factor_code', safeIdentifier: emailFactor.safeIdentifier });
          return;
        }
      }

      // A genuinely unhandled state — name it rather than pretend it's covered.
      setErrors({
        fields: {},
        form: `This account needs an additional step this app doesn't support yet (${result.status}). Contact support.`,
      });
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy || step.kind === 'password') return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const result =
        step.kind === 'first_factor_code'
          ? await signIn.attemptFirstFactor({ strategy: 'email_code', code })
          : step.kind === 'second_factor_totp'
            ? await signIn.attemptSecondFactor({ strategy: 'totp', code })
            : await signIn.attemptSecondFactor({ strategy: 'email_code', code });

      if (await complete(result)) return;
      setErrors({ fields: {}, form: `Still not signed in (status: ${result.status}). Check the code and try again.` });
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!isLoaded || step.kind === 'password' || step.kind === 'second_factor_totp') return;
    try {
      if (step.kind === 'first_factor_code') {
        await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: step.emailAddressId });
      } else {
        await signIn.prepareSecondFactor({ strategy: 'email_code' });
      }
      setResent(true);
    } catch (err) {
      setErrors(toFieldErrors(err));
    }
  }

  async function social(strategy: OAuthStrategy) {
    if (!isLoaded) return;
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/',
      });
    } catch (err) {
      setErrors(toFieldErrors(err));
    }
  }

  const codeStep = step.kind !== 'password';

  return (
    <SkyBackdrop>
      <div className="mb-8 flex justify-center">
        <Wordmark markSize={45} fontSize={37.5} />
      </div>

      <GlassCard>
        {!codeStep ? (
          <>
            <h1 className="text-center text-[26px] font-semibold leading-[1.4] text-ink-heading">Welcome back</h1>
            <p className="mt-2 text-center text-[16px] text-ink-muted">Sign in to pick up where SPARK left off.</p>

            <form onSubmit={submitPassword} className="mt-8 flex flex-col gap-[14px]">
              <AuthField
                label="Email"
                type="email"
                placeholder="youremail@website.com"
                autoComplete="email"
                leadingIcon={<MailIcon />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.fields.identifier ?? errors.fields.email_address}
              />
              <AuthField
                label="Password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                leadingIcon={<LockIcon />}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.fields.password}
              />

              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-[15px] text-brand-purple underline">
                  Forgot password?
                </Link>
              </div>

              {errors.form ? (
                <p role="alert" className="text-[14px] text-destructive">
                  {errors.form}
                </p>
              ) : null}

              <Button type="submit" size="cta" className="mt-2 w-full" disabled={!isLoaded || busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <SocialRow className="mt-6" onSelect={social} disabled={!isLoaded || busy} />

            <p className="mt-6 text-center text-[16px] text-ink-muted">
              New here?{' '}
              <Link href="/sign-up" className="text-brand-purple underline">
                Create an account
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-center text-[26px] font-semibold leading-[1.4] text-ink-heading">
              {step.kind === 'second_factor_totp' ? 'Enter your authenticator code' : 'Enter the code we sent'}
            </h1>
            <p className="mt-2 text-center text-[16px] text-ink-muted">
              {step.kind === 'second_factor_totp'
                ? 'Open your authenticator app for the current 6-digit code.'
                : `Sent to ${step.kind === 'first_factor_code' || step.kind === 'second_factor_code' ? step.safeIdentifier : ''}.`}
            </p>

            <form onSubmit={submitCode} className="mt-8 flex flex-col gap-[14px]">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter code"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Verification code"
                invalid={Boolean(errors.form)}
                className="text-center"
                autoFocus
              />
              {errors.form ? (
                <p role="alert" className="text-center text-[14px] text-destructive">
                  {errors.form}
                </p>
              ) : null}

              <Button type="submit" size="cta" className="mt-2 w-full" disabled={!isLoaded || busy || !code}>
                {busy ? 'Verifying…' : 'Continue'}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-6 text-[15px]">
              {step.kind !== 'second_factor_totp' ? (
                <button type="button" onClick={resend} className="text-brand-purple underline" disabled={!isLoaded}>
                  {resent ? 'Code resent' : 'Resend'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setStep({ kind: 'password' });
                  setCode('');
                  setErrors({ fields: {}, form: undefined });
                }}
                className="text-ink-muted underline"
              >
                Back
              </button>
            </div>
          </>
        )}
      </GlassCard>
    </SkyBackdrop>
  );
}
