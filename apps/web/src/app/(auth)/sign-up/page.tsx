'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useSignUp } from '@clerk/nextjs';
import { BrandPanel } from '@/components/auth/BrandPanel';
import { AuthPanel, AuthHeader } from '@/components/auth/AuthShell';
import { AuthField, PersonIcon, MailIcon, LockIcon, RevealToggle } from '@/components/auth/AuthField';
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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        /**
         * Recorded where the only per-person store this app has lives. There is
         * no user table — every tool treats `ctx.userId` as an opaque string — so
         * this is not queryable from the backend and not auditable through
         * `tool_calls`. Stated so nobody later assumes it is provable server-side.
         */
        unsafeMetadata: { termsAcceptedAt: new Date().toISOString() },
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
    <div className="flex min-h-screen flex-row bg-[--ss-surface-200]">
      <BrandPanel />

      {/*
        Card top sits 34.5px from the frame top in `signup.png`, not centred —
        the column is top-weighted, so `justify-start` with that padding rather
        than `justify-center`, which would drop it ~55px lower.
      */}
      <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 pb-10 pt-[34px]">
        <AuthPanel tone="light" className="pb-[28px]">
          <AuthHeader title="Register to continue" subtitle="Join us today and unlock exclusive features!" />

          <form onSubmit={submit} className="mt-[27px] flex flex-col gap-4">
            <AuthField
              fieldSize="auth"
              label="Full name"
              placeholder="Enter name"
              autoComplete="name"
              leadingIcon={<PersonIcon />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.fields.first_name}
            />
            <AuthField
              fieldSize="auth"
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
              fieldSize="auth"
              label="Create password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter password"
              autoComplete="new-password"
              hint={<span className="text-brand-pink">Must be 8 characters</span>}
              leadingIcon={<LockIcon />}
              trailingSlot={
                <span className="flex items-center gap-2">
                  {/* The strength bar the capture shows inside the field. */}
                  <span className="h-[6px] w-[46px] overflow-hidden rounded-full bg-border" aria-hidden>
                    <span
                      className="block h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (password.length / 8) * 100)}%`,
                        background: password.length >= 8 ? 'var(--ss-success)' : 'var(--ss-danger)',
                      }}
                    />
                  </span>
                  <RevealToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                </span>
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.fields.password}
            />

            {errors.form ? (
              <p role="alert" className="text-14 text-destructive">
                {errors.form}
              </p>
            ) : null}

            {/*
              `AUTH-02`'s terms checkbox, which PRD §8.1 lists as a functional
              requirement ("email/password signup with terms acceptance").

              Acceptance is recorded on the Clerk user as `unsafeMetadata`, which
              is the only per-person store this app has — there is no user table,
              and every tool treats `ctx.userId` as an opaque string. That is a
              real limitation rather than a shortcut: it means acceptance cannot
              be queried from the backend or audited through `tool_calls`.

              Gating the button rather than validating on submit, because the
              requirement is consent — and a consent control that lets you
              proceed and then complains has already failed at being consent.
              (Login's identical-looking checkbox does NOT gate: a returning user
              is not re-consenting, and blocking them would lock them out.)
            */}
            <label className="-mt-[9px] flex cursor-pointer select-none items-center gap-2 text-14 text-ink-muted" htmlFor="signup-terms">
              <input
                id="signup-terms"
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="h-[15px] w-[15px] shrink-0 cursor-pointer rounded-[4px] border border-border accent-[--ss-primary]"
              />
              <span>
                I agree to{' '}
                <Link href="/pricing" className="font-medium text-ink underline">
                  terms
                </Link>{' '}
                &amp;{' '}
                <Link href="/pricing" className="font-medium text-ink underline">
                  privacy
                </Link>
                .
              </span>
            </label>

            {/* Clerk's bot-protection widget mounts here when enabled. */}
            <div id="clerk-captcha" />

            <Button type="submit" size="cta" className="mt-1 w-full" disabled={!isLoaded || busy || !acceptedTerms}>
              {busy ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </AuthPanel>

        {/*
          Provider row and the sign-in line sit on the ground BELOW the card, as
          on Login — divider at +22 from the card's bottom edge, buttons at +53.
        */}
        <div className="w-auth-card max-w-full pt-[22px]">
          <SocialRow onSelect={social} disabled={!isLoaded || busy} />
          <p className="mt-[30px] text-center text-14 text-ink-muted">
            Already have an account?{' '}
            <Link href="/sign-in" className="text-brand-purple underline">
              Sign in Now
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
