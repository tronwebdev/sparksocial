'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useSignIn } from '@clerk/nextjs';
import { AuthBackdrop, AuthPanel, AuthHeader, SuccessBadge } from '@/components/auth/AuthShell';
import { AuthField, MailIcon, LockIcon } from '@/components/auth/AuthField';
import { Button } from '@/components/ui/button';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/**
 * Forgot Password — `Auth.dc.html` state 5. Two steps on one route: request a
 * code, then set a new password with it.
 *
 * Kept on one route because Clerk's reset flow is a single `signIn` attempt
 * carried across both steps — routing between them would mean re-establishing
 * that attempt from scratch.
 *
 * Same already-signed-in guard as `sign-in/page.tsx` — `signIn.create()`
 * throws "already signed in" for an authenticated session, same as it does
 * there.
 */
export default function ForgotPasswordPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoaded && isSignedIn) router.replace('/');
  }, [authLoaded, isSignedIn, router]);

  const [step, setStep] = useState<'request' | 'reset' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({ fields: {}, form: undefined });
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email });
      setStep('reset');
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password,
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        // The design ends this flow on a confirmation screen rather than
        // dropping the user straight into the app.
        setStep('done');
      } else {
        setErrors({ fields: {}, form: 'Password reset needs an additional step that is not available yet.' });
      }
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <AuthBackdrop tone="light">
        <AuthPanel tone="light" glow className="text-center">
          <AuthHeader title={<>Confirmation<br />Successful</>} />
          <div className="mt-6 flex justify-center">
            <SuccessBadge />
          </div>
          <Button size="cta" className="mt-6 w-full" onClick={() => router.push('/')}>
            Continue
          </Button>
        </AuthPanel>
      </AuthBackdrop>
    );
  }

  return (
    <AuthBackdrop tone="light">
      <AuthPanel tone="light">
        <AuthHeader
          title="Reset password"
          subtitle={step === 'request' ? 'Enter your email to reset your password' : 'Enter your new password'}
        />

        {step === 'request' ? (
          <form onSubmit={request} className="mt-[45px] flex flex-col gap-[28px]">
            <AuthField
              fieldSize="auth"
              label="Email"
              type="email"
              placeholder="youremail@website.com"
              autoComplete="email"
              leadingIcon={<MailIcon />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.fields.identifier ?? errors.fields.email_address}
            />
            {errors.form ? (
              <p role="alert" className="text-14 text-destructive">
                {errors.form}
              </p>
            ) : null}
            <Button type="submit" size="cta" className="w-full" disabled={!isLoaded || busy}>
              {busy ? 'Sending…' : 'Reset password'}
            </Button>
          </form>
        ) : (
          <form onSubmit={reset} className="mt-[45px] flex flex-col gap-[28px]">
            {/*
              NOT in the design, and kept anyway.

              `Screenshot …192539` shows only New password and Confirm password.
              But Clerk completes a reset with `attemptFirstFactor({ code, password })`
              — there is no variant that omits the emailed code, and the light reset
              flow has no other screen to collect it on. Dropping the field to match
              the capture would render this screen unable to reset a password.

              Flagged in `ui build/MANIFEST.md`; remove it the moment the design says
              where the code goes.
            */}
            <AuthField
              fieldSize="auth"
              label="Reset code"
              placeholder="Enter the code we emailed you"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={errors.fields.code}
            />
            <AuthField
              fieldSize="auth"
              label="New password"
              type="password"
              placeholder="Enter password"
              autoComplete="new-password"
              hint={<span className="text-brand-pink">Must be 8 characters</span>}
              leadingIcon={<LockIcon />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.fields.password}
            />
            <AuthField
              fieldSize="auth"
              label="Confirm password"
              type="password"
              placeholder="Enter password"
              autoComplete="new-password"
              leadingIcon={<LockIcon />}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={confirm && confirm !== password ? 'These do not match.' : undefined}
            />
            {errors.form ? (
              <p role="alert" className="text-14 text-destructive">
                {errors.form}
              </p>
            ) : null}
            <Button
              type="submit"
              size="cta"
              className="w-full"
              disabled={!isLoaded || busy || !password || confirm !== password}
            >
              {busy ? 'Updating…' : 'Reset password'}
            </Button>
          </form>
        )}

        <Link
          href="/sign-in"
          className="mt-[22px] block text-center text-16 text-ink-muted transition-colors hover:text-ink"
        >
          Cancel
        </Link>

        {step === 'request' ? (
          <div className="mt-[38px] flex items-center justify-between text-14">
            <span className="text-ink-muted">Don&apos;t have access anymore?</span>
            <a href="mailto:support@sparksocial.ai" className="text-ink underline">
              Contact support
            </a>
          </div>
        ) : null}
      </AuthPanel>
    </AuthBackdrop>
  );
}
