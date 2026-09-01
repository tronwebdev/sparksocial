'use client';

import { cn } from '@/lib/utils';
import { SparkMark } from '@/components/brand/SparkMark';
import { Wordmark } from '@/components/brand/Wordmark';

/**
 * The plain-backdrop auth screens: reset password, verify code, and the two
 * confirmation states.
 *
 * Login is deliberately not built on this — it has its own sky photograph,
 * frosted panel and floating cards, and lives in `GlassCard.tsx`. Everything
 * *else* in the flow is the same 448px card on a flat ground, in one of two
 * tones, so it is one set of parts rather than five hand-built screens.
 *
 * Measured from the captures, all at the 1440-wide frame:
 *
 *   card width      448      identical to Login — `--ss-auth-card`
 *   gutter          36       `--ss-auth-gutter`
 *   control height  56       fields, buttons and OTP boxes alike
 *   light ground    #F5F5F5  `--ss-surface-200`, already in the ramp
 *   dark ground     #0C0C0C  `--ss-ink-900`, plus the blurred-blob export
 *
 * `BG For forgot password…svg` is a 161-byte flat `#F5F5F5` rect, so the light
 * tone uses the token rather than shipping an image to paint a solid colour.
 * The dark tone does use its export — that one carries two mirrored blurred
 * cyan→purple shapes that no token expresses.
 */

export type AuthTone = 'light' | 'dark';

export function AuthBackdrop({
  tone,
  children,
  wordmark = true,
}: {
  tone: AuthTone;
  children: React.ReactNode;
  wordmark?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-12',
        tone === 'light' ? 'bg-[--ss-surface-200]' : 'bg-[--ss-ink-900]',
      )}
    >
      {tone === 'dark' ? (
        <img
          src="/auth/bg-dark.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      {wordmark ? (
        <div className="relative mb-[50px] flex justify-center">
          <Wordmark showMark={false} fontSize={28} className={tone === 'dark' ? '[&>span]:text-white' : undefined} />
        </div>
      ) : null}

      <div className="relative w-full">{children}</div>
    </div>
  );
}

/**
 * The 448px card. `glow` is the confirmation screens' green halo — a ring plus a
 * soft outer shadow, which is why it is a prop here rather than a wrapper: it has
 * to share the card's border radius exactly or it reads as a misaligned box.
 */
export function AuthPanel({
  tone,
  glow = false,
  className,
  children,
}: {
  tone: AuthTone;
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative mx-auto w-auth-card max-w-full overflow-hidden rounded-2xl px-auth-gutter pb-[38px] pt-10',
        tone === 'light' ? 'bg-white' : 'border border-white/[0.06] bg-white/[0.04]',
        className,
      )}
      style={
        glow
          ? {
              boxShadow: `0 0 0 1px color-mix(in srgb, var(--ss-lime) 55%, transparent),
                          0 0 34px -4px color-mix(in srgb, var(--ss-lime) 45%, transparent)`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/**
 * Card masthead: halftone, mark, title, subtitle.
 *
 * Shared with Login (`GlassCard.tsx` re-exports it) so the mark size, the
 * halftone bleed and the 23/7px title rhythm cannot drift between the screen
 * that was measured to 1px and the four built after it.
 */
export function AuthHeader({
  title,
  subtitle,
  tone = 'light',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: AuthTone;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -left-auth-gutter -right-auth-gutter -top-10 h-[130px] overflow-hidden" aria-hidden>
        <img
          src="/auth/login-card-halftone.svg"
          alt=""
          className={cn('absolute inset-x-0 top-0 w-full', tone === 'light' ? 'opacity-40' : 'opacity-25')}
          style={{
            WebkitMaskImage: 'linear-gradient(180deg,#000 40%,transparent 100%)',
            maskImage: 'linear-gradient(180deg,#000 40%,transparent 100%)',
          }}
        />
        <div
          className="absolute left-1/2 top-2 h-[96px] w-[96px] -translate-x-1/2 rounded-full opacity-70"
          style={{ background: 'var(--ss-info)', filter: 'blur(34px)' }}
        />
      </div>

      <div className="relative flex flex-col items-center">
        <SparkMark variant="card" size={48} animated />
        <h1
          className={cn(
            'mt-[23px] text-center text-22 font-semibold',
            tone === 'light' ? 'text-ink-heading' : 'text-white',
          )}
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-[7px] text-center text-14 text-ink-muted">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/**
 * The confirmation tick.
 *
 * Hand-built: there is no export for it. The lime is sampled from the capture
 * (`#BBF52E`) and lives in `tokens.css` as `--ss-lime`, so it is a token like
 * every other colour rather than a literal parked in a component.
 */
export function SuccessBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex h-[42px] w-[42px] items-center justify-center rounded-[12px]', className)}
      style={{ background: 'var(--ss-lime)' }}
      role="img"
      aria-label="Success"
    >
      <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden>
        <path
          d="M2 9.4 8.2 15.6 20 3.8"
          stroke="var(--ss-ink-900)"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Six single-character boxes spanning the card's full 376px content width.
 *
 * One hidden field would be simpler, but the design shows six boxes and people
 * paste codes — so this keeps six real inputs and handles paste on any of them,
 * plus backspace stepping back to the previous box. `inputMode="numeric"` and
 * `autoComplete="one-time-code"` are what let a phone offer the SMS/email code.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  tone = 'dark',
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  tone?: AuthTone;
  disabled?: boolean;
}) {
  const chars = Array.from({ length }, (_, i) => value[i] ?? '');

  function setAt(i: number, ch: string) {
    const next = chars.slice();
    next[i] = ch;
    onChange(next.join('').slice(0, length));
  }

  function focusBox(i: number) {
    const el = document.getElementById(`otp-${i}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }

  return (
    <div className="flex gap-[10px]">
      {chars.map((ch, i) => (
        <input
          key={i}
          id={`otp-${i}`}
          value={ch}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) return setAt(i, '');
            // A paste lands as several characters in one box — spread it.
            if (v.length > 1) {
              onChange((value.slice(0, i) + v).slice(0, length));
              focusBox(Math.min(length - 1, i + v.length));
              return;
            }
            setAt(i, v);
            if (i < length - 1) focusBox(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !chars[i] && i > 0) focusBox(i - 1);
            if (e.key === 'ArrowLeft' && i > 0) focusBox(i - 1);
            if (e.key === 'ArrowRight' && i < length - 1) focusBox(i + 1);
          }}
          className={cn(
            'ss-field h-auth-control min-w-0 flex-1 rounded-lg text-center text-18',
            'focus:outline-none disabled:opacity-50',
            tone === 'dark'
              ? 'border border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/30'
              : 'border border-border bg-input text-ink',
          )}
        />
      ))}
    </div>
  );
}
