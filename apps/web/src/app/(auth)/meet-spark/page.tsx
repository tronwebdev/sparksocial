'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SparkMark } from '@/components/brand/SparkMark';
import { Button } from '@/components/ui/button';

/**
 * Meet Spark — `Auth.dc.html` state 3. Full-bleed dark splash after sign-up.
 *
 * In the prototype this hands off to onboarding (ONB-01→ONB-06), which is not
 * built yet — so for now it drops the user straight into the shell.
 */
export default function MeetSparkPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  /**
   * Just navigates. Selecting the organisation is `OrgGuard`'s job in the
   * `(app)` layout — it has to be, because every other way into the shell (a
   * deep link, a bookmark, a refresh) bypasses this screen. Doing it here too
   * would be a second implementation of the same rule, free to drift from the
   * one that actually covers all the entry points.
   */
  function begin() {
    setBusy(true);
    router.push('/');
  }

  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div
        className="pointer-events-none absolute h-[900px] w-[900px] rounded-full"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle at 50% 46%, rgba(11,170,199,0.34) 0%, rgba(11,170,199,0.10) 34%, rgba(12,12,12,0) 66%)',
        }}
      />

      <div className="relative flex flex-col items-center">
        <SparkMark variant="hero" animated />
        <h1 className="mt-12 text-center font-display text-[48.5px] leading-[1.269] text-white">Meet SPARK</h1>
        <p className="mt-4 max-w-[520px] text-center text-[18px] text-white/70">
          SPARK learns what your business can actually show, then plans, makes and publishes the content that fits.
        </p>

        <Button onClick={begin} size="cta" variant="secondary" className="mt-10 px-10" disabled={busy}>
          {busy ? 'Setting up…' : 'Get started'}
        </Button>
      </div>
    </div>
  );
}
