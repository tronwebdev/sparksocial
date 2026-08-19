import { cn } from '@/lib/utils';

/**
 * Login / Forgot Password sit on a full-bleed `#6CE8FF` sky behind a frosted
 * card — `Auth.dc.html:271`. Nested radii (40 outer, 38 inner) and a real
 * `backdrop-filter: blur(30px)`; the double border is what reads as glass rather
 * than as a flat translucent panel.
 */
export function SkyBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#6CE8FF] px-6 py-12">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle at 22% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 42%),' +
            'radial-gradient(circle at 78% 78%, rgba(163,65,255,0.18) 0%, rgba(163,65,255,0) 46%)',
        }}
      />
      <div className="relative w-full">{children}</div>
    </div>
  );
}

export function GlassCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('mx-auto w-[568px] max-w-full rounded-[40px] p-2', className)}
      style={{
        background: 'rgba(255,255,255,0.25)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        boxShadow: '0 30px 70px -30px rgba(12,12,12,0.45)',
      }}
    >
      <div className="rounded-[38px] bg-white px-[45px] py-10">{children}</div>
    </div>
  );
}
