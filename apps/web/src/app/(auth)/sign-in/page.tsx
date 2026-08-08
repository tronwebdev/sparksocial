'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs';
import { SkyBackdrop, GlassCard } from '@/components/auth/GlassCard';
import { AuthField, MailIcon, LockIcon } from '@/components/auth/AuthField';
import { SocialRow, type OAuthStrategy } from '@/components/auth/SocialRow';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/Wordmark';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/** Login — `Auth.dc.html` state 4. Full-bleed cyan sky, 568px glass card. */
export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({ fields: {}, form: undefined });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setBusy(true);
    setErrors({ fields: {}, form: undefined });
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/');
      } else {
        // Multi-factor and other continuation states aren't wired in P0.
        setErrors({ fields: {}, form: 'This account needs an additional step that is not available yet.' });
      }
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
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

  return (
    <SkyBackdrop>
      <div className="mb-8 flex justify-center">
        <Wordmark markSize={45} fontSize={37.5} />
      </div>

      <GlassCard>
        <h1 className="text-center text-[26px] font-semibold leading-[1.4] text-ink-heading">Welcome back</h1>
        <p className="mt-2 text-center text-[16px] text-ink-muted">Sign in to pick up where SPARK left off.</p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-[14px]">
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
      </GlassCard>
    </SkyBackdrop>
  );
}
