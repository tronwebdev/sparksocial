import type { Metadata } from 'next';
import { PROPOSAL_SERVICE_LABELS, type ProposalService } from '@sparksocial/shared/agencyPipeline';

/**
 * The client-facing proposal — what `proposal.share`'s link opens.
 *
 * ── Why this is a server component and not a route handler ────────────────
 *
 * CLAUDE.md allows exactly two route handlers under `src/app/api`, both
 * transport proxies, and a third would mean a capability accumulating in the
 * web tier. This needs neither: it renders on the server, so it can call the
 * API's public endpoint server-to-server and return HTML. The token never
 * reaches a browser fetch, there is no CORS to widen, and the count of route
 * handlers stays at two.
 *
 * ── What the reader is ────────────────────────────────────────────────────
 *
 * Nobody. No account, no session, no organisation — the token in the path is
 * the entire credential, which is why it is 256 bits, expires, and is revoked
 * the moment the agency records a decision. `middleware.ts` lists `/p/*` as
 * public for exactly this reason and nothing else.
 *
 * ── Deliberately not on this page ─────────────────────────────────────────
 *
 * An accept button. A link that survives being forwarded is not a signature,
 * and a contract accepted by whoever opened an email thread is a legal problem
 * rather than a feature. The page says to reply to the sender; the agency
 * records the answer with `proposal.decide`, which is authenticated and
 * audited.
 *
 * Every string here came from the agency's own typing or a third party's
 * spreadsheet, and is rendered as text by React — never `dangerouslySetInnerHTML`.
 */

const API_URL = process.env.SPARK_API_URL ?? 'http://localhost:8080';

/**
 * `noindex` on the page as well as the API response.
 *
 * The endpoint sets `x-robots-tag`, but a crawler that reached this URL would
 * be reading *this* document, not that one — the header on the JSON it was
 * built from is not attached to the HTML. Both, therefore.
 */
export const metadata: Metadata = {
  title: 'Proposal',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/** Never prerendered, never cached: the URL is a credential. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LineItem {
  service: ProposalService;
  description?: string;
  unitCents: number;
  quantity: number;
  recurrence: 'monthly' | 'one_off';
}

interface PublicProposal {
  title: string;
  preparedFor: string;
  currency: string;
  status: string;
  termMonths: number;
  lineItems: LineItem[];
  monthlyCents: number;
  oneOffCents: number;
  totalContractCents: number;
  notes?: string;
  sentAt?: string;
  expiresAt?: string;
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;

async function load(token: string): Promise<PublicProposal | null> {
  /**
   * A short timeout, and a failure is indistinguishable from a bad token.
   *
   * The page must not hang on an API that is down, and it must not tell an
   * unauthenticated reader the difference between "no such proposal" and "our
   * backend is unreachable" — the first is their problem, the second is ours.
   */
  try {
    const res = await fetch(`${API_URL}/v1/public/proposals/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicProposal;
  } catch {
    return null;
  }
}

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await load(token);

  if (!proposal) return <NotValid />;

  const { currency: cur } = proposal;

  return (
    <main className="min-h-screen px-6 py-[8vh]" style={{ background: '#EEF4F7' }}>
      <article
        className="mx-auto w-full max-w-[720px] overflow-hidden rounded-[20px] bg-white"
        style={{ boxShadow: '0 30px 70px -50px rgba(12,12,12,0.45)' }}
      >
        <header className="px-[40px] pb-[28px] pt-[38px]" style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.18)' }}>
          <h1 className="text-[30px] font-bold leading-[1.2] text-ink">{proposal.title}</h1>
          <p className="mt-[10px] text-[16px]" style={{ color: 'rgb(91,91,91)' }}>
            Prepared for <b className="font-semibold" style={{ color: 'rgb(59,59,59)' }}>{proposal.preparedFor}</b>
          </p>
          <p className="mt-[4px] text-[15px]" style={{ color: 'rgb(131,131,131)' }}>
            {months(proposal.termMonths)} term
            {proposal.sentAt ? ` · sent ${new Date(proposal.sentAt).toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
          </p>
        </header>

        <section className="px-[40px] py-[30px]">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgb(131,131,131)' }}>
            What is included
          </h2>

          <ul className="mt-[18px] space-y-[2px]">
            {proposal.lineItems.map((li, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-[12px] py-[14px]"
                style={i > 0 ? { boxShadow: 'inset 0 1px 0 rgba(131,131,131,0.14)' } : undefined}
              >
                <span className="min-w-0">
                  <span className="block text-[16.5px] font-semibold text-ink">
                    {/* The description carries the meaning where the service is
                        "other"; the label carries it everywhere else. */}
                    {li.description?.trim() || PROPOSAL_SERVICE_LABELS[li.service] || li.service}
                  </span>
                  {li.quantity > 1 ? (
                    <span className="mt-[3px] block text-[14px]" style={{ color: 'rgb(131,131,131)' }}>
                      {li.quantity} × {money(li.unitCents, cur)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[16.5px] font-semibold text-ink">
                    {money(li.unitCents * li.quantity, cur)}
                  </span>
                  <span className="mt-[3px] block text-[13.5px]" style={{ color: 'rgb(131,131,131)' }}>
                    {li.recurrence === 'monthly' ? 'per month' : 'one-off'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/*
          The totals, split the way the contract bills. Spelled out because the
          recurring-versus-one-off distinction is the one a reader misreads, and
          this page is where they are deciding.
        */}
        <section className="mx-[40px] mb-[30px] rounded-[14px] p-[24px]" style={{ background: '#F4F6F8' }}>
          <dl className="space-y-[10px]">
            {proposal.monthlyCents > 0 ? (
              <Row label="Monthly" value={money(proposal.monthlyCents, cur)} />
            ) : null}
            {proposal.oneOffCents > 0 ? (
              <Row label="One-off" value={money(proposal.oneOffCents, cur)} />
            ) : null}
            <div className="pt-[10px]" style={{ boxShadow: 'inset 0 1px 0 rgba(131,131,131,0.2)' }}>
              <Row label={`Total over ${months(proposal.termMonths)}`} value={money(proposal.totalContractCents, cur)} strong />
            </div>
          </dl>
          {proposal.monthlyCents > 0 && proposal.oneOffCents > 0 ? (
            <p className="mt-[14px] text-[13.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
              The monthly amount recurs for each of the {months(proposal.termMonths)}. The one-off is charged once.
            </p>
          ) : null}
        </section>

        {proposal.notes?.trim() ? (
          <section className="px-[40px] pb-[30px]">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgb(131,131,131)' }}>
              Notes
            </h2>
            {/* Pre-wrapped rather than parsed: the agency typed line breaks and
                meant them, and no markup from a text field is rendered as HTML. */}
            <p className="mt-[12px] whitespace-pre-wrap text-[15.5px] leading-[1.6] text-ink">{proposal.notes}</p>
          </section>
        ) : null}

        <footer className="px-[40px] pb-[36px]">
          <div className="rounded-[14px] p-[20px]" style={{ background: '#E4EEFB' }}>
            <p className="text-[15.5px] font-semibold" style={{ color: '#2B5EA7' }}>
              To accept, reply to the email this link came from.
            </p>
            <p className="mt-[6px] text-[14.5px] leading-[1.5]" style={{ color: '#3A6295' }}>
              This page is a copy of the offer to read and share internally. Nothing on it commits you to
              anything.
            </p>
          </div>

          {proposal.expiresAt ? (
            <p className="mt-[18px] text-[13.5px]" style={{ color: 'rgb(131,131,131)' }}>
              This link stops working on{' '}
              {new Date(proposal.expiresAt).toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </p>
          ) : null}
        </footer>
      </article>

      <p className="mx-auto mt-[22px] max-w-[720px] text-center text-[13px]" style={{ color: 'rgb(131,131,131)' }}>
        Sent with SparkSocial
      </p>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-[16px]">
      <dt className={strong ? 'text-[16px] font-semibold text-ink' : 'text-[15.5px]'} style={strong ? undefined : { color: 'rgb(91,91,91)' }}>
        {label}
      </dt>
      <dd className={strong ? 'text-[26px] font-bold leading-none text-ink' : 'text-[16px] font-semibold text-ink'}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One page for every failure — expired, revoked, mistyped, never existed, or
 * our own backend being down. Distinguishing them would confirm to somebody
 * holding a stale link that it was once valid, and would tell a stranger when
 * our API is unavailable.
 */
function NotValid() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: '#EEF4F7' }}>
      <div
        className="w-full max-w-[520px] rounded-[20px] bg-white px-[40px] py-[44px] text-center"
        style={{ boxShadow: '0 30px 70px -50px rgba(12,12,12,0.45)' }}
      >
        <h1 className="text-[24px] font-bold leading-[1.25] text-ink">This proposal link is not available</h1>
        <p className="mt-[14px] text-[15.5px] leading-[1.55]" style={{ color: 'rgb(91,91,91)' }}>
          Links expire after a short window, and stop working once the proposal has been decided. Ask
          whoever sent it for a fresh one.
        </p>
      </div>
    </main>
  );
}
