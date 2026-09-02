/**
 * The pinned plan card — `SparkSocial Dashboard.dc.html`, 282×77 at
 * `left:21 top:1023`, i.e. bottom-anchored, which is what it becomes here.
 *
 * Rebuilt against the prototype, which has more in it than the version this
 * replaces: a 57px avatar with an online tick badged onto it, "Pro Plan" at
 * 18px/600, and the credits as a 112×26 pill on `#DCF2F6` in `#838383` — not a
 * shared `Badge`, whose fill is a different blue. The card itself has no
 * background at all, just a `rgba(131,131,131,0.2)` hairline ring; it was
 * filled with `surface-muted`, which reads as a pressed state next to the
 * transparent nav above it.
 *
 * "Renews monthly" is gone. The prototype's second line is the credits pill,
 * and the card is 77px tall — three lines do not fit without shrinking the type
 * below what the design uses.
 *
 * Credits are still a placeholder until the credit ledger exists (plan §9, P3).
 * Wiring a real number now would mean inventing a source for it, and this is a
 * bad place to be approximately right about money.
 */
export function PlanCard() {
  return (
    <div
      className="mx-[21px] mb-6 h-[77px] rounded-md max-xl:hidden"
      style={{ boxShadow: '0 0 0 1px rgba(131,131,131,0.2)' }}
    >
      <div className="relative h-full">
        <span className="absolute left-3 top-[10px] block h-[57px] w-[57px]">
          <span
            className="block h-full w-full rounded-full"
            style={{
              background: "#F8F8F8 url('/dashboard/pro-memoji.png') center / cover no-repeat",
              boxShadow: 'inset 0 0 0 1.44px rgba(120,120,120,0.28)',
            }}
          />
          {/* The 17px tick, badged onto the avatar's lower right. */}
          <span
            className="absolute left-[28px] top-[26px] flex h-[17px] w-[17px] items-center justify-center rounded-full"
            style={{ background: '#13D711' }}
          >
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden>
              <path d="m1 3.5 2.3 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>

        <span className="absolute left-[85px] top-[11px] text-18 font-semibold leading-[1.28] text-ink">
          Pro Plan
        </span>

        <span
          className="absolute left-[85px] top-[39px] flex h-[26px] w-[112px] items-center rounded pl-[9px] text-14 font-semibold"
          style={{ background: '#DCF2F6', color: '#838383' }}
        >
          1,200 credits
        </span>

        <svg
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="none"
          aria-hidden
          className="absolute left-[262px] top-[27px] block"
        >
          <path d="m1 1 5.5 6L1 13" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
