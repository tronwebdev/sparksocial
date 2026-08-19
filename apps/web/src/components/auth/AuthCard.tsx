import { SparkMark } from '@/components/brand/SparkMark';

/**
 * The white form card — `Auth.dc.html:89-110`. 540px wide, 38px radius, with a
 * dotted purple halftone and a cyan blur bloom bleeding down from the top edge,
 * then the 91px mark, heading and subtitle.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative w-[540px] max-w-full overflow-hidden rounded-[38px] bg-white">
      <div className="pointer-events-none absolute -left-0.5 -right-0.5 top-0 h-[132px] opacity-30" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(163,65,255,0.85) 1.4px, rgba(163,65,255,0) 1.5px)',
            backgroundSize: '45px 34px',
            backgroundPosition: '14px 8px',
            WebkitMaskImage: 'linear-gradient(180deg,#000 55%,transparent 100%)',
            maskImage: 'linear-gradient(180deg,#000 55%,transparent 100%)',
          }}
        />
        <div
          className="absolute left-[212px] top-2 h-[119px] w-[119px] rounded-full"
          style={{ background: '#0BAAC7', filter: 'blur(38px)' }}
        />
      </div>

      <div className="relative mx-auto mt-[27px] w-fit">
        <SparkMark variant="card" />
      </div>

      <h1 className="mt-[14px] text-center text-[26px] font-semibold leading-[1.4] text-ink-heading">{title}</h1>
      {subtitle ? <p className="mt-2 text-center text-[16px] text-ink-muted">{subtitle}</p> : null}

      <div className="px-[45px] pb-[31px] pt-6">{children}</div>
    </div>
  );
}
