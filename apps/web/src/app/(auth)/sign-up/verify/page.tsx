'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSignUp } from '@clerk/nextjs';
import { SparkMark } from '@/components/brand/SparkMark';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/**
 * Verify Email — `Auth.dc.html` state 2. Full-bleed `#0C0C0C`, centred code entry.
 *
 * Dark surface, so this subtree sets `.dark` and reads the same semantic tokens
 * as everything else rather than hardcoding white text.
 */
export default function VerifyPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({ fields: {}, form: undefined });
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/meet-spark');
      } else {
        setErrors({ fields: {}, form: 'That code did not complete sign-up. Try again.' });
      }
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!isLoaded) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setResent(true);
    } catch (err) {
      setErrors(toFieldErrors(err));
    }
  }

  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <SparkMark variant="card" />
      <h1 className="mt-8 text-center text-[26px] font-semibold text-foreground">Check your email</h1>
      <p className="mt-2 max-w-[420px] text-center text-[16px] text-ink-muted">
        We sent a code to your inbox. Enter it below to finish setting up your account.
      </p>

      <form onSubmit={submit} className="mt-8 flex w-[380px] max-w-full flex-col gap-4">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter code"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Verification code"
          invalid={Boolean(errors.form || errors.fields.code)}
          className="text-center"
        />
        {errors.form || errors.fields.code ? (
          <p role="alert" className="text-center text-[14px] text-destructive">
            {errors.form ?? errors.fields.code}
          </p>
        ) : null}

        <Button type="submit" size="cta" disabled={!isLoaded || busy || !code}>
          {busy ? 'Verifying…' : 'Verify'}
        </Button>
      </form>

      <div className="mt-6 flex items-center gap-6 text-[15px]">
        <button type="button" onClick={resend} className="text-brand-cyan underline" disabled={!isLoaded}>
          {resent ? 'Code resent' : 'Resend'}
        </button>
        <button type="button" onClick={() => router.push('/sign-up')} className="text-ink-muted underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
