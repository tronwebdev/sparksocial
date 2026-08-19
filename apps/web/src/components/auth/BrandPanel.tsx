import { SparkMark } from '@/components/brand/SparkMark';

/**
 * Sign Up's left panel — `Auth.dc.html:32-87`. Dark, with a cyan radial bloom,
 * two faint pink discs, the 148px hero mark and floating glass chips.
 *
 * The prototype positions everything absolutely on a 938px panel. Those positions
 * are kept as percentages of that width so the panel can flex (it is
 * `flex: 0 1 938px; min-width: 620px`) without the composition falling apart.
 */
const CHIPS = [
  { left: '21%', top: '14%', size: 62, radius: 16, anim: 'animate-float-a' },
  { left: '5%', top: '80%', size: 56, radius: 15, anim: 'animate-float-a' },
  { left: '87%', top: '79%', size: 56, radius: 15, anim: 'animate-float-b' },
  { left: '74%', top: '20%', size: 48, radius: 14, anim: 'animate-float-b' },
  { left: '12%', top: '38%', size: 44, radius: 13, anim: 'animate-float-b' },
  { left: '82%', top: '45%', size: 52, radius: 14, anim: 'animate-float-a' },
];

export function BrandPanel() {
  return (
    <div className="relative flex-[0_1_938px] overflow-hidden bg-[#0C0C0C] max-lg:hidden" style={{ minWidth: 620 }}>
      {/* Cyan bloom */}
      <div
        className="absolute left-1/2 top-[44%] h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 46%, rgba(11,170,199,0.34) 0%, rgba(11,170,199,0.10) 34%, rgba(12,12,12,0) 66%)',
        }}
      />
      <div className="absolute left-[9%] top-[5%] h-[762px] w-[762px] rounded-full bg-[rgba(245,107,255,0.05)] opacity-30" />
      <div className="absolute left-[15%] top-[20%] h-[478px] w-[478px] rounded-full bg-[rgba(245,107,255,0.05)] opacity-30" />

      {CHIPS.map((c, i) => (
        <div
          key={i}
          className={`absolute ${c.anim} motion-reduce:animate-none`}
          style={{
            left: c.left,
            top: c.top,
            width: c.size,
            height: c.size,
            borderRadius: c.radius,
            background: 'rgba(255,255,255,0.11)',
            backdropFilter: 'blur(9px)',
            WebkitBackdropFilter: 'blur(9px)',
          }}
          aria-hidden
        />
      ))}

      <div className="relative flex h-full flex-col items-center justify-center px-10">
        <SparkMark variant="hero" animated />
        <div className="mt-[52px] text-center">
          <p className="font-display text-[48.5px] leading-[1.269] text-white">Agent-first Social</p>
          <p className="font-display text-[39.2px] leading-[1.269] text-white">Operating System</p>
        </div>
        <div className="mt-[22px] flex items-center gap-[10px]">
          <span className="text-[15.4px] font-medium text-white/60">Get Started</span>
          <svg width="28" height="10" viewBox="0 0 28 10" fill="none" aria-hidden>
            <path
              d="M1 5h25m0 0-4-4m4 4-4 4"
              stroke="rgba(255,255,255,0.6)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
