'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useSignIn } from '@clerk/nextjs';
import { AuthBackdrop, AuthPanel, AuthHeader, SuccessBadge, SuccessMark } from '@/components/auth/AuthShell';
import { AuthField, MailIcon, LockIcon } from '@/components/auth/AuthField';
import { Button } from '@/components/ui/button';
import { toFieldErrors, type FieldErrors } from '@/lib/clerk-errors';

/**
 * Forgot Password — `SparkSocial Auth.dc.html`, state `forgot`.
 *
 * ── Why the code field is gone ────────────────────────────────────────────
 *
 * The prototype's step 1 says "Enter your email and we'll send you a reset
 * **link**", and its step 2 asks for `Enter password` and `Confirm password` and
 * nothing else. I had a third field on step 2 for the emailed code, with a
 * comment arguing that Clerk cannot complete a reset without one.
 *
 * That much is true — `attemptFirstFactor({ strategy: 'reset_password_email_-
 * code', code, password })` is the only completion path, and there is no variant
 * that omits `code`. What was wrong was the conclusion. A code that has to
 * *reach* the browser does not have to be *typed into* it: the reset email can
 * carry it in the link, and this page reads it from the query string. Same
 * strategy, same call, one fewer thing asked of somebody who has just been
 * locked out.
 *
 * ── This needs one Clerk dashboard change to work ─────────────────────────
 *
 * Clerk's stock "Reset password code" email prints a bare 6-digit code. For the
 * link flow the template has to link here with the code on it:
 *
 *   {{app.url}}/forgot-password?code={{otp_code}}&email={{user.primary_email_address}}
 *
 * Until that template is edited, the email still arrives with a code in it and
 * there is no field to put it in — so `RESET_LINK_TEMPLATE_READY` below is the
 * switch, and while it is false the page says plainly what is missing instead of
 * silently failing. `email` rides along because a link opened in a different
 * browser than the request has no `signIn` attempt to attach to; with it, the
 * attempt is simply re-created before the reset.
 *
 * Same already-signed-in guard as `sign-in/page.tsx` — `signIn.create()` throws
 * "already signed in" for an authenticated session, same as it does there.
 */

/**
 * Whether the Clerk email template has been pointed at this page. Set
 * `NEXT_PUBLIC_RESET_LINK_READY=1` once the template above is saved.
 *
 * A boolean rather than silence: the failure it guards is a person unable to get
 * back into their account, and that must not be discoverable only by trying.
 */
const RESET_LINK_TEMPLATE_READY = process.env.NEXT_PUBLIC_RESET_LINK_READY === '1';
/**
 * The Suspense boundary `next build` requires, and why it is a boundary rather
 * than the effect trick used elsewhere.
 *
 * `useSearchParams()` opts a page out of static prerendering unless something
 * above it can suspend — without this, `next build` fails outright on
 * *"useSearchParams() should be wrapped in a suspense boundary"* and the whole
 * export exits non-zero. `selectedPlan.ts` hit the same wall on sign-up and
 * solved it by reading `window.location` in an effect instead.
 *
 * That solution does not fit here. This page is reached from an emailed link
 * carrying `?code=&email=`, and those values pick the **initial** state — which
 * step renders, and what the email field starts as. Read in an effect they
 * arrive one render late, so a user following a reset link would see the "enter
 * your email" step flash before being swapped to the password form. A boundary
 * keeps the params synchronous on first client render, so there is no flash.
 *
 * The fallback is the page's own shell rather than a spinner: it occupies the
 * same space, so resolving the boundary does not move the layout.
 */
export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthBackdrop tone="light">
          <AuthPanel tone="light">
            <AuthHeader title="Reset password" subtitle="One moment…" />
          </AuthPanel>
        </AuthBackdrop>
      }
    >
      <ForgotPasswordFlow />
    </Suspense>
  );
}

function ForgotPasswordFlow() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoaded && isSignedIn) router.replace('/');
  }, [authLoaded, isSignedIn, router]);

  /*
    A link lands here with `?code=&email=`, which is the whole reason step 2 can
    ask for passwords alone. Read once into state rather than off the params on
    every render, so a re-render mid-submit cannot change what is being sent.
  */
  const params = useSearchParams();
  const linkCode = params.get('code') ?? '';
  const linkEmail = params.get('email') ?? '';

  const [step, setStep] = useState<'request' | 'sent' | 'reset' | 'done'>(
    linkCode ? 'reset' : 'request',
  );
  const [email, setEmail] = useState(linkEmail);
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
      /*
        `sent`, not `reset`. The password form is reached by the emailed link,
        because that link is what carries the code - dropping the user onto the
        password fields here would give them a form they cannot submit.
      */
      setStep('sent');
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
      /*
        A link opened in a different browser from the one that asked for the
        reset has no `signIn` attempt to attach to, and `attemptFirstFactor`
        would throw. Re-creating it is free when one already exists in this
        browser, so it is unconditional rather than guarded by a status check
        that would have to guess at Clerk's internal state.
      */
      if (email) {
        try {
          await signIn.create({ strategy: 'reset_password_email_code', identifier: email });
        } catch {
          // Already established in this browser - the attempt below uses it.
        }
      }

      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: linkCode,
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
          <AuthHeader mark={<SuccessMark />} title={<>Confirmation<br />Successful</>} />
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
          subtitle={
            step === 'request'
              ? // The prototype's own words, and now literally true.
                "Enter your email and we'll send you a reset link"
              : step === 'sent'
                ? 'Check your email for the reset link'
                : 'Enter your new password'
          }
        />

        {step === 'request' ? (
          <form onSubmit={request} className="mt-[26px] flex flex-col gap-4">
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
            {!RESET_LINK_TEMPLATE_READY ? (
              <p className="text-14 text-ink-muted">
                The reset email still needs its Clerk template pointed at this page before the link
                will work — see the note at the top of this file.
              </p>
            ) : null}
            <Button type="submit" size="cta" className="mt-2 w-full" disabled={!isLoaded || busy}>
              {busy ? 'Sending…' : 'Reset password'}
            </Button>
          </form>
        ) : step === 'sent' ? (
          /*
            Not a screen in the prototype, which walks straight from the email to
            the password fields because it is a mock with no email in it. Real
            reset waits on the inbox, and a form that cannot be submitted is
            worse than a sentence saying why.
          */
          <div className="mt-[26px] flex flex-col gap-4">
            <p className="text-16 text-ink-muted">
              We&apos;ve sent a reset link to <span className="text-ink">{email}</span>. Open it and
              you&apos;ll come back here to choose a new password.
            </p>
            <Button
              type="button"
              size="cta"
              className="mt-2 w-full"
              disabled={!isLoaded || busy}
              onClick={() => setStep('request')}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={reset} className="mt-[26px] flex flex-col gap-4">
            {/*
              Two fields, as the prototype has it. The emailed code is not asked
              for because it arrives on the link - see the note at the top of
              this file for why that is a change in where the code travels
              rather than a change in how Clerk completes the reset.
            */}
            <AuthField
              fieldSize="auth"
              label="Enter password"
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
              placeholder="Confirm password"
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
            {!linkCode ? (
              <p role="alert" className="text-14 text-destructive">
                This link is missing its reset code. Ask for a new email and open the link from it.
              </p>
            ) : null}
            <Button
              type="submit"
              size="cta"
              className="mt-2 w-full"
              disabled={!isLoaded || busy || !linkCode || !password || confirm !== password}
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
