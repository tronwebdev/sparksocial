'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs';
import { SkyBackdrop, GlassCard } from '@/components/auth/GlassCard';
import { AuthField, MailIcon, LockIcon } from '@/components/auth/AuthField';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/Wordmark';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/**
 * Forgot Password — `Auth.dc.html` state 5. Two steps on one route: request a
 * code, then set a new password with it.
 *
 * Kept on one route because Clerk's reset flow is a single `signIn` attempt
 * carried across both steps — routing between them would mean re-establishing
 * that attempt from scratch.
 */
export default function ForgotPasswordPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
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
        router.push('/');
      } else {
        setErrors({ fields: {}, form: 'Password reset needs an additional step that is not available yet.' });
      }
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SkyBackdrop>
      <div className="mb-8 flex justify-center">
        <Wordmark markSize={45} fontSize={37.5} />
      </div>

      <GlassCard>
        <h1 className="text-center text-[26px] font-semibold leading-[1.4] text-ink-heading">
          {step === 'request' ? 'Reset your password' : 'Choose a new password'}
        </h1>
        <p className="mt-2 text-center text-[16px] text-ink-muted">
          {step === 'request'
            ? "Enter your email and we'll send you a reset code."
            : 'Enter the code we emailed you, then pick a new password.'}
        </p>

        {step === 'request' ? (
          <form onSubmit={request} className="mt-8 flex flex-col gap-[14px]">
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
            {errors.form ? (
              <p role="alert" className="text-[14px] text-destructive">
                {errors.form}
              </p>
            ) : null}
            <Button type="submit" size="cta" className="mt-2 w-full" disabled={!isLoaded || busy}>
              {busy ? 'Sending…' : 'Send reset code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={reset} className="mt-8 flex flex-col gap-[14px]">
            <AuthField
              label="Reset code"
              placeholder="Enter code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={errors.fields.code}
            />
            <AuthField
              label="New password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              hint="Must be 8 characters"
              leadingIcon={<LockIcon />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.fields.password}
            />
            {errors.form ? (
              <p role="alert" className="text-[14px] text-destructive">
                {errors.form}
              </p>
            ) : null}
            <Button type="submit" size="cta" className="mt-2 w-full" disabled={!isLoaded || busy}>
              {busy ? 'Updating…' : 'Set new password'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-[16px] text-ink-muted">
          <Link href="/sign-in" className="text-brand-purple underline">
            Back to sign in
          </Link>
        </p>
      </GlassCard>
    </SkyBackdrop>
  );
}
