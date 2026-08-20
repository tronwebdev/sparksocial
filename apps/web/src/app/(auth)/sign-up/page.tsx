'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useSignUp } from '@clerk/nextjs';
import { BrandPanel } from '@/components/auth/BrandPanel';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthField, PersonIcon, MailIcon, LockIcon } from '@/components/auth/AuthField';
import { SocialRow, type OAuthStrategy } from '@/components/auth/SocialRow';
import { Button } from '@/components/ui/button';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';
import { rememberSelectedPlan } from '@/lib/selectedPlan';

/**
 * Sign Up — `Auth.dc.html` state 1. Split screen: dark brand panel, white card.
 *
 * Headless Clerk (`useSignUp`) rather than `<SignUp/>`, so the card is ours and
 * the flow is explicit: create → send email code → `/sign-up/verify`.
 *
 * Guards against an already-signed-in visitor the same way `sign-in/page.tsx`
 * does — see that file's comment for the session-propagation race this
 * protects against. `signUp.create()` errors immediately for an active
 * session, same failure mode as `signIn.create()`.
 */
export default function SignUpPage() {
  const { isLoaded, signUp } = useSignUp();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  /**
   * `AUTH-01`'s selected plan, arriving as `?plan=` from `/pricing`.
   *
   * Stashed rather than used here: there is no org to apply a plan to until
   * `OrgGuard` creates one, several navigations later — see `selectedPlan.ts` on
   * why a query parameter cannot make that trip, and on why this reads the URL
   * directly instead of through `useSearchParams()`.
   */
  useEffect(() => {
    rememberSelectedPlan();
  }, []);

  useEffect(() => {
    if (authLoaded && isSignedIn) router.replace('/');
  }, [authLoaded, isSignedIn, router]);

  const [name, setName] = useState('');
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
      const [firstName, ...rest] = name.trim().split(/\s+/);
      await signUp.create({
        emailAddress: email,
        password,
        ...(firstName ? { firstName } : {}),
        ...(rest.length ? { lastName: rest.join(' ') } : {}),
      });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      router.push('/sign-up/verify');
    } catch (err) {
      setErrors(toFieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  async function social(strategy: OAuthStrategy) {
    if (!isLoaded) return;
    try {
      await signUp.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/meet-spark',
      });
    } catch (err) {
      setErrors(toFieldErrors(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-row bg-[#F5F5F5]">
      <BrandPanel />
      <div className="flex flex-1 flex-col items-center justify-center gap-[22px] px-6 py-[53px]">
        <AuthCard title="Register to continue" subtitle="Join us today and unlock exclusive features!">
          <form onSubmit={submit} className="flex flex-col gap-[14px]">
            <AuthField
              label="Full name"
              placeholder="Enter name"
              autoComplete="name"
              leadingIcon={<PersonIcon />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.fields.first_name}
            />
            <AuthField
              label="Email"
              type="email"
              placeholder="youremail@website.com"
              autoComplete="email"
              leadingIcon={<MailIcon />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.fields.email_address}
            />
            <AuthField
              label="Create password"
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

            {/* Clerk's bot-protection widget mounts here when enabled. */}
            <div id="clerk-captcha" />

            <Button type="submit" size="cta" className="mt-2 w-full" disabled={!isLoaded || busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <SocialRow className="mt-6" onSelect={social} disabled={!isLoaded || busy} />

          <p className="mt-6 text-center text-[16px] text-ink-muted">
            Already have an account?{' '}
            <Link href="/sign-in" className="text-brand-purple underline">
              Sign in
            </Link>
          </p>
        </AuthCard>
      </div>
    </div>
  );
}
